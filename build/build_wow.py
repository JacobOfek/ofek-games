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
html body.mp-app>#siteHome#siteHome#siteHome,html body.mp-app>#ofkTheme#ofkTheme#ofkTheme{display:grid!important;position:absolute}  /* sits above the game and scrolls away with the page, so it never covers the turn counter */
body.mp-app{min-height:100%}
body.mp-app #mp-root{padding-top:56px}  /* room for the home button above the frame */
@media (min-width:900px){body.mp-app:not(.sl-wide) #mp-root{max-width:640px}}
/* wide screen and 3D: the same two switches the living-room mode has, for one player */
#wowViews{position:absolute;z-index:2147482000;top:calc(env(safe-area-inset-top,0px) + 8px);right:calc(env(safe-area-inset-right,0px) + 8px);display:flex;gap:8px}
#wowViews button{height:40px;border-radius:12px;border:1px solid #9a7a3a;background:linear-gradient(180deg,#3a2e1e,#1a130b);color:#f2d38a;
 font:600 14px "Assistant",system-ui,sans-serif;padding:0 12px;cursor:pointer;white-space:nowrap}
#wowViews button[aria-pressed="true"]{border-color:#ffd100;color:#ffd100;box-shadow:0 0 8px rgba(255,209,0,.35)}
@media (max-width:759px){#wowViews .w{display:none}}   /* two columns need a wide screen */
html body.mp-app>#wowViews#wowViews#wowViews{display:flex!important}
</style>
<script>
/* site version: single player only. Show just the game screen, full size, the way the web-app mode does. */
(function(){const ph=document.getElementById("s-phone");if(!ph)return;
 const root=document.createElement("div");root.id="mp-root";root.dir="rtl";
 document.body.insertBefore(root,document.body.firstChild);root.appendChild(ph);
 document.body.classList.add("mp-app");
 try{sView="game";renderSheet();}catch(e){}
 const V=document.createElement("div");V.id="wowViews";
 V.innerHTML='<button type="button" class="w" data-v="wide"></button><button type="button" data-v="3d"></button>';
 document.body.appendChild(V);
 const get=(k,d)=>{try{const x=localStorage.getItem(k);return x===null?d:x==="1";}catch(e){return d;}};
 const put=(k,v)=>{try{localStorage.setItem(k,v?"1":"0");}catch(e){}};
 const big=matchMedia("(min-width:760px)");
 const show=()=>{const w=get("wow-solo-wide",false)&&big.matches,t=get("salon-3d",false);   /* wide only where two columns fit */
  document.body.classList.toggle("sl-wide",w);document.body.classList.toggle("td3",t);
  const bw=V.querySelector('[data-v=wide]'),bt=V.querySelector('[data-v="3d"]');
  bw.textContent=w?"📱 מסך צר":"🖥 מסך רחב";bw.setAttribute("aria-pressed",String(w));
  bt.textContent=t?"🧊 תלת־ממד ✓":"🧊 תלת־ממד";bt.setAttribute("aria-pressed",String(t));};
 V.addEventListener("click",e=>{const b=e.target.closest("button");if(!b)return;
  if(b.dataset.v==="wide")put("wow-solo-wide",!get("wow-solo-wide",false));else put("salon-3d",!get("salon-3d",false));
  show();try{renderSheet();}catch(err){}b.blur();});
 show();big.addEventListener?big.addEventListener("change",()=>{show();try{renderSheet();}catch(e){}}):0;})();
</script>
<script src="/ofek.js"></script>
<script>
/* The hero is also kept on the site, under the logged-in player (like the scores of the other games),
   so a cleared browser, a new device or the home-screen app (which on iPhone keeps its own storage)
   all get the same character back. The most recently changed copy wins. */
(function(){
 const K="wow-game-v2",AT="wow-game-at",OWN="wow-owner";
 const get=k=>{try{return localStorage.getItem(k);}catch(e){return null;}};
 const set=(k,v)=>{try{v==null?localStorage.removeItem(k):localStorage.setItem(k,v);}catch(e){}};
 let seen=get(K),me=null,timer=0,sent=null;
 const push=now=>{if(!me)return;clearTimeout(timer);timer=setTimeout(async()=>{const g=get(K);if(!g||g===sent||OFEK.player!==me)return;
  try{await OFEK.api("/api/save?app=wow",{method:"PUT",body:{kv:{[K]:g,[AT]:get(AT)||String(Date.now())}},quiet:true});sent=g;}catch(e){}},now?0:2500);};
 setInterval(()=>{const g=get(K);if(g!==seen){seen=g;set(AT,String(Date.now()));push();}},1500);   // the game saves itself; we notice it
 addEventListener("visibilitychange",()=>{if(document.visibilityState==="hidden")push(true);});
 addEventListener("pagehide",()=>push(true));
 (async()=>{
  if(!window.OFEK||!(await OFEK.ready)||!OFEK.player)return;
  me=OFEK.player;
  let kv={};try{kv=(await OFEK.api("/api/save?app=wow",{quiet:true})).kv||{};}catch(e){me=null;return;}
  const local=get(K),cloud=typeof kv[K]==="string"?kv[K]:null,owner=get(OWN);
  const cloudNewer=cloud&&(!local||(+kv[AT]||0)>(+get(AT)||0));
  if(owner&&owner!==me){set(OWN,me);set(K,cloud);set(AT,cloud?kv[AT]:null);location.reload();return;}   // the hero here was another player's
  set(OWN,me);
  if(cloudNewer&&cloud!==local){set(K,cloud);set(AT,kv[AT]||String(Date.now()));location.reload();return;}
  sent=cloud;if(local&&local!==cloud)push(true);
 })();
})();
</script>
'''
i = s.lower().rfind('</body>')
s = s[:i] + SOLO + s[i:]
with tempfile.NamedTemporaryFile('w', suffix='.html', delete=False, encoding='utf-8') as t:
    t.write(s); tmp = t.name
subprocess.run(['python3', 'build/port_game.py', tmp, 'wow', 'WOW Dungeons', '#0c0a08', 'tl'], check=True)
os.unlink(tmp)
