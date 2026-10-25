#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""从 QQ 音乐抓取「真实」歌曲数据：搜索命中 + 带毫秒时间戳的歌词（LRC）。

产出 tools/gp_songs_raw.json：
  [{ id, title, artist, qqmid, qqname, qqsinger, album, durationSec,
     lyrics:[{time,text}], lyricSource:'qqmusic'|<null> }]

只抓取公开只读的歌词/元数据接口，不做任何登录态或写操作。
网络失败按曲目降级（lyrics=[]），不影响其它曲目。
"""
import json, io, os, re, base64, time, urllib.parse, urllib.request, ssl
from concurrent.futures import ThreadPoolExecutor, as_completed

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
SRC = os.path.join(ROOT, 'tools', 'songs_raw.json')
OUT = os.path.join(ROOT, 'tools', 'gp_songs_raw.json')

UA = ('Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 '
      '(KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36')
HDR = {'User-Agent': UA, 'Referer': 'https://y.qq.com/', 'Accept': '*/*'}
CTX = ssl.create_default_context()
CTX.check_hostname = False
CTX.verify_mode = ssl.CERT_NONE

SEARCH = ('https://c.y.qq.com/soso/fcgi-bin/client_search_cp'
          '?aggr=1&cr=1&flag_qc=0&p=1&n=5&w={q}&format=json')
LYRIC = ('https://c.y.qq.com/lyric/fcgi-bin/fcg_query_lyric_new.fcg'
         '?songmid={mid}&format=json&nobase64=0')


def get_json(url, tries=3, timeout=12):
    for i in range(tries):
        try:
            req = urllib.request.Request(url, headers=HDR)
            with urllib.request.urlopen(req, timeout=timeout, context=CTX) as r:
                return json.loads(r.read().decode('utf-8', 'ignore'))
        except Exception:
            if i == tries - 1:
                return None
            time.sleep(0.6 * (i + 1))
    return None


def norm(s):
    """归一化：去空格/括号内容/大小写，用于标题与歌手模糊匹配"""
    s = re.sub(r'[（(][^）)]*[）)]', '', str(s or ''))
    return re.sub(r'[\s　]+', '', s).lower()


def parse_lrc(text):
    """LRC -> [{time,text}]，按时间升序，丢弃空行与元信息行"""
    out = []
    for line in str(text or '').splitlines():
        for m in re.finditer(r'\[(\d{1,2}):(\d{2})(?:[.:](\d{1,3}))?\]', line):
            mm, ss = int(m.group(1)), int(m.group(2))
            frac = m.group(3) or '0'
            t = mm * 60 + ss + int(frac.ljust(3, '0')[:3]) / 1000.0
            body = line[m.end():].strip()
            if body:
                out.append({'time': round(t, 3), 'text': body})
            break
    out.sort(key=lambda x: x['time'])
    dedup, seen = [], set()
    for it in out:
        k = (round(it['time'], 1), it['text'])
        if k in seen:
            continue
        seen.add(k)
        dedup.append(it)
    return dedup


def pick_best(items, title, artist):
    """在搜索结果里挑最可信的一条：标题相等 > 标题包含；再比歌手"""
    nt, na = norm(title), norm(artist)
    best, best_score = None, -1
    for it in items or []:
        name = it.get('songname') or it.get('name') or ''
        singers = ''.join((s.get('name') or '') for s in (it.get('singer') or []))
        ns, nsg = norm(name), norm(singers)
        score = 0
        if ns == nt:
            score += 10
        elif nt and nt in ns:
            score += 6
        if na and (na in nsg or nsg in na):
            score += 4
        if score > best_score:
            best, best_score = it, score
    return best if best_score > 0 else None


def fetch_one(song):
    title, artist = song.get('title', ''), song.get('artist', '')
    rec = {
        'id': 'gp-song-%03d' % song.get('no', 0),
        'no': song.get('no'),
        'title': title,
        'artist': artist,
        'tier': song.get('tier'),
        'unit': song.get('unit'),
        'duration': song.get('duration'),
        'qqmid': '', 'qqname': '', 'qqsinger': '', 'album': '',
        'lyrics': [], 'lyricSource': None,
    }
    q = urllib.parse.quote(title if not artist else '%s %s' % (title, artist))
    data = get_json(SEARCH.format(q=q))
    try:
        items = (((data or {}).get('data') or {}).get('song') or {}).get('list') or []
    except Exception:
        items = []
    hit = pick_best(items, title, artist)
    if not hit:
        return rec
    mid = hit.get('songmid') or hit.get('mid') or ''
    rec['qqmid'] = mid
    rec['qqname'] = hit.get('songname') or ''
    rec['qqsinger'] = ''.join((s.get('name') or '') for s in (hit.get('singer') or []))
    rec['album'] = hit.get('albumname') or ''
    if mid:
        ld = get_json(LYRIC.format(mid=urllib.parse.quote(mid)))
        b64 = (ld or {}).get('lyric')
        if b64:
            try:
                raw = base64.b64decode(b64).decode('utf-8', 'ignore')
                rec['lyrics'] = parse_lrc(raw)
                rec['lyricSource'] = 'qqmusic'
            except Exception:
                pass
    return rec


def main():
    songs = json.load(io.open(SRC, encoding='utf-8'))
    out = [None] * len(songs)
    # 36 核机器：歌词接口按 IP 限流较温和，12 并发足够且不易被拒
    with ThreadPoolExecutor(max_workers=12) as ex:
        futs = {ex.submit(fetch_one, s): i for i, s in enumerate(songs)}
        done = 0
        for f in as_completed(futs):
            i = futs[f]
            try:
                out[i] = f.result()
            except Exception as e:
                out[i] = {'id': 'gp-song-%03d' % songs[i].get('no', 0), 'error': str(e)}
            done += 1
            if done % 25 == 0:
                print('  ...%d/%d' % (done, len(songs)), flush=True)
    with io.open(OUT, 'w', encoding='utf-8') as fh:
        json.dump(out, fh, ensure_ascii=False)
    got = sum(1 for r in out if r and r.get('lyrics'))
    mid = sum(1 for r in out if r and r.get('qqmid'))
    print('完成：%d 首，命中 QQ 元数据 %d 首，取得真实歌词 %d 首' % (len(out), mid, got))
    print('输出：%s' % OUT)


if __name__ == '__main__':
    main()
