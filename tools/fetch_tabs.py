# -*- coding: utf-8 -*-
"""
fetch_tabs.py — 按歌单批量从吉他社下载六线谱图片(供 omr_tab.py 识别)。

流程: /search/tab/<歌名>/ → 解析 .tab-item(标题/歌手/标签/缩略图) → 打分选最优
→ 开 tab 页收集全部谱面原图(xmimg/forum,去 x-oss-process 查询) → 下载到
tools/_omr_samples/<songId>/img_N.jpg + meta.json。

限速: 每次请求间隔 0.7~1.4s,遇 429 指数退避。支持断点续跑。
用法: python fetch_tabs.py [--limit N] [--only gp-song-001,gp-song-002]
"""
import argparse, json, os, random, re, sys, time
import urllib.request, urllib.parse, http.cookiejar

BASE = "https://www.jitashe.org"
UA = {"User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0 Safari/537.36"}
ROOT = os.path.dirname(os.path.abspath(__file__))
OUT = os.path.join(ROOT, "_omr_samples")

_cj = http.cookiejar.CookieJar()
_op = urllib.request.build_opener(urllib.request.HTTPCookieProcessor(_cj))


def get(url, binary=False, referer=BASE + "/", retries=4):
    for attempt in range(retries):
        try:
            req = urllib.request.Request(url, headers={**UA, "Referer": referer})
            data = _op.open(req, timeout=25).read()
            time.sleep(random.uniform(0.7, 1.4))
            return data if binary else data.decode("utf-8", "ignore")
        except urllib.error.HTTPError as e:
            if e.code == 429:
                wait = 20 * (attempt + 1)
                print(f"  429 backoff {wait}s: {url[:80]}", file=sys.stderr)
                time.sleep(wait)
                continue
            if e.code in (403, 404):
                raise
            time.sleep(5 * (attempt + 1))
        except Exception:
            time.sleep(5 * (attempt + 1))
    raise RuntimeError(f"fetch failed: {url}")


def norm(s):
    return re.sub(r"[\s·・（()）\-—_]+", "", (s or "").lower())


def search_tabs(title):
    """返回 [{id,title,artist,tags,tabtype,thumb}]"""
    url = f"{BASE}/search/tab/{urllib.parse.quote(title)}/"
    html = get(url)
    items = []
    for m in re.finditer(r'<div class="tab-item">(.*?)(?=<div class="tab-item">|$)', html, re.S):
        blk = m.group(1)
        t = re.search(r'class="title" href="/tab/(\d+)/"[^>]*>([^<]*)</a>', blk)
        if not t:
            continue
        a = re.search(r'class="title2"[^>]*>([^<]*)</a>', blk)
        img = re.search(r'<img src="([^"]+?)(?:\?[^"]*)?"', blk)
        tt = re.search(r'class="tabtype">([^<]*)<', blk)
        tags = re.findall(r'class="tag"[^>]*>([^<]*)<', blk)
        items.append({
            "id": t.group(1), "title": t.group(2).strip(),
            "artist": (a.group(1).strip() if a else ""),
            "thumb": (img.group(1) if img else None),
            "tabtype": (tt.group(1).strip() if tt else ""),
            "tags": tags,
        })
    return items


def pick(items, title, artist):
    best, best_s = None, -999
    nt, na = norm(title), norm(artist)
    for it in items:
        if it["tabtype"] and "图片" not in it["tabtype"]:
            continue  # 只要图片谱(GTP 等跳过)
        s = 0
        it_t, it_a = norm(it["title"]), norm(it["artist"])
        if it_t == nt: s += 4
        elif nt and (nt in it_t or it_t in nt): s += 2
        else: continue
        if na and na in it_a: s += 3
        elif na and it_a and (it_a in na): s += 2
        tg = set(it["tags"])
        if "单音版" in tg: s += 3
        if "指弹" in tg: s += 2
        if "简单版" in tg: s += 2
        if "弹唱" in tg: s += 1
        if s > best_s:
            best, best_s = it, s
    return best


