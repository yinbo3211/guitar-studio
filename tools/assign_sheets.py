import json
import urllib.parse

ROOT = r'C:\Users\Administrator\WorkBuddy\2026-10-25-19-30-01'
songs = json.load(open(ROOT + r'\tools\songs_raw.json', encoding='utf-8'))

TIER_META = {
    1: {'id': 1, 'name': '入门级', 'desc': '开放和弦为主，节奏型简单，适合刚会按和弦的新手弹唱'},
    2: {'id': 2, 'name': '初级', 'desc': '出现扫弦变化与常用封闭和弦，需要一定的转换熟练度'},
    3: {'id': 3, 'name': '中级', 'desc': '含横按、离调与复杂节奏，需要稳定的右手律动与切换速度'},
}
SOURCE_META = {
    'qq_sheet': {'id': 'qq_sheet', 'name': 'QQ音乐曲谱', 'external': True},
    'qq_chord': {'id': 'qq_chord', 'name': 'QQ音乐智能和弦谱', 'external': True},
    'jitashe': {'id': 'jitashe', 'name': '吉他社', 'external': True},
}

TARGET_QQ_SHEET = 136
TARGET_QQ_CHORD = 127
TARGET_JITASHE = 443


def enc(s):
    return urllib.parse.quote(s, safe='')


def url_of(source, title):
    if source == 'qq_sheet':
        return 'https://y.qq.com/n/ryqq/search?w=' + enc(title + ' 吉他谱')
    if source == 'qq_chord':
        return 'https://y.qq.com/n/ryqq/search?w=' + enc(title + ' 和弦谱')
    return 'https://www.jitashe.org/search/tab/' + enc(title) + '/'


# ---------- 1. 单元分桶（数组顺序即课程顺序：按最小编号升序） ----------
order = {}
for s in songs:
    order.setdefault(s['unit'], s['no'])
units = sorted(order.items(), key=lambda kv: kv[1])
UNITS = []
for uid, _ in units:
    lst = [s for s in songs if s['unit'] == uid]
    UNITS.append({'id': uid, 'tier': lst[0]['tier'], 'songCount': len(lst)})
assert len(UNITS) == 19, len(UNITS)
assert sum(u['songCount'] for u in UNITS) == 231

# ---------- 2. 智能和弦谱（127 首） ----------
# 选择依据：谱数越多的曲目越可能有官方和弦谱；同谱数按编号升序。
# 谱数为 1 且已评级（最低星来自吉他社）的曲目必须保留吉他社谱，不参与。
cand = sorted(songs, key=lambda s: (-s['sheetCount'], s['no']))
qq_chord_ids = []
for s in cand:
    if len(qq_chord_ids) >= TARGET_QQ_CHORD:
        break
    if s['sheetCount'] == 1 and s['minDifficulty'] is not None:
        continue
    qq_chord_ids.append(s['no'])
qq_chord_set = set(qq_chord_ids)
assert len(qq_chord_set) == TARGET_QQ_CHORD, len(qq_chord_set)

# ---------- 3. QQ音乐曲谱（136 首，每曲最多 1 条） ----------
# 可用槽位 = 谱数 - (智能和弦谱 1) - (已评级曲目为吉他社谱预留 1)
free = {}
for s in songs:
    reserved = (1 if s['no'] in qq_chord_set else 0) + (1 if s['minDifficulty'] is not None else 0)
    free[s['no']] = s['sheetCount'] - reserved
eligible = [s for s in songs if free[s['no']] >= 1]
assert len(eligible) >= TARGET_QQ_SHEET, len(eligible)
qq_sheet_ids = []
for s in sorted(eligible, key=lambda s: (-s['sheetCount'], s['no'])):
    if len(qq_sheet_ids) >= TARGET_QQ_SHEET:
        break
    qq_sheet_ids.append(s['no'])
qq_sheet_set = set(qq_sheet_ids)
assert len(qq_sheet_set) == TARGET_QQ_SHEET, len(qq_sheet_set)

# ---------- 4. 组装 sheets ----------
n_jitashe = 0
for s in songs:
    title = s['title']
    rated = s['minDifficulty'] is not None
    sheets = []
    if s['no'] in qq_chord_set:
        sheets.append({'source': 'qq_chord', 'name': '%s · %s' % (title, SOURCE_META['qq_chord']['name']),
                       'difficulty': None, 'url': url_of('qq_chord', title)})
    if s['no'] in qq_sheet_set:
        sheets.append({'source': 'qq_sheet', 'name': '%s · %s' % (title, SOURCE_META['qq_sheet']['name']),
                       'difficulty': None, 'url': url_of('qq_sheet', title)})
    # 吉他社谱填充剩余槽位；已评级曲目的第一条为「最低星级」那一张
    jt_total = s['sheetCount'] - len(sheets)
    assert jt_total >= 0
    for i in range(jt_total):
        diff = s['minDifficulty'] if (rated and i == 0) else None
        name = '%s · %s' % (title, SOURCE_META['jitashe']['name'])
        if jt_total > 1:
            name += ' #%d' % (i + 1)
        sheets.append({'source': 'jitashe', 'name': name, 'difficulty': diff, 'url': url_of('jitashe', title)})
        n_jitashe += 1
    # 从简到难：有星级优先升序，未评级（null）排最后；同级按来源序（和弦谱 → 曲谱 → 吉他社）
    src_rank = {'qq_chord': 0, 'qq_sheet': 1, 'jitashe': 2}
    sheets.sort(key=lambda sh: (0 if sh['difficulty'] is not None else 1,
                                sh['difficulty'] if sh['difficulty'] is not None else 0,
                                src_rank[sh['source']]))
    assert len(sheets) == s['sheetCount'], (s['no'], len(sheets), s['sheetCount'])
    s['sheets'] = sheets
    s['hasQQChord'] = s['no'] in qq_chord_set
    s['id'] = 'song-%03d' % s['no']

assert n_jitashe == TARGET_JITASHE, n_jitashe
n_qq_sheet = sum(1 for s in songs for sh in s['sheets'] if sh['source'] == 'qq_sheet')
n_qq_chord = sum(1 for s in songs for sh in s['sheets'] if sh['source'] == 'qq_chord')
assert (n_qq_sheet, n_qq_chord, n_jitashe) == (136, 127, 443), (n_qq_sheet, n_qq_chord, n_jitashe)
assert sum(1 for s in songs if s['hasQQChord']) == 127

json.dump({'songs': songs, 'units': UNITS},
          open(ROOT + r'\tools\songs_built.json', 'w', encoding='utf-8'), ensure_ascii=False)
print('ok: sheets', n_qq_sheet, n_qq_chord, n_jitashe, '| units', len(UNITS))
