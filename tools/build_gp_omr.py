# -*- coding: utf-8 -*-
"""
build_gp_omr.py — 对 tools/_omr_samples/<songId>/ 下的谱面图片跑 OMR,
把结果汇总为 assets/js/gp/omr-notes.js(GP_OMR_NOTES)。

质量门槛: 单曲合计 ≥10 个音符事件且覆盖 ≥4 小节才收录,否则视为识别失败
(扫弦谱/和弦图谱没有品位数字,自然被挡在门外,继续走模板和弦)。

用法: python build_gp_omr.py [--only gp-song-001] [--thr 0.66]
"""
import argparse, io, json, os, sys

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import omr_tab

ROOT = os.path.dirname(os.path.abspath(__file__))
SAMPLES = os.path.join(ROOT, "_omr_samples")
OUT = os.path.normpath(os.path.join(ROOT, "..", "assets", "js", "gp", "omr-notes.js"))

MIN_EVENTS = 10
MIN_MEASURES = 4


def collect(sid_dir, thr):
    """对一首曲目的所有页面跑 OMR,跨页拼接(absBeat 累加偏移)。"""
    meta_p = os.path.join(sid_dir, "meta.json")
    if not os.path.exists(meta_p):
        return None, "no-meta"
    meta = json.load(io.open(meta_p, encoding="utf-8"))
    if meta.get("status") != "ok":
        return None, meta.get("status", "no-tab")
    all_ev, bpm_beats, pages = [], 4, 0
    beat_off = 0.0
    for name in sorted(meta.get("images") or []):
        p = os.path.join(sid_dir, name)
        if not os.path.exists(p):
            continue
        try:
            res = omr_tab.recognize(p, beats_per_measure=bpm_beats, thr=thr)
        except Exception as e:
            print(f"  {os.path.basename(sid_dir)}/{name} ERR {e}", file=sys.stderr)
            continue
        ev = res.get("events") or []
        if res.get("systems", 0) >= 1 and ev:
            pages += 1
            for e in ev:
                e = dict(e)
                e["absBeat"] = round(e["absBeat"] + beat_off, 4)
                all_ev.append(e)
            beat_off = max(x["absBeat"] for x in all_ev) + bpm_beats
    if len(all_ev) < MIN_EVENTS:
        return None, f"too-few-events({len(all_ev)})"
    all_ev.sort(key=lambda e: (e["absBeat"], e["string"]))
    # 合并同拍为和弦音符
    notes = []
    for e in all_ev:
        midi = omr_tab.OPEN_STRINGS[e["string"] - 1] + e["fret"]
        if not (36 <= midi <= 88):
            continue
        if notes and abs(notes[-1][0] - e["absBeat"]) < 1e-6:
            if midi not in notes[-1][2]:
                notes[-1][2].append(midi)
                notes[-1][2].sort()
        else:
            notes.append([e["absBeat"], 0.9, [midi]])
    for i, n in enumerate(notes):
        nxt = notes[i + 1][0] if i + 1 < len(notes) else n[0] + 4
        n[1] = round(max(0.25, min(2.5, (nxt - n[0]) * 0.92)), 3)
    span = max(n[0] + n[1] for n in notes)
    if span < MIN_MEASURES * bpm_beats:
        return None, f"too-short({span:.1f}beats)"
    return {
        "b": bpm_beats,                 # beatsPerMeasure
        "span": round(span, 3),         # 单次循环长度(拍)
        "n": [[round(b, 3), d, m] for b, d, m in notes],
        "src": meta.get("source"),
        "pages": pages,
    }, "ok"


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--only", default="")
    ap.add_argument("--thr", type=float, default=0.66)
    a = ap.parse_args()
    only = set(x for x in a.only.split(",") if x)

    out = {}
    report = {}
    for sid in sorted(os.listdir(SAMPLES)):
        d = os.path.join(SAMPLES, sid)
        if not (sid.startswith("gp-song-") and os.path.isdir(d)):
            continue
        if only and sid not in only:
            continue
        res, status = collect(d, a.thr)
        report[sid] = status
        if res:
            out[sid] = res
            print(f"[{sid}] ok: {len(res['n'])} notes, span {res['span']} beats", file=sys.stderr)
        else:
            print(f"[{sid}] skip: {status}", file=sys.stderr)

    js = json.dumps(out, ensure_ascii=False, separators=(",", ":"))
    with io.open(OUT, "w", encoding="utf-8") as fh:
        fh.write("/* ============================================================\n")
        fh.write("   六弦工坊 V4.2 · OMR 真实谱面音符(吉他社图片谱光学识别)\n")
        fh.write("   ------------------------------------------------------------\n")
        fh.write("   本文件由 tools/build_gp_omr.py 生成,请勿手工编辑。\n")
        fh.write("   识别管线: tools/omr_tab.py(谱线/小节线形态学检测 + 品位数字\n")
        fh.write("   多字体 matchTemplate 模板匹配)。数值含义:\n")
        fh.write("     b    = 每小节拍数(默认 4)\n")
        fh.write("     span = 谱面单次长度(拍),演奏时循环铺满整曲\n")
        fh.write("     n    = [[起始拍, 时值拍, [midi...]], ...]\n")
        fh.write("   ============================================================ */\n")
        fh.write("'use strict';\n\n")
        fh.write("export const GP_OMR_NOTES = %s;\n\n" % js)
        fh.write("export default GP_OMR_NOTES;\n")
    json.dump(report, io.open(os.path.join(SAMPLES, "_omr_report.json"), "w", encoding="utf-8"),
              ensure_ascii=False, indent=1)
    print(f"omr songs: {len(out)} -> {OUT}", file=sys.stderr)


if __name__ == "__main__":
    main()
