#!/usr/bin/env python3
"""Adds the light/dark switch (site/theme.js) to the home page, the dashboard and every game.
native = the colours the page already has: "both" (light and dark, keyed on html[data-theme]), "dark" or "light"
(the other mode is made by inverting). Run after the build/port scripts (rebuild_all.py does); safe to run again."""
import re

PAGES = {
    'index': ('both', 'dark'), 'admin': ('both', 'dark'),     # (native, default when the player has not chosen)
    'breakout': ('both', None), 'boom': ('both', None), 'puzzle': ('both', None),
    'blocks': ('dark', None), 'snake': ('dark', None), 'pulse-lanes': ('dark', None), 'wow': ('dark', None),
    'wonders-dice': ('light', None), 'architects': ('light', None),
}
# pages whose title sits where the home and light/dark buttons float
FIX = {'puzzle': '#setup{padding-top:calc(env(safe-area-inset-top,0px) + 58px)}',
       'pulse-lanes': '#menu .wrap{padding-top:calc(env(safe-area-inset-top,0px) + 64px)}.hudl{padding-left:96px}.etop{padding-left:calc(max(12px,env(safe-area-inset-left,0px)) + 100px)!important}'}
for page, (native, default) in PAGES.items():
    p = 'site/index.html' if page == 'index' else f'site/{page}/index.html'
    s = open(p, encoding='utf-8').read()
    s = re.sub(r'<script src="/theme\.js"[^>]*></script>\n?', '', s)
    tag = f'<script src="/theme.js" data-native="{native}"' + (f' data-default="{default}"' if default else '') + '></script>\n'
    m = re.search(r'<head[^>]*>', s, re.I)
    assert m, p
    s = re.sub(r'<style id="themeFix">.*?</style>\n?', '', s, flags=re.S)
    if page in FIX: tag += f'<style id="themeFix">{FIX[page]}</style>\n'
    s = s[:m.end()] + tag + s[m.end():]
    open(p, 'w', encoding='utf-8').write(s)
    print(page, native)
