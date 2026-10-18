#!/usr/bin/env python3
"""Keeps every game clear of the iPhone status bar / Dynamic Island and the home indicator when it runs
as a home-screen app (the site uses a see-through status bar, so pages draw underneath it).
Games that were built inside Claude's artifact frame got this spacing from the frame; games whose own
document replaced that frame need it added. Run after all build/port scripts; safe to run again."""
import glob, re

STYLE = ('<style id="siteSafe">/* room for the iPhone status bar and home indicator */'
         'body{box-sizing:border-box;padding-top:env(safe-area-inset-top,0px)!important;'
         'padding-bottom:env(safe-area-inset-bottom,0px)!important}</style>\n')

for p in sorted(glob.glob('site/*/index.html')):
    gid = p.split('/')[1]
    if gid in ('admin', 'help'):
        continue
    s = open(p, encoding='utf-8').read()
    if 'id="siteSafe"' in s:
        print(gid, 'already done'); continue
    # the artifact frame's own rule already pads the page top and bottom
    if re.search(r':root\{[^}]*padding-top:env\(safe-area-inset-top', s):
        print(gid, 'has the frame spacing'); continue
    i = s.lower().find('</head>')
    s = s[:i] + STYLE + s[i:]
    open(p, 'w', encoding='utf-8').write(s)
    print(gid, 'added')
