#!/usr/bin/env python3
"""Rebuilds every game on the site from the latest artifact sources, in one go.
usage: python3 build/rebuild_all.py SOURCES_DIR
SOURCES_DIR holds one folder per artifact id (the folder name starts with the id) with that artifact's index.html.
Run from the repository root. Afterwards: bump the cache name in site/sw.js, test, commit and push."""
import glob, re, subprocess, sys

SRC = sys.argv[1]
def src(prefix):
    m = glob.glob(f'{SRC}/{prefix}*/index.html')
    assert m, 'missing source for ' + prefix
    return m[0]
def run(*a):
    print('$', ' '.join(a)); subprocess.run(['python3', *a], check=True)

# games with family tables (own build scripts), then their home buttons
run('build/build_breakout.py', src('2744f6f7'))
run('build/build_blocks.py', src('5b7d44fc'))
run('build/build_snake.py', src('29d35e54'))
run('build/add_home.py')
# games ported as they are: id, name, theme colour, corner of the home button
for pre, gid, name, theme, corner in [
        ('6a564d9e', 'pulse-lanes', 'Pulse Lanes', '#140f22', 'tl'),
        ('62ad8e35', 'boom', 'Boom Boom Boom', '#131923', 'tl'),
        ('6c6aab05', 'wonders-dice', 'Wonders Dice', '#EBDDBF', 'tr'),
        ('641388e8', 'architects', '7 Wonders Architects', '#EBDDBF', 'tr'),
        ('5b0d7646', 'puzzle', 'פאזל', '#1E1B29', 'tl')]:
    run('build/port_game.py', src(pre), gid, name, theme, corner)
# puzzle: the photo collection lives in Claude, so explain what the site does instead
p = 'site/puzzle/index.html'; s = open(p, encoding='utf-8').read()
s, n = re.subn(r"(\$\('colNote'\)\.textContent=')[^']*(';return;\})",
               r"\1באתר התמונות שלך לא נשמרות באוסף. בוחרים תמונה מהמכשיר או מקום מהרשימה, ומשחקים.\2", s, count=1)
assert n == 1, 'puzzle notice not found'; open(p, 'w', encoding='utf-8').write(s)
# WOW Dungeons: the single-player game only
run('build/build_wow.py', src('d4fa7e79'))
run('build/safe_area.py')
