#!/usr/bin/env python3
"""Builds site/snake/index.html (Cloudflare version of My Snake) from the published artifact source.
Adds a family high-score table (per mode + speed) shared through /api/tables?app=snake.
The game's own personal stats stay as they are.
usage: python3 build_snake.py SOURCE.html"""
import re, sys
src = open(sys.argv[1], encoding='utf-8').read()
starts = [m.start() for m in re.finditer(r'<!doctype html>', src, re.I)]
if len(starts) > 1:
    src = src[starts[1]:]
    src = src[:src.lower().rfind('</html>') + 7]
s = src

def rep(a, b, count=1):
    global s
    n = s.count(a)
    assert n == count, (n, a[:80])
    s = s.replace(a, b)

rep('<title>My Snake</title>', '''<title>My Snake</title>
<link rel="manifest" href="manifest.webmanifest">
<link rel="apple-touch-icon" href="/icons/snake-180.png">
<meta name="apple-mobile-web-app-title" content="My Snake">
<meta name="apple-mobile-web-app-status-bar-style" content="black-translucent">
<meta name="mobile-web-app-capable" content="yes">
<meta name="theme-color" content="#111214">
<script src="/ofek.js"></script>''')

rep('.empty{color:var(--muted);margin:10px 0 18px}', '''.empty{color:var(--muted);margin:10px 0 18px}
#cfOv .card{max-width:440px}
.cfrow{margin:0 0 12px;color:var(--muted);font-size:14px}
.cfrow:empty{display:none}
.cfrow form{display:flex;gap:6px;justify-content:center;margin-top:6px}
.cfrow input{font:inherit;font-size:16px;padding:9px 12px;border-radius:999px;border:1px solid var(--line);background:transparent;color:var(--ink);text-align:center;width:150px}
.cfrow button{font:inherit;font-size:15px;padding:9px 16px;border-radius:999px;border:0;background:var(--snake);color:#111214}
.fam{width:100%;border-collapse:collapse;margin:0 0 16px;font-variant-numeric:tabular-nums}
.fam th{font-size:12px;font-weight:400;color:var(--muted);padding:6px;border-bottom:1px solid var(--line)}
.fam td{padding:8px 6px;border-bottom:1px solid var(--line)}
.fam td.nm{text-align:right}
.fam tr.me td{background:rgba(127,166,255,.12)}''')

# markup: buttons, name row on the game-over card, and the family-table screen
rep('''    <div><button class="linkbtn" id="statsBtn">סטטיסטיקה</button></div>''',
    '''    <div><button class="linkbtn" id="statsBtn">סטטיסטיקה</button><button class="linkbtn" id="cfBtn" hidden>🏆 טבלה משפחתית</button></div>''')
rep('''    <div><button class="linkbtn" id="statsBtn2">סטטיסטיקה</button></div>''',
    '''    <div><button class="linkbtn" id="statsBtn2">סטטיסטיקה</button><button class="linkbtn" id="cfBtn2" hidden>🏆 טבלה משפחתית</button></div>''')
rep('''<h1 id="overTitle">המשחק נגמר</h1><p id="overText"></p>''',
    '''<h1 id="overTitle">המשחק נגמר</h1><p id="overText"></p><div class="cfrow" id="cfRow"></div>''')
rep('''  <div class="overlay" id="paused" hidden>''', '''  <div class="overlay" id="cfOv" hidden><div class="card">
    <h1>טבלה משפחתית</h1><p>10 התוצאות הכי טובות של כל המשפחה, מכל המכשירים</p>
    <div class="seg" id="cfMode"><button data-m="c">קלאסי</button><button data-m="m">מבוך</button></div>
    <div class="seg" id="cfSpeed"><button data-s="90">מהיר</button><button data-s="105">בינוני</button><button data-s="120">איטי</button></div>
    <div id="cfBody"></div>
    <div class="row"><button class="cta" id="cfClose">חזרה</button><button class="ghost" id="cfName">שינוי שם</button></div>
  </div></div>
  <div class="overlay" id="paused" hidden>''')

