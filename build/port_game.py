#!/usr/bin/env python3
"""Ports a self-contained game artifact to the site, without changing how the game plays:
home-screen app tags + manifest, the site icon, offline support, and a floating home button
that returns to the games home page (games here save on their own as you play).
usage: python3 build/port_game.py SOURCE.html ID "Name" THEME_COLOR [corner]
       corner: tl | tr | bl | br  (where the home button sits; default tl)
Run from the repository root; writes site/ID/index.html and site/ID/manifest.webmanifest."""
import json, os, re, sys

src_path, gid, name, theme = sys.argv[1:5]
corner = sys.argv[5] if len(sys.argv) > 5 else 'tl'
s = open(src_path, encoding='utf-8').read()
starts = [m.start() for m in re.finditer(r'<!doctype html>', s, re.I)]
if len(starts) > 1:                       # drop the artifact service wrapper around the game's own document
    s = s[starts[1]:]
    s = s[:s.lower().rfind('</html>') + 7]
elif not starts:                          # a body-only artifact: give it a document
    s = ('<!doctype html><html lang="he" dir="rtl"><head><meta charset="utf-8">'
         '<meta name="viewport" content="width=device-width,initial-scale=1,viewport-fit=cover"></head><body>\n'
         + s + '\n</body></html>')

head_add = f'''<link rel="manifest" href="/{gid}/manifest.webmanifest">
<link rel="apple-touch-icon" href="/icons/{gid}-180.png">
<meta name="apple-mobile-web-app-capable" content="yes">
<meta name="mobile-web-app-capable" content="yes">
<meta name="apple-mobile-web-app-status-bar-style" content="black-translucent">
<meta name="apple-mobile-web-app-title" content="{name}">
<meta name="theme-color" content="{theme}">
'''
i = s.lower().find('</head>')
assert i > 0, 'no </head>'
s = s[:i] + head_add + s[i:]

v, h = ('top', 'left') if corner == 'tl' else ('top', 'right') if corner == 'tr' else ('bottom', 'left') if corner == 'bl' else ('bottom', 'right')
home = f'''
<style>
#siteHome{{position:fixed;{v}:calc(env(safe-area-inset-{v},0px) + 8px);{h}:calc(env(safe-area-inset-{h},0px) + 8px);z-index:2147482000;
 width:40px;height:40px;border-radius:12px;border:1px solid rgba(255,255,255,.25);background:rgba(16,18,24,.55);color:#fff;
 display:grid;place-items:center;padding:0;cursor:pointer;-webkit-backdrop-filter:blur(6px);backdrop-filter:blur(6px);opacity:.8}}
#siteHome:hover,#siteHome:focus-visible{{opacity:1}}
#siteHome svg{{width:21px;height:21px}}
</style>
<button id="siteHome" type="button" aria-label="מסך הבית" title="מסך הבית"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"><path d="M3 11.5 12 4l9 7.5"/><path d="M5.5 10v10h13V10"/><path d="M10 20v-5.5h4V20"/></svg></button>
<script>
(()=>{{const b=document.getElementById('siteHome');
 ['pointerdown','touchstart','mousedown'].forEach(t=>b.addEventListener(t,e=>e.stopPropagation(),{{passive:true}}));
 b.addEventListener('click',e=>{{e.preventDefault();e.stopPropagation();
  location.href='/';}});   // leaving the page fires the games' own save-on-exit handlers
 if('serviceWorker' in navigator&&location.protocol==='https:')navigator.serviceWorker.register('/sw.js').catch(()=>{{}});
}})();
</script>
'''
j = s.lower().rfind('</body>')
assert j > 0, 'no </body>'
s = s[:j] + home + s[j:]

os.makedirs(f'site/{gid}', exist_ok=True)
open(f'site/{gid}/index.html', 'w', encoding='utf-8').write(s)
json.dump({
    "name": name, "short_name": name, "lang": "he", "dir": "rtl",
    "start_url": f"/{gid}/", "scope": f"/{gid}/",
    "display": "fullscreen", "display_override": ["fullscreen", "standalone"],
    "background_color": theme, "theme_color": theme,
    "icons": [{"src": f"/icons/{gid}-192.png", "sizes": "192x192", "type": "image/png"},
              {"src": f"/icons/{gid}-512.png", "sizes": "512x512", "type": "image/png"},
              {"src": f"/icons/{gid}-512.png", "sizes": "512x512", "type": "image/png", "purpose": "maskable"}],
}, open(f'site/{gid}/manifest.webmanifest', 'w', encoding='utf-8'), ensure_ascii=False, indent=1)
print('ok', gid, len(s))
