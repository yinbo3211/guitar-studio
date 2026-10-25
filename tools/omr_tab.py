# -*- coding: utf-8 -*-
"""
omr_tab.py — 吉他六线谱(TAB)图片 OMR 转音符事件。

方法:谱线/小节线用形态学检测;品位数字用「沿谱线擦除谱线后 matchTemplate
滑窗模板匹配」(多字体×多字号模板),比连通域法对断线/粘连鲁棒得多。

输入: 六线谱 JPG/PNG(吉他社等来源的清晰打印谱)
输出: JSON {
  "systems": <识别到的六线谱系统数>,
  "beatsPerMeasure": 4,
  "events": [{"string":1..6(1=高音e), "fret":0..24, "beat":<小节内拍>,
              "measure":<全局小节序号>, "absBeat":<全局拍>, "conf":...}...],
  "notes":  [{"beat":..., "durBeat":..., "midi":[...]}...]
}

用法: python omr_tab.py <image> [--out x.json] [--debug debug.png] [--bpm 4]
"""
import argparse, json, sys, os
import numpy as np
import cv2

# 标准调弦开弦 MIDI,索引0=1弦(高音e) … 5=6弦(低音E)
OPEN_STRINGS = [64, 59, 55, 50, 45, 40]

# ---------------------------------------------------------------- 模板库
_TEMPLATE_CACHE = {}  # target_h -> {digit: [templ np.float32]}


def _font_paths():
    windir = os.environ.get("WINDIR", r"C:\Windows")
    out = []
    for name in ("arial.ttf", "arialbd.ttf", "calibri.ttf", "calibrib.ttf",
                 "tahoma.ttf", "times.ttf", "timesbd.ttf"):
        p = os.path.join(windir, "Fonts", name)
        if os.path.exists(p):
            out.append(p)
    return out