CF = r'''
/* ---- Cloudflare site: family high-score table, one per mode + speed, shared by all devices ----
   Login and personal codes come from /ofek.js (window.OFEK); results are recorded under the logged-in player. */
const CF={on:false,pending:parse(store.get('mysnake-cf-pending','[]'),[]),last:null,tm:'c',ts:90,from:'menu'};
const cfTable=(m,sp)=>(m==='maze'||m==='m'?'m':'c')+'-'+sp;
const cfEsc=t=>String(t).replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
function cfSavePending(){store.set('mysnake-cf-pending',JSON.stringify(CF.pending));}
async function cfFlush(){
 if(!CF.on||CF.busy||!OFEK.player)return;CF.busy=true;
 while(CF.pending.length){const p=CF.pending[0];
  if(p.p&&p.p!==OFEK.player){CF.pending.shift();cfSavePending();continue;}   // played by someone who is no longer logged in here
  try{const r=await OFEK.api('/api/tables?app=snake',{method:'POST',body:{table:p.table,entries:[p.e]}});
   CF.pending.shift();cfSavePending();
   if(CF.last&&CF.last.id===p.e.id){const i=(r.entries||[]).findIndex(x=>String(x.id)===String(p.e.id));
    $('cfRow').textContent=i>=0?`🏆 מקום ${i+1} בטבלה המשפחתית`:'';}}
  catch(e){if(e.code===400){CF.pending.shift();cfSavePending();continue;}break;}}
 CF.busy=false;}
function cfScore(g){
 $('cfRow').textContent='';if(!CF.on||!(g.sc>0))return;
 const d=new Date(g.t),e={id:g.t,score:g.sc,d:d.getFullYear()+'-'+String(d.getMonth()+1).padStart(2,'0')+'-'+String(d.getDate()).padStart(2,'0')};
 CF.last=e;CF.pending.push({p:OFEK.player||null,table:cfTable(g.m,g.sp),e});cfSavePending();
 if(OFEK.player){cfFlush();return;}
 $('cfRow').innerHTML='<form id="cfForm"><button>🏆 כניסה, כדי לשמור בטבלה המשפחתית</button></form>';
 $('cfForm').onsubmit=async ev=>{ev.preventDefault();if(await OFEK.ensure()){CF.pending.forEach(p=>{if(!p.p)p.p=OFEK.player;});cfSavePending();$('cfRow').textContent='שומר…';cfFlush();}};}
function cfMark(){[...$('cfMode').children].forEach(b=>b.setAttribute('aria-pressed',String(b.dataset.m===CF.tm)));
 [...$('cfSpeed').children].forEach(b=>b.setAttribute('aria-pressed',String(+b.dataset.s===CF.ts)));
 $('cfName').textContent=OFEK.player?'👤 '+OFEK.player+' · החלפה':'כניסה';}
async function cfRender(){cfMark();const el=$('cfBody');el.innerHTML='<p class="empty">טוען…</p>';
 let t;try{t=(await OFEK.api('/api/tables?app=snake')).tables||{};}catch(e){el.innerHTML=`<p class="empty">${e.code===401?'צריך את הקוד המשפחתי כדי לראות את הטבלה.':'אין חיבור לאינטרנט כרגע.'}</p>`;return;}
 const a=t[CF.tm+'-'+CF.ts]||[],me=OFEK.player;
 if(!a.length){el.innerHTML='<p class="empty">עדיין אין תוצאות בטבלה הזו.</p>';return;}
 const fd=d=>d?d.slice(8,10)+'/'+d.slice(5,7):'';
 el.innerHTML='<table class="fam"><thead><tr><th></th><th>שם</th><th>ניקוד</th><th>תאריך</th></tr></thead><tbody>'+
  a.map((x,i)=>`<tr${x.name===me?' class="me"':''}><td>${['🥇','🥈','🥉'][i]||i+1}</td><td class="nm">${cfEsc(x.name)}</td><td>${x.score}</td><td>${fd(x.d)}</td></tr>`).join('')+'</tbody></table>';}
function cfOpen(from){CF.from=from;CF.tm=mode==='maze'?'m':'c';CF.ts=speed;$(from).hidden=true;$('cfOv').hidden=false;$('cfOv').scrollTop=0;cfRender();}
$('cfBtn').onclick=()=>cfOpen('menu');$('cfBtn2').onclick=()=>cfOpen('over');
$('cfClose').onclick=()=>{$('cfOv').hidden=true;$(CF.from).hidden=false;};
$('cfMode').onclick=e=>{const b=e.target.closest('[data-m]');if(!b)return;CF.tm=b.dataset.m;cfRender();};
$('cfSpeed').onclick=e=>{const b=e.target.closest('[data-s]');if(!b)return;CF.ts=+b.dataset.s;cfRender();};
$('cfName').onclick=async()=>{await OFEK.login({switch:true});cfRender();cfFlush();};
(async()=>{if(!window.OFEK||!(await OFEK.ready))return;
 CF.on=true;$('cfBtn').hidden=false;$('cfBtn2').hidden=false;cfFlush();OFEK.onPlayer(()=>cfFlush());})();
addEventListener('online',()=>cfFlush());
'''
rep('/* state */', CF + '\n/* state */')
rep('gameLog=mergeLog([g],gameLog);saveRecords();\n}', 'gameLog=mergeLog([g],gameLog);saveRecords();cfScore(g);\n}')
rep('markMenu();hud();requestAnimationFrame(frame);syncRecords();\n})();',
    "markMenu();hud();requestAnimationFrame(frame);syncRecords();\nif('serviceWorker' in navigator&&location.protocol==='https:')navigator.serviceWorker.register('/sw.js').catch(()=>{});\n})();")
open('site/snake/index.html', 'w', encoding='utf-8').write(s)
print('ok', len(s))
