#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""把抓取到的真实歌曲数据编译成 assets/js/gp/songs.js（GuitarPicker 曲库）。

数据来源与口径（全部写进产物 provenance，可审计）：
  · 曲名 / 演唱者 / 时长 / 单元 / 层级 —— 需求手册附录 A（231 首）
  · 歌词与逐行毫秒时间戳 —— QQ 音乐歌词接口（真实抓取，lyricSource='qqmusic'）
  · 和弦进行 —— 公有领域/不可版权化的和声模板（harmony.source='template'）
  · 公有领域旋律曲目 —— 传统民歌/儿歌，人工记谱（melodySource='public-domain'）
歌词里的「词：/曲：/编曲：」等制作信息与标题行会被剔除。
"""
import json, io, os, re, hashlib

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
SRC = os.path.join(ROOT, 'tools', 'gp_songs_raw.json')
OUT = os.path.join(ROOT, 'assets', 'js', 'gp', 'songs.js')

# 和声模板（音级 -> 和弦），均为通用和声进行，非具体作品的和声编配
PROGRESSIONS = [
    ('1-5-6-3-4-1-4-5', [(0, 'maj'), (7, 'maj'), (9, 'min'), (4, 'min'), (5, 'maj'), (0, 'maj'), (5, 'maj'), (7, 'maj')]),
    ('1-6-4-5', [(0, 'maj'), (9, 'min'), (5, 'maj'), (7, 'maj')]),
    ('4-5-3-6-2-5-1', [(5, 'maj'), (7, 'maj'), (4, 'min'), (9, 'min'), (2, 'min'), (7, 'maj'), (0, 'maj')]),
    ('6-4-1-5', [(9, 'min'), (5, 'maj'), (0, 'maj'), (7, 'maj')]),
    ('1-5-6-4', [(0, 'maj'), (7, 'maj'), (9, 'min'), (5, 'maj')]),
    ('1-4-5-1', [(0, 'maj'), (5, 'maj'), (7, 'maj'), (0, 'maj')]),
    ('1-6-2-5', [(0, 'maj'), (9, 'min'), (2, 'min'), (7, 'maj')]),
    ('4-3-2-5', [(5, 'maj'), (4, 'min'), (2, 'min'), (7, 'maj')]),
    ('6-5-4-5', [(9, 'min'), (7, 'maj'), (5, 'maj'), (7, 'maj')]),
    ('1-3-4-5', [(0, 'maj'), (4, 'min'), (5, 'maj'), (7, 'maj')]),
    ('5-6-4-1', [(7, 'maj'), (9, 'min'), (5, 'maj'), (0, 'maj')]),
    ('1-4-6-5', [(0, 'maj'), (5, 'maj'), (9, 'min'), (7, 'maj')]),
]
BG = ['aurora', 'waves', 'starfield', 'pulse']

# 公有领域 / 传统曲目：真实旋律，人工记谱（与 GuitarPicker 内置曲同口径）
PD_MELODIES = [
    dict(id='pd-twinkle', title='小星星 · Twinkle, Twinkle, Little Star', artist='Trad.',
         key='C', bpm=100, difficulty='beginner', genre="Children's", bg='starfield',
         melody="C4:1 C4:1 G4:1 G4:1 A4:1 A4:1 G4:2 F4:1 F4:1 E4:1 E4:1 D4:1 D4:1 C4:2 "
                "G4:1 G4:1 F4:1 F4:1 E4:1 E4:1 D4:2 G4:1 G4:1 F4:1 F4:1 E4:1 E4:1 D4:2 "
                "C4:1 C4:1 G4:1 G4:1 A4:1 A4:1 G4:2 F4:1 F4:1 E4:1 E4:1 D4:1 D4:1 C4:2",
         lyrics=[(0.0, 'Twinkle, twinkle, little star'), (4.8, 'How I wonder what you are'),
                 (9.6, 'Up above the world so high'), (14.4, 'Like a diamond in the sky')]),
    dict(id='pd-ode', title='欢乐颂 · Ode to Joy', artist='Beethoven',
         key='C', bpm=120, difficulty='beginner', genre='Classical', bg='aurora',
         melody="E4:1 E4:1 F4:1 G4:1 G4:1 F4:1 E4:1 D4:1 C4:1 C4:1 D4:1 E4:1 E4:1.5 D4:0.5 D4:2 "
                "E4:1 E4:1 F4:1 G4:1 G4:1 F4:1 E4:1 D4:1 C4:1 C4:1 D4:1 E4:1 D4:1.5 C4:0.5 C4:2",
         lyrics=[(0.0, '欢乐颂 · Ode to Joy')]),
    dict(id='pd-auld', title='友谊地久天长 · Auld Lang Syne', artist='Trad. / Burns',
         key='C', bpm=90, difficulty='beginner', genre='Folk', bg='waves',
         melody="G3:1 C4:1.5 B3:0.5 C4:1 E4:1 D4:1.5 C4:0.5 D4:1 E4:1 C4:1.5 C4:0.5 E4:1 G4:1 A4:3 "
                "A4:1 G4:1.5 E4:0.5 E4:1 C4:1 D4:1.5 C4:0.5 D4:1 E4:1 C4:1.5 A3:0.5 A3:1 G3:1 C4:3",
         lyrics=[(0.0, '怎能忘记旧日朋友'), (4.0, '心中能不怀想')]),
    dict(id='pd-jasmine', title='茉莉花 · Jasmine Flower', artist='Trad. (中国民歌)',
         key='C', bpm=76, difficulty='beginner', genre='World', bg='aurora',
         melody="E4:1 E4:1 G4:1 A4:1 C5:1 C5:1 A4:1 G4:1 G4:1 A4:1 G4:1 E4:1 D4:1 D4:1 E4:2 "
                "E4:1 E4:1 G4:1 A4:1 C5:1 C5:1 A4:1 G4:1 G4:1 A4:1 G4:1 E4:1 D4:1 C4:1 C4:2",
         lyrics=[(0.0, '好一朵美丽的茉莉花'), (3.2, '芬芳美丽满枝芽')]),
    dict(id='pd-songbie', title='送别（旋律版）· Farewell', artist='J.P. Ordway / 李叔同',
         key='C', bpm=72, difficulty='beginner', genre='Folk', bg='waves',
         melody="G4:1 E4:0.5 G4:0.5 A4:1 G4:1 E4:2 C4:1 D4:1 E4:2 D4:2 "
                "G4:1 E4:0.5 G4:0.5 A4:1 G4:1 E4:2 C4:1 D4:1 E4:1 D4:1 C4:2",
         lyrics=[(0.0, '长亭外 古道边 芳草碧连天'), (6.0, '晚风拂柳笛声残 夕阳山外山')]),
]

META_RE = re.compile(r'^\s*(?:词|曲|编曲|制作人|制作|专辑|歌手|演唱|录音|混音|吉他|钢琴|和声|监制|OP|SP|出品)\s*[:：]')
TITLE_RE = re.compile(r'^\s*.+\s+-\s+.+\s*$')


def clean_lyrics(items, title):
    out = []
    for it in items or []:
        txt = (it.get('text') or '').strip()
        if not txt:
            continue
        if META_RE.match(txt):
            continue
        # 「歌名 - 歌手」这类 QQ 歌词头部
        if TITLE_RE.match(txt) and title and title[:2] in txt:
            continue
        out.append({'time': round(float(it.get('time') or 0), 3), 'text': txt})
    return out


def dur_sec(s):
    try:
        m, sec = str(s or '0:00').split(':')[:2]
        return int(m) * 60 + int(sec)
    except Exception:
        return 0


def pick_progression(idx):
    return PROGRESSIONS[idx % len(PROGRESSIONS)]


def main():
    raw = json.load(io.open(SRC, encoding='utf-8'))
    chord_songs, melody_songs = [], []
    stats = {'lyrics': 0, 'total': 0}

    for i, r in enumerate(raw):
        if not r or not r.get('title'):
            continue
        stats['total'] += 1
        lyrics = clean_lyrics(r.get('lyrics'), r.get('title'))
        if lyrics:
            stats['lyrics'] += 1
        pname, prog = pick_progression(i)
        ds = dur_sec(r.get('duration'))
        # BPM 无公开接口来源：按层级给一个稳定估计值，并在产物里标注来源
        bpm = {1: 76, 2: 88, 3: 96}.get(r.get('tier') or 1, 80)
        chord_songs.append({
            'id': r['id'],
            'no': r.get('no'),
            'title': r['title'],
            'artist': r.get('artist') or 'Unknown',
            'qqname': r.get('qqname') or '',
            'qqsinger': r.get('qqsinger') or '',
            'album': r.get('album') or '',
            'key': 'C', 'capo': 0, 'bpm': bpm,
            'tier': r.get('tier'), 'unit': r.get('unit'),
            'duration': r.get('duration'),
            'difficulty': {1: 'beginner', 2: 'intermediate', 3: 'advanced'}.get(r.get('tier') or 1, 'beginner'),
            'genre': 'Pop',
            'harmony': {'source': 'template', 'name': pname, 'chords': [[pc, t] for pc, t in prog]},
            'pattern': '4-per-bar',
            'durationSec': ds,
            'lyrics': lyrics,
            'lyricSource': r.get('lyricSource'),
            'background': {'type': 'animated', 'value': BG[i % len(BG)]},
        })

    for m in PD_MELODIES:
        melody_songs.append({
            'id': m['id'], 'title': m['title'], 'artist': m['artist'],
            'key': m['key'], 'capo': 0, 'bpm': m['bpm'],
            'difficulty': m['difficulty'], 'genre': m['genre'],
            'melody': m['melody'], 'melodySource': 'public-domain',
            'lyrics': [{'time': t, 'text': x} for t, x in m['lyrics']],
            'background': {'type': 'animated', 'value': m['bg']},
        })

    # V4.2: OMR 真实谱面计数（omr-notes.js 由 build_gp_omr.py 先生成）
    omr_count = 0
    omr_js = os.path.join(ROOT, 'assets', 'js', 'gp', 'omr-notes.js')
    if os.path.exists(omr_js):
        omr_count = len(re.findall(r'"gp-song-\d+":', io.open(omr_js, encoding='utf-8').read()))

    prov = {
        'generatedBy': 'tools/build_gp_songs.py',
        'catalogSource': '需求手册附录 A（231 首）',
        'lyricSource': 'QQ 音乐歌词接口（真实抓取，含毫秒时间戳）',
        'harmonySource': '通用和声模板（不可版权化的和声进行，非原曲编配）',
        'melodySource': '公有领域 / 传统曲目人工记谱',
        'omrSource': '吉他社图片谱 OMR 光学识别（tools/omr_tab.py，仅供学习使用）' if omr_count else None,
        'bpmSource': '按难度层级估计（QQ 音乐未提供公开 BPM 接口）',
        'counts': {
            'chordSongs': len(chord_songs),
            'melodySongs': len(melody_songs),
            'withRealLyrics': stats['lyrics'],
            'omrSongs': omr_count,
        },
    }

    def js(o):
        return json.dumps(o, ensure_ascii=False, separators=(',', ':'))

    with io.open(OUT, 'w', encoding='utf-8') as fh:
        fh.write('/* ============================================================\n')
        fh.write('   六弦工坊 V4.1 · 弹唱曲库数据（GuitarPicker note-highway 曲库）\n')
        fh.write('   ------------------------------------------------------------\n')
        fh.write('   本文件由 tools/build_gp_songs.py 生成，请勿手工编辑。\n')
        fh.write('   歌词为 QQ 音乐真实抓取（含毫秒时间戳）；和弦进行为通用和声模板；\n')
        fh.write('   公有领域曲目为人工记谱的真实旋律。详见 GP_PROVENANCE。\n')
        fh.write('   ============================================================ */\n')
        fh.write("'use strict';\n\n")
        fh.write('export const GP_PROVENANCE = %s;\n\n' % js(prov))
        fh.write('export const GP_CHORD_SONGS = %s;\n\n' % js(chord_songs))
        fh.write('export const GP_MELODY_SONGS = %s;\n\n' % js(melody_songs))
        fh.write('export default { GP_PROVENANCE, GP_CHORD_SONGS, GP_MELODY_SONGS };\n')

    print('和弦弹唱曲目：%d（含真实歌词 %d）' % (len(chord_songs), stats['lyrics']))
    print('公有领域旋律曲目：%d' % len(melody_songs))
    print('输出：%s' % OUT)


if __name__ == '__main__':
    main()
