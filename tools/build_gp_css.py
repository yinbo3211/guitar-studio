#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""把 GuitarPicker 的样式编译成 assets/css/gp.css（全部收敛进 .gp-scope）。

为什么必须收敛：宿主（六弦工坊）与 GuitarPicker 都用 --bg / --text /
--accent 这类变量名，若把 GuitarPicker 的 :root 块全局应用，会覆盖宿主
的深色主题令牌，导致整站配色错乱。因此：
  · 删除 GuitarPicker 的 :root 全局块，把变量定义搬进 .gp-scope；
  · 顶层选择器一律加 `.gp-scope ` 前缀（@keyframes / @font-face 内部不动）。

上一版脚本按行正则改写，遇到「注释行 + 选择器」会把两者拆开，
导致 .play-shell 等关键选择器漏加前缀、注释被污染 —— 本版改为
先剥离注释再按花括号做块级解析，避免同类问题再次发生。
"""
import io, os, re

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
GP = r'C:/Users/Administrator/WorkBuddy/_re/GuitarPicker/styles'
MAIN = os.path.join(GP, 'main.css')
THEMES = os.path.join(GP, 'themes.css')
OUT = os.path.join(ROOT, 'assets', 'css', 'gp.css')

HEADER = """/* ============================================================
   六弦工坊 V4.1 · 弹唱演奏视图样式（移植自 GuitarPicker，MIT）
   ------------------------------------------------------------
   由 tools/build_gp_css.py 生成，请勿手工编辑。

   收敛规则：全部选择器带 `.gp-scope ` 前缀，变量定义挂在 .gp-scope 上，
   与宿主 --bg / --text / --accent 等令牌隔离；默认使用 GuitarPicker 的
   midnight 主题，以保证与 https://adervec.github.io/GuitarPicker 一致。

   宿主侧必须给演奏根容器加 class="gp-scope"，否则样式不生效
   （见 assets/js/modules/song-play.js）。
   ============================================================ */
"""


def strip_comments(css):
    """去掉注释，返回 (无注释 css, 注释列表)——避免注释里的 '{' 干扰分块"""
    out, comments = [], []

    def repl(m):
        comments.append(m.group(0))
        return '\n'
    css = re.sub(r'/\*[\s\S]*?\*/', repl, css)
    return css, comments


def scope_css(css):
    """按花括号块级解析：仅给顶层（深度 0）选择器加 .gp-scope 前缀。
       注意：块体要整段累积，不能逐字符入列再 join（会把 CSS 拆成每行一个字符）。"""
    out = []
    depth = 0
    sel = ''
    body = ''
    i, n = 0, len(css)

    def flush_body():
        nonlocal body
        if body.strip():
            out.append(body.strip('\n'))
        body = ''

    while i < n:
        ch = css[i]
        # 注释：整段原样输出（深度 0 时不能并进选择器）
        if ch == '/' and i + 1 < n and css[i + 1] == '*':
            j = css.find('*/', i + 2)
            j = n if j < 0 else j + 2
            if depth == 0:
                sel = sel.strip()
                if sel:
                    out.append(sel)
                    sel = ''
                out.append(css[i:j])
            else:
                body += css[i:j]
            i = j
            continue
        if ch == '{':
            s = sel.strip()
            if depth == 0 and s and not s.startswith('@'):
                parts = [p.strip() for p in s.split(',') if p.strip()]
                s = ', '.join(('.gp-scope ' + p) if not p.startswith('.gp-scope') else p for p in parts)
            out.append((s + ' {').strip())
            sel = ''
            depth += 1
            i += 1
            continue
        if ch == '}':
            flush_body()
            depth = max(0, depth - 1)
            out.append('}')
            i += 1
            continue
        if depth == 0:
            sel += ch
        else:
            body += ch
        i += 1
    flush_body()
    if sel.strip():
        out.append(sel.strip())
    return '\n'.join(x for x in out if x != '')


def build_theme_block(themes_css):
    """:root + midnight 两个变量块合并进 .gp-scope"""
    blocks = re.findall(r'(?::root|\[data-theme="midnight"\])\s*\{([^}]*)\}', themes_css)
    merged = '\n'.join(b.strip() for b in blocks if b.strip())
    return '.gp-scope {\n' + merged + '\n}\n'


def main():
    main_css = io.open(MAIN, encoding='utf-8').read()
    themes_css = io.open(THEMES, encoding='utf-8').read()
    scoped = scope_css(main_css)
    buf = [HEADER, build_theme_block(themes_css), scoped]
    io.open(OUT, 'w', encoding='utf-8').write('\n'.join(buf))

    # 自检：关键选择器必须带前缀
    check = io.open(OUT, encoding='utf-8').read()
    must = ['.gp-scope .play-shell ', '.gp-scope .play-stage ', '.gp-scope .play-hud',
            '.gp-scope .play-controls', '.gp-scope .healthbar-big', '.gp-scope .killfeed',
            '.gp-scope .lyric-line', '.gp-scope .hud-box', '.gp-scope .play-overlay']
    missing = [m for m in must if m not in check]
    bare = re.findall(r'^(?:\.play-|\.killfeed|\.hud-box)', check, flags=re.M)
    print('gp.css 已生成：%d 字节' % os.path.getsize(OUT))
    print('缺失关键选择器：', missing or '无')
    print('未收敛的裸选择器：', bare or '无')
    if missing or bare:
        raise SystemExit(1)


if __name__ == '__main__':
    main()
