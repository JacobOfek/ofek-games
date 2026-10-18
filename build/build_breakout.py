#!/usr/bin/env python3
"""Builds site/breakout/index.html (the Cloudflare version) from the published artifact source.
usage: python3 build.py SOURCE.html"""
import re, sys
src = open(sys.argv[1], encoding='utf-8').read()
starts = [m.start() for m in re.finditer(r'<!doctype html>', src, re.I)]
if len(starts) > 1:  # drop the artifact service wrapper
    src = src[starts[1]:]
    src = src[:src.lower().rfind('</html>') + 7]
s = src

def rep(a, b, count=1):
    global s
    n = s.count(a)
    assert n == count, (n, a[:80])
    s = s.replace(a, b)

# ---- home screen / app tags
rep('<title>שובר אריחים</title>', '''<title>שובר אריחים</title>
<link rel="manifest" href="manifest.webmanifest">
<link rel="apple-touch-icon" href="/icons/breakout-180.png">
<meta name="apple-mobile-web-app-title" content="שובר אריחים">
<meta name="mobile-web-app-capable" content="yes">
<meta name="theme-color" content="#0B2E47">
<script src="/ofek.js"></script>''')

# ---- styles
rep('.card.wide{max-width:560px;width:100%}', '''.card.wide{max-width:560px;width:100%}
.cfbar{display:none;justify-content:center;gap:8px;flex-wrap:wrap;margin:16px auto 0}
:root.cf .cfbar:not([hidden]){display:flex}
.cfbar button{font:inherit;font-size:14px;font-weight:600;padding:9px 16px;border-radius:999px;border:1px solid var(--line);background:transparent;color:var(--ink);cursor:pointer}
.cfbar .who{background:var(--line)}
.cfform{display:flex;flex-direction:column;gap:10px;margin:0 0 18px}
.cfform input{font:inherit;font-size:18px;padding:12px 14px;border-radius:12px;border:1px solid var(--line);background:var(--bg);color:var(--ink);text-align:center}
.cfform .names{display:flex;flex-wrap:wrap;gap:6px;justify-content:center}
.cfform .names button{font:inherit;font-size:14px;padding:6px 14px;border-radius:999px;border:1px solid var(--line);background:transparent;color:var(--ink);cursor:pointer}
.cferr{color:var(--danger)!important;font-size:14px!important;margin:0!important}
.btabs{display:flex;gap:6px;margin:0 0 12px}
.btabs button{flex:1;font:inherit;font-size:14px;font-weight:600;padding:8px 4px;border:1px solid var(--line);border-radius:10px;background:transparent;color:var(--ink);cursor:pointer}
.btabs button[aria-pressed="true"]{background:var(--ink);color:var(--bg);border-color:var(--ink)}
.mtable td.n{font-variant-numeric:tabular-nums;white-space:nowrap}
.mtable tr.me td{background:var(--line)}''')

# ---- markup: player + leaderboard buttons on the home card
rep('''      <button class="modebtn" id="ovMode" hidden></button>''', '''      <button class="modebtn" id="ovMode" hidden></button>
      <div class="cfbar" id="cfBar" hidden><button class="who" id="cfWho"></button><button id="cfBoard">🏆 טבלת השיאים</button></div>''')