def tab_images(tab_id, thumb=None):
    """开 tab 页,收集全部谱面原图 URL(xmimg/forum,去查询串)。
    过滤头像/封面: Avatar 路径、与搜索结果缩略图相同的首图(专辑封面)。
    若 tab 页无图,退回用缩略图原图(仅当它像谱面: 由调用方决定是否接受)。"""
    html = get(f"{BASE}/tab/{tab_id}/")
    urls = []
    for m in re.finditer(r'(https?://att\.jitashe\.org/data/attachment/(?:xmimg|forum)/[^\s"\'<>]+?\.(?:jpg|jpeg|png))(?:\?[^\s"\'<>]*)?', html, re.I):
        u = m.group(1)
        if "/avatar/" in u:
            continue  # 头像不是谱面;封面由内容过滤(build_gp_omr 判谱线)
        if u not in urls:
            urls.append(u)
    if not urls and thumb:
        urls = [thumb.split("?")[0]]
    return urls


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--limit", type=int, default=0)
    ap.add_argument("--only", default="")
    a = ap.parse_args()
    songs = json.load(open(os.path.join(ROOT, "gp_songs_raw.json"), encoding="utf-8"))
    only = set(x for x in a.only.split(",") if x)
    done = ok = fail = 0
    for s in songs:
        sid = s["id"]
        if only and sid not in only:
            continue
        if a.limit and done >= a.limit:
            break
        d = os.path.join(OUT, sid)
        meta_p = os.path.join(d, "meta.json")
        if os.path.exists(meta_p):
            continue  # 断点续跑
        done += 1
        try:
            # 候选查询:去括号短名 → 原名 → 去标点名
            base = re.split(r"[（(]", s["title"])[0].strip()
            cands = [base]
            if s["title"] != base:
                cands.append(s["title"])
            nopunct = re.sub(r"[，,、\s]+", "", base)
            if nopunct != base:
                cands.append(nopunct)
            items, used_q = [], base
            for q in cands:
                items = search_tabs(q)
                it = pick(items, q, s.get("qqsinger") or s.get("artist") or "")
                if it:
                    used_q = q
                    break
            else:
                it = None
            if not it:
                print(f"[{sid}] {s['title']} no image tab found", file=sys.stderr)
                os.makedirs(d, exist_ok=True)
                json.dump({"status": "no-tab"}, open(meta_p, "w", encoding="utf-8"), ensure_ascii=False)
                fail += 1
                continue
            urls = tab_images(it["id"], thumb=it.get("thumb"))[:6]
            if not urls:
                print(f"[{sid}] {s['title']} tab {it['id']} 无谱面图片(可能仅封面)", file=sys.stderr)
                os.makedirs(d, exist_ok=True)
                json.dump({"status": "no-images", "tabId": it["id"]},
                          open(meta_p, "w", encoding="utf-8"), ensure_ascii=False)
                fail += 1
                continue
            os.makedirs(d, exist_ok=True)
            saved = []
            for i, u in enumerate(urls):
                ext = ".png" if u.lower().endswith(".png") else ".jpg"
                p = os.path.join(d, f"img_{i}{ext}")
                if not os.path.exists(p):
                    data = get(u, binary=True, referer=f"{BASE}/tab/{it['id']}/")
                    open(p, "wb").write(data)
                saved.append(os.path.basename(p))
            json.dump({"status": "ok", "tabId": it["id"], "tabTitle": it["title"],
                       "tabArtist": it["artist"], "tags": it["tags"], "images": saved,
                       "source": f"{BASE}/tab/{it['id']}/"},
                      open(meta_p, "w", encoding="utf-8"), ensure_ascii=False, indent=1)
            ok += 1
            print(f"[{sid}] {s['title']} -> tab {it['id']} ({it['artist']}, {'/'.join(it['tags'])}), {len(saved)} imgs", file=sys.stderr)
        except Exception as e:
            fail += 1
            print(f"[{sid}] {s['title']} ERR {e}", file=sys.stderr)
            time.sleep(3)
    print(f"done={done} ok={ok} fail={fail}", file=sys.stderr)


if __name__ == "__main__":
    main()
