#!/usr/bin/env python3
"""Builds site/wow (WOW Dungeons, single player only) from the "WOW Dungeon Game" artifact.
The artifact is the planning book plus the game; in Claude it also runs the living-room mode
(TV + iPads through Claude rooms and Google Drive), which cannot run on the site.
Here the living-room mode stays off, so the phone game plays alone with its own dungeon master,
and the page shows only the game screen, full size. The character is saved on the device.
usage: python3 build/build_wow.py SOURCE.html   (run from the repository root)"""
import os, subprocess, sys, tempfile

s = open(sys.argv[1], encoding='utf-8').read()
for tag in ['<script>window.WOW_SALON=1</script>',
            '<script src="https://cdnjs.cloudflare.com/ajax/libs/qrcodejs/1.0.0/qrcode.min.js"></script>']:
    assert tag in s, 'not found: ' + tag
    s = s.replace(tag, '', 1)

# the start screen says "sample game" (it began as a demo inside the planning book)
a = '<div class="ph-sub">משחק לדוגמה</div>'
assert s.count(a) == 1, 'subtitle not found'
s = s.replace(a, '<div class="ph-sub">משחק יחיד</div>')

SOLO = '''
<style id="wowSolo">
/* beats the game rule that hides everything outside the game screen */
html body.mp-app>#siteHome#siteHome#siteHome{display:grid!important;position:absolute}  /* sits above the game and scrolls away with the page, so it never covers the turn counter */
body.mp-app{min-height:100%}
body.mp-app #mp-root{padding-top:56px}  /* room for the home button above the frame */
@media (min-width:900px){body.mp-app #mp-root{max-width:640px}}
</style>
<script>
/* site version: single player only. Show just the game screen, full size, the way the web-app mode does. */
(function(){const ph=document.getElementById("s-phone");if(!ph)return;
 const root=document.createElement("div");root.id="mp-root";root.dir="rtl";
 document.body.insertBefore(root,document.body.firstChild);root.appendChild(ph);
 document.body.classList.add("mp-app");
 try{sView="game";renderSheet();}catch(e){}})();
</script>
'''
i = s.lower().rfind('</body>')
s = s[:i] + SOLO + s[i:]
with tempfile.NamedTemporaryFile('w', suffix='.html', delete=False, encoding='utf-8') as t:
    t.write(s); tmp = t.name
subprocess.run(['python3', 'build/port_game.py', tmp, 'wow', 'WOW Dungeons', '#0c0a08', 'tl'], check=True)
os.unlink(tmp)