# ---- shared-database layer (runs only when the page is served by the Cloudflare site)
CF = r'''
/* ---------- Cloudflare site: shared database (family scores + each player's saved progress) ----------
   Login and personal codes come from /ofek.js (window.OFEK). Local progress belongs to one player
   at a time ("breakout-owner"); when another player logs in on this device, the page starts from
   that player's own saved progress. */
const CF={on:false,pending:[]};
function lsSet(k,v){try{if(v==null)localStorage.removeItem(k);else localStorage.setItem(k,v)}catch(e){}}
try{CF.pending=JSON.parse(lsGet('ofek-pending')||'[]')}catch(e){CF.pending=[]}
const KEEP=['breakout-mode','breakout-diff','breakout-padh','breakout-muted','breakout-missions'];
function clearLocalProgress(){try{const ks=[];for(let i=0;i<localStorage.length;i++){const k=localStorage.key(i);
 if(k&&k.startsWith('breakout')&&!KEEP.includes(k))ks.push(k);}ks.forEach(k=>localStorage.removeItem(k));}catch(e){}
 for(const k in mem)if(!KEEP.includes(k))delete mem[k];}
function mergeKv(kv){for(const [k,v] of Object.entries(kv||{})){if(typeof v!=='string'||!k.startsWith('breakout'))continue;const cur=lsGet(k);
 if(BEST_KEYS.includes(k)||LAST_KEYS.includes(k)){if((+v||0)>(+store.get(k,0)||0)){mem[k]=v;lsSet(k,v);}}
 else if(cur===null){mem[k]=v;lsSet(k,v);}}}
async function cfInit(){
 if(!window.OFEK||!(await OFEK.ready))return false;
 CF.on=true;document.documentElement.classList.add('cf');cfBar();
 if(!OFEK.player){if(S.state!=='menu'||!(await OFEK.ensure())){cfBar();return true;}}
 await cfLoad();return true;}
async function cfLoad(){
 const me=OFEK.player;if(!me)return false;
 const owner=lsGet('breakout-owner');
 if(owner&&owner!==me){clearLocalProgress();lsSet('breakout-owner',me);location.reload();return false;}   // another player's progress was here
 try{const snap=await OFEK.api('/api/save?app=breakout');if(OFEK.player!==me)return false;mergeKv(snap.kv);
  lsSet('breakout-owner',me);
  cloud.ref={set:d=>OFEK.api('/api/save?app=breakout',{method:'PUT',body:{kv:d.kv}})};
  cloud.ready=true;cloudPush(true);onCloudMerged();cfBar();cfFlush();return true;
 }catch(e){return false;}}
async function switchPlayer(){
 const before=OFEK.player;
 if(before&&cloud.ref){cloud.dirty=true;try{await cloudWrite()}catch(e){}}
 await OFEK.login({switch:true});
 if(OFEK.player===before){cfBar();return;}
 cloud.ref=null;clearLocalProgress();lsSet('breakout-owner',OFEK.player||null);location.reload();}
function cfBar(show){if(show!==undefined)cfBar.show=show;const on=CF.on&&!$('overlay').hidden&&!!cfBar.show;$('cfBar').hidden=!on;
 if(on)$('cfWho').textContent=OFEK.player?'👤 '+OFEK.player+' · החלפה':'👤 מי משחק?';}
function cfScore(won){if(!CF.on||!OFEK.player||!(S.score>0))return;
 CF.pending.push({p:OFEK.player,game:MODE,score:S.score,level:S.level,won:!!won});lsSet('ofek-pending',JSON.stringify(CF.pending));cfFlush(true);}
async function cfFlush(announce){
 if(CF.flushing)return;CF.flushing=true;
 while(CF.pending.length){const p=CF.pending[0];
  if(p.p!==OFEK.player){CF.pending.shift();lsSet('ofek-pending',JSON.stringify(CF.pending));continue;}   // belongs to a player who is no longer logged in here
  try{const r=await OFEK.api('/api/scores?app=breakout',{method:'POST',body:{game:p.game,score:p.score,level:p.level,won:p.won}});
   CF.pending.shift();lsSet('ofek-pending',JSON.stringify(CF.pending));
   if(announce&&r&&r.rank&&r.rank<=15)toast('🏆 מקום '+r.rank+' בטבלה המשפחתית',p.score.toLocaleString('en-US')+' נקודות');}
  catch(e){if(e.code===400){CF.pending.shift();lsSet('ofek-pending',JSON.stringify(CF.pending));continue;}break;}}
 CF.flushing=false;}
window.addEventListener('online',()=>cfFlush());
function esc(t){return String(t).replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));}
let boardGame=0;
async function showBoard(){
 const back=ovBack,g=boardGame||MODE;
 const tabs=`<div class="btabs"><button data-g="1" aria-pressed="${g===1}">שובר אריחים</button><button data-g="2" aria-pressed="${g===2}">🚀 חלל</button></div>`;
 showOverlay({title:`<h1>טבלת השיאים</h1>${tabs}<p class="mnote">טוען…</p>`,text:'',btn:'חזרה',wide:true,fn:()=>{boardGame=0;back&&showOverlay(back);}});
 const wire=()=>$('ovTitle').querySelectorAll('[data-g]').forEach(b=>b.onclick=()=>{boardGame=+b.dataset.g;ovBack=back;showBoard();});wire();
 let d;try{d=await OFEK.api('/api/scores?app=breakout&game='+g);}catch(e){
  $('ovTitle').innerHTML=`<h1>טבלת השיאים</h1>${tabs}<p class="mnote">${e.code===401?'צריך את הקוד המשפחתי כדי לראות את הטבלה.':'אין חיבור לאינטרנט כרגע. נסו שוב בעוד רגע.'}</p>`;wire();return;}
 const me=OFEK.player,date=t=>new Date(t).toLocaleDateString('he-IL',{day:'numeric',month:'numeric'});
 const top=(d.top||[]).map((r,i)=>`<tr${r.player===me?' class="me"':''}><td class="n">${['🥇','🥈','🥉'][i]||i+1}</td><td><b>${esc(r.player)}</b></td><td class="n">${r.score.toLocaleString('en-US')}</td><td class="n">${r.won?'🏆':r.level}</td><td class="n">${date(r.at)}</td></tr>`).join('');
 const ppl=(d.players||[]).map(r=>`<tr${r.player===me?' class="me"':''}><td><b>${esc(r.player)}</b></td><td class="n">${r.best.toLocaleString('en-US')}</td><td class="n">${r.won?'🏆':r.level}</td><td class="n">${r.games}</td></tr>`).join('');
 $('ovTitle').innerHTML=`<h1>טבלת השיאים</h1>${tabs}`+(top?`<table class="mtable"><thead><tr><th></th><th>שחקן</th><th>ניקוד</th><th>שלב</th><th>תאריך</th></tr></thead><tbody>${top}</tbody></table>
  <p class="lbl" style="font-weight:600;color:var(--muted);margin:0 0 6px;text-align:right">כל השחקנים</p>
  <table class="mtable"><thead><tr><th>שחקן</th><th>שיא</th><th>שלב הכי רחוק</th><th>משחקים</th></tr></thead><tbody>${ppl}</tbody></table>`
  :`<p class="mnote">עדיין אין כאן תוצאות. המשחק הראשון שנגמר ייכנס לטבלה.</p>`);
 wire();$('overlay').scrollTop=0;}
$('cfWho').onclick=()=>{unlockAudio();switchPlayer();};
$('cfBoard').onclick=()=>{unlockAudio();boardGame=0;showBoard();};
'''
rep('const reduceMotion=matchMedia', CF + 'const reduceMotion=matchMedia')

# claude.ai sync stays as is; on the Cloudflare site the shared database takes over
rep('async function cloudInit(){\n try{', 'async function cloudInit(){\n if(await cfInit())return;\n try{')

# overlay: refresh the player/leaderboard bar every time the card changes
rep("$('ovBtn').focus({preventScroll:true});}", "$('ovBtn').focus({preventScroll:true});if(typeof cfBar==='function')cfBar(!wide&&!!resume);}")

# send finished games to the shared table
rep("S.state='over';saveProgress(true);clearSave();", "S.state='over';saveProgress(true);clearSave();cfScore(false);")
rep("S.state='won';saveProgress(true);clearSave();", "S.state='won';saveProgress(true);clearSave();cfScore(true);")

# offline support: register the service worker (only on a real web address)
rep('cloudInit();\nrequestAnimationFrame(frame);', "cloudInit();\nrequestAnimationFrame(frame);\nif('serviceWorker' in navigator&&location.protocol==='https:')navigator.serviceWorker.register('/sw.js').catch(()=>{});")

open('site/breakout/index.html', 'w', encoding='utf-8').write(s)
print('ok', len(s))