def _render_digit(digit, font_path, target_h, pad_x_ratio=0.45):
    """渲染数字并缩放到 glyph 高=target_h,带左右留白。返回 float32 模板。"""
    from PIL import ImageFont, ImageDraw, Image
    big = max(64, target_h * 4)
    try:
        font = ImageFont.truetype(font_path, big)
    except Exception:
        return None
    img = Image.new("L", (big * 2, big * 2), 0)
    dr = ImageDraw.Draw(img)
    dr.text((big // 2, big // 2), digit, font=font, fill=255)
    arr = np.array(img)
    ys, xs = np.nonzero(arr > 100)
    if len(xs) == 0:
        return None
    crop = arr[ys.min():ys.max() + 1, xs.min():xs.max() + 1]
    h, w = crop.shape
    scale = target_h / h
    nw = max(1, int(round(w * scale)))
    resized = cv2.resize(crop, (nw, target_h), interpolation=cv2.INTER_AREA)
    pw = int(round(target_h * pad_x_ratio))
    pv = int(round(target_h * 0.25))
    canvas = np.zeros((target_h + 2 * pv, nw + 2 * pw), np.float32)
    t = (resized.astype(np.float32) / 255.0 > 0.45).astype(np.float32)
    canvas[pv:pv + target_h, pw:pw + nw] = t
    return canvas


def _templates_for(target_h):
    key = int(target_h)
    if key in _TEMPLATE_CACHE:
        return _TEMPLATE_CACHE[key]
    temps = []  # list of (digit, templ)
    for fp in _font_paths():
        for d in "0123456789":
            t = _render_digit(d, fp, key)
            if t is not None:
                temps.append((d, t))
    _TEMPLATE_CACHE[key] = temps
    return temps


# ---------------------------------------------------------------- 谱线检测

def _binarize(gray):
    blur = cv2.GaussianBlur(gray, (3, 3), 0)
    _, bw = cv2.threshold(blur, 0, 255, cv2.THRESH_BINARY_INV + cv2.THRESH_OTSU)
    return bw  # 前景=255


def _find_staff_lines(bw):
    h, w = bw.shape
    klen = max(30, w // 25)
    kernel = cv2.getStructuringElement(cv2.MORPH_RECT, (klen, 1))
    opened = cv2.morphologyEx(bw, cv2.MORPH_OPEN, kernel)
    lines = []
    for y in range(h):
        xs = np.nonzero(opened[y])[0]
        if len(xs) > w * 0.30:
            lines.append((y, int(xs.min()), int(xs.max())))
    merged = []
    for y, x0, x1 in lines:
        if merged and y - merged[-1][0] <= 3:
            py, px0, px1 = merged[-1]
            merged[-1] = ((py + y) // 2, min(px0, x0), max(px1, x1))
        else:
            merged.append((y, x0, x1))
    return merged


def _group_systems(lines):
    systems = []
    i, n = 0, len(lines)
    while i < n:
        group = [lines[i]]
        j = i + 1
        while j < n and len(group) < 6:
            gap = lines[j][0] - group[-1][0]
            if len(group) == 1:
                if not (4 <= gap <= 60):
                    break
            else:
                ref = (group[-1][0] - group[0][0]) / (len(group) - 1)
                if abs(gap - ref) > max(3, ref * 0.35):
                    break
            group.append(lines[j])
            j += 1
        if len(group) == 6:
            systems.append(group)
            i = j
        else:
            i += 1
    return systems


def _find_barlines(bw, system):
    ys = [l[0] for l in system]
    top, bot = ys[0], ys[-1]
    x0 = min(l[1] for l in system)
    x1 = max(l[2] for l in system)
    band = bw[max(0, top - 2):bot + 3, x0:x1 + 1]
    kh = max(8, int((bot - top) * 0.85))
    kernel = cv2.getStructuringElement(cv2.MORPH_RECT, (1, kh))
    opened = cv2.morphologyEx(band, cv2.MORPH_OPEN, kernel)
    cols = []
    for x in range(opened.shape[1]):
        if np.count_nonzero(opened[:, x]) > (bot - top) * 0.7:
            cols.append(x + x0)
    merged = []
    for x in cols:
        if merged and x - merged[-1] <= 3:
            merged[-1] = (merged[-1] + x) // 2
        else:
            merged.append(x)
    return merged


# ---------------------------------------------------------------- 数字检测

def _detect_digits(bw, system, barlines, thr=0.66, is_first_system=False):
    """在系统区域内滑窗模板匹配品位数字。返回 ([{digit,cx,cy,conf,line}], gap, notation_x0)"""
    ys = [l[0] for l in system]
    top, bot = ys[0], ys[-1]
    gap = (bot - top) / 5.0
    x0 = min(l[1] for l in system)
    x1 = max(l[2] for l in system)
    pad = int(round(gap * 0.9))
    ry0 = max(0, top - pad)
    ry1 = min(bw.shape[0], bot + pad)
    region = bw[ry0:ry1, x0:x1 + 1].astype(np.float32) / 255.0
    # 1) 先擦符干(竖线,高≥1.7 倍线距)——必须在擦谱线之前,否则符干被谱线
    #    擦除切成 ~1 倍线距的短竖段,会被误识为数字 "1"
    reg8 = (region > 0.5).astype(np.uint8) * 255
    vk = cv2.getStructuringElement(cv2.MORPH_RECT, (1, int(round(gap * 1.7))))
    vert = cv2.morphologyEx(reg8, cv2.MORPH_OPEN, vk)
    region[vert > 0] = 0.0
    # 2) 擦除小节线列
    for bx in barlines:
        lx = bx - x0
        region[:, max(0, lx - 1):lx + 2] = 0.0
    # 3) 擦除 TAB 字母区(每个系统开头 ~3.4 倍线距)
    tab_w = int(round(gap * 3.4))
    region[:, :tab_w] = 0.0
    notation_x0 = x0 + tab_w
    # 4) 擦除 6 条谱线(±1px)
    for y in ys:
        ly = y - ry0
        region[max(0, ly - 1):ly + 2, :] = 0.0
    # 5) 擦除横杠/减时线/符梁(水平长条;宽阈值取 0.62 倍线距,
    #    短延音杠也能擦掉,而数字横笔画更短不受影响)
    reg8 = (region > 0.5).astype(np.uint8) * 255
    hk = cv2.getStructuringElement(cv2.MORPH_RECT, (max(5, int(round(gap * 0.62))), 1))
    hori = cv2.morphologyEx(reg8, cv2.MORPH_OPEN, hk)
    region[hori > 0] = 0.0

    target_h = int(round(gap * 0.95))
    temps = _templates_for(target_h)
    raw = []  # (digit, cx, cy, score)
    for d, t in temps:
        th, tw = t.shape
        if th >= region.shape[0] or tw >= region.shape[1]:
            continue
        res = cv2.matchTemplate(region, t, cv2.TM_CCOEFF_NORMED)
        dil = cv2.dilate(res, np.ones((3, 3), np.uint8))
        peaks = np.argwhere((res == dil) & (res >= thr))
        for py, px in peaks:
            cx = px + x0 + tw / 2.0
            cy = py + ry0 + th / 2.0
            raw.append([d, cx, cy, float(res[py, px])])
    # 全局非极大抑制:x/y 都接近时只留最高分(消除跨线重复命中)
    raw.sort(key=lambda r: -r[3])
    kept = []
    for r in raw:
        si = _nearest_line(r[2], ys, gap)
        if si is None:
            continue
        clash = False
        for k in kept:
            if abs(k["cx"] - r[1]) < gap * 0.5 and abs(k["cy"] - r[2]) < gap * 0.55:
                clash = True
                break
        if not clash:
            kept.append({"digit": r[0], "cx": r[1], "cy": r[2],
                         "conf": round(r[3], 3), "line": si})
    # 6) 拍号剔除:首个系统的记谱起点后 2.2 倍线距内的命中视为拍号(4/4 等),
    #    丢弃并把记谱起点推过它们(拍号必然紧跟 TAB 区,真实音符不会贴这么近)
    if is_first_system:
        kept.sort(key=lambda d: d["cx"])
        sig = [d for d in kept if d["cx"] < notation_x0 + gap * 2.2]
        if sig:
            kept = [d for d in kept if d["cx"] >= notation_x0 + gap * 2.2]
            notation_x0 = max(d["cx"] for d in sig) + gap * 1.0
    return kept, gap, notation_x0


def _nearest_line(cy, ys, gap):
    best, bd = None, 1e9
    for i, y in enumerate(ys):
        d = abs(cy - y)
        if d < bd:
            bd, best = d, i
    return best if bd <= gap * 0.48 else None


# ---------------------------------------------------------------- 主流程

def recognize(image_path, beats_per_measure=4, debug_path=None, thr=0.66):
    img = cv2.imread(image_path)
    if img is None:
        raise RuntimeError(f"cannot read {image_path}")
    gray = cv2.cvtColor(img, cv2.COLOR_BGR2GRAY)
    if gray.shape[1] < 900:
        s = 900 / gray.shape[1]
        gray = cv2.resize(gray, None, fx=s, fy=s, interpolation=cv2.INTER_CUBIC)
        img = cv2.resize(img, None, fx=s, fy=s, interpolation=cv2.INTER_CUBIC)
    bw = _binarize(gray)
    lines = _find_staff_lines(bw)
    systems = _group_systems(lines)
    # 线距过小的图放大到易识别尺度(两遍法:先测线距,再重跑)
    if systems:
        gaps = [(_s[-1][0] - _s[0][0]) / 5.0 for _s in systems]
        med_gap = sorted(gaps)[len(gaps) // 2]
        if med_gap < 11.5:
            s = 14.0 / med_gap
            if s * gray.shape[1] <= 8000:
                gray = cv2.resize(gray, None, fx=s, fy=s, interpolation=cv2.INTER_CUBIC)
                img = cv2.resize(img, None, fx=s, fy=s, interpolation=cv2.INTER_CUBIC)
                bw = _binarize(gray)
                lines = _find_staff_lines(bw)
                systems = _group_systems(lines)

    events = []
    debug = img.copy() if debug_path else None
    measure_base = 0

    for system in systems:
        ys = [l[0] for l in system]
        gap = (ys[-1] - ys[0]) / 5.0
        barlines = _find_barlines(bw, system)
        dets, _, notation_x0 = _detect_digits(bw, system, barlines, thr=thr, is_first_system=(system is systems[0]))
        # 多位数聚簇:同一线、x 接近
        dets.sort(key=lambda d: (d["line"], d["cx"]))
        clusters = []
        for d in dets:
            if (clusters and clusters[-1][-1]["line"] == d["line"]
                    and d["cx"] - clusters[-1][-1]["cx"] < gap * 1.05):
                clusters[-1].append(d)
            else:
                clusters.append([d])

        xs_bounds = barlines[:]
        sx0 = min(l[1] for l in system)
        sx1 = max(l[2] for l in system)
        # 第 0 小节的左边界用记谱起点(跳过 TAB/拍号),否则拍点整体偏晚
        if not xs_bounds or xs_bounds[0] > sx0 + gap:
            xs_bounds = [int(notation_x0)] + xs_bounds
        else:
            xs_bounds[0] = int(notation_x0)
        if xs_bounds[-1] < sx1 - gap:
            xs_bounds.append(sx1)

        for cl in clusters:
            cl.sort(key=lambda d: d["cx"])
            fret = int("".join(d["digit"] for d in cl))
            if fret > 24:
                continue
            conf = min(d["conf"] for d in cl)
            cx = float(np.mean([d["cx"] for d in cl]))
            mi = 0
            for k in range(len(xs_bounds) - 1):
                if xs_bounds[k] <= cx <= xs_bounds[k + 1]:
                    mi = k
                    break
                if cx > xs_bounds[k + 1]:
                    mi = k + 1
            mi = min(mi, len(xs_bounds) - 2)
            xa, xb = xs_bounds[mi], xs_bounds[mi + 1]
            frac = (cx - xa) / max(1.0, xb - xa)
            beat_in_m = round(frac * beats_per_measure * 4) / 4.0
            beat_in_m = min(beat_in_m, beats_per_measure - 0.25)
            gm = measure_base + mi
            events.append({
                "string": cl[0]["line"] + 1,
                "fret": fret,
                "measure": gm,
                "beat": beat_in_m,
                "absBeat": gm * beats_per_measure + beat_in_m,
                "conf": conf,
            })
            if debug is not None:
                cv2.circle(debug, (int(cx), int(cl[0]["cy"])), 8, (0, 0, 255), 2)
                cv2.putText(debug, str(fret), (int(cx) - 6, int(cl[0]["cy"] - gap)),
                            cv2.FONT_HERSHEY_SIMPLEX, 0.55, (255, 0, 0), 2)
        measure_base += max(1, len(xs_bounds) - 1)
        if debug is not None:
            for bx in barlines:
                cv2.line(debug, (bx, ys[0] - 4), (bx, ys[-1] + 4), (0, 255, 0), 1)

    events.sort(key=lambda e: (e["absBeat"], e["string"]))
    # 全局平移:让首个事件落在第 0 拍(谱面左边距估计有系统性偏差)
    if events:
        shift = events[0]["absBeat"]
        for e in events:
            e["absBeat"] = round(e["absBeat"] - shift, 4)
    notes = []
    for e in events:
        midi = OPEN_STRINGS[e["string"] - 1] + e["fret"]
        if notes and abs(notes[-1]["beat"] - e["absBeat"]) < 1e-6:
            if midi not in notes[-1]["midi"]:
                notes[-1]["midi"].append(midi)
        else:
            notes.append({"beat": e["absBeat"], "durBeat": 0.9, "midi": [midi]})
    for i, n in enumerate(notes):
        nxt = notes[i + 1]["beat"] if i + 1 < len(notes) else n["beat"] + 2
        n["durBeat"] = max(0.2, min(2.0, (nxt - n["beat"]) * 0.92))
        n["midi"].sort()
    if debug_path and debug is not None:
        cv2.imwrite(debug_path, debug)
    return {
        "systems": len(systems),
        "beatsPerMeasure": beats_per_measure,
        "events": events,
        "notes": notes,
    }


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("image")
    ap.add_argument("--out")
    ap.add_argument("--debug")
    ap.add_argument("--bpm", type=int, default=4, help="beats per measure")
    ap.add_argument("--thr", type=float, default=0.66, help="digit match threshold")
    a = ap.parse_args()
    res = recognize(a.image, beats_per_measure=a.bpm, debug_path=a.debug, thr=a.thr)
    text = json.dumps(res, ensure_ascii=False, indent=1)
    if a.out:
        with open(a.out, "w", encoding="utf-8") as f:
            f.write(text)
        print(f"systems={res['systems']} events={len(res['events'])} -> {a.out}", file=sys.stderr)
    else:
        print(text)


if __name__ == "__main__":
    main()
