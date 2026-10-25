import json, re, io, os

MD = r'C:\Users\Administrator\Desktop\六弦工坊V4.0需求手册.md'
src = open(MD, encoding='utf-8').read()

rows = []
for line in src.splitlines():
    line = line.strip()
    if not line.startswith('|'):
        continue
    cells = [c.strip() for c in line.strip('|').split('|')]
    if len(cells) < 9:
        continue
    if not re.fullmatch(r'\d+', cells[0]):
        continue
    if not re.fullmatch(r'\d{2}:\d{2}', cells[3]):
        continue
    rows.append(cells)

print('rows:', len(rows))
TIER = {'入门': 1, '初级': 2, '中级': 3}
songs = []
for c in rows:
    no = int(c[0])
    title, artist, dur = c[1], c[2], c[3]
    tier = TIER[c[4]]
    unit = c[5]
    mind = None if c[6] in ('—', '-', '') else int(c[6])
    sheetCount = int(c[7])
    note = c[8] if len(c) > 8 else ''
    songs.append(dict(no=no, title=title, artist=artist, duration=dur, tier=tier,
                      unit=unit, minDifficulty=mind, sheetCount=sheetCount, note=note))

print('total sheetCount sum:', sum(s['sheetCount'] for s in songs))
from collections import Counter
print('tier dist:', Counter(s['tier'] for s in songs))
print('units:', Counter(s['unit'] for s in songs))
print('rated(minDifficulty not null):', sum(1 for s in songs if s['minDifficulty'] is not None))
print('has note:', sum(1 for s in songs if s['note']))
print('no continuous:', songs[0]['no'] == 1 and songs[-1]['no'] == 231 and
      all(songs[i]['no'] == i + 1 for i in range(len(songs))))
print('dup titles:', [t for t, n in Counter(s['title'] for s in songs).items() if n > 1][:10])
print('sheetCount>=2:', sum(1 for s in songs if s['sheetCount'] >= 2))
json.dump(songs, open(r'C:\Users\Administrator\WorkBuddy\2026-10-25-19-30-01\tools\songs_raw.json', 'w', encoding='utf-8'), ensure_ascii=False, indent=1)
print('sample:', songs[0], songs[198])
