#!/usr/bin/env python3
"""Builds site/blocks/index.html (Cloudflare version of בלוקים) from the published artifact source.
The game's own top-10 tables become family tables shared through /api/tables.
usage: python3 build_blocks.py SOURCE.html"""
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

rep('<title>בלוקים</title>', '''<title>בלוקים</title>
<link rel="manifest" href="manifest.webmanifest">
<link rel="apple-touch-icon" href="/icons/blocks-180.png">
<meta name="apple-mobile-web-app-title" content="בלוקים">
<meta name="apple-mobile-web-app-status-bar-style" content="black-translucent">
<meta name="mobile-web-app-capable" content="yes">
<meta name="theme-color" content="#101218">
<script src="/ofek.js"></script>''')

rep('.empty{color:var(--muted);margin:10px 0 20px}', '''.empty{color:var(--muted);margin:10px 0 20px}
.cfnote{color:var(--muted);font-size:13px;margin:0 0 10px}''')

# every change to a table is sent to the shared copy
rep("function setScores(m,a){const v=JSON.stringify(a);store.set(skey(m),v);store.set(skey(m)+'-bak',v);",
    "function setScores(m,a){const v=JSON.stringify(a);store.set(skey(m),v);store.set(skey(m)+'-bak',v);cfPush(m);")

CF = r'''
/* ---------- Cloudflare site: the top-10 tables are shared by the whole family ----------
   Login and personal codes come from /ofek.js (window.OFEK); new results are recorded under the logged-in player. */
var CF={on:false,quiet:false,dirty:new Set(),t:0};
try{JSON.parse(store.get('blocks-cf-dirty','[]')).forEach(m=>CF.dirty.add(m))}catch(e){}
function cfSaveDirty(){store.set('blocks-cf-dirty',JSON.stringify([...CF.dirty]));}
function cfPush(m){if(!CF||CF.quiet)return;CF.dirty.add(m);cfSaveDirty();if(!CF.on)return;clearTimeout(CF.t);CF.t=setTimeout(cfFlush,1500);}
async function cfFlush(){
 if(!CF.on||CF.busy||!OFEK.player)return;CF.busy=true;
 for(const m of [...CF.dirty]){
  try{const r=await OFEK.api('/api/tables?app=blocks',{method:'POST',body:{table:m,entries:getScores(m)}});
   CF.quiet=true;setScores(m,mergeScores(r.entries||[],getScores(m).filter(x=>(r.entries||[]).some(y=>String(y.id)===String(x.id)))));CF.quiet=false;
   CF.dirty.delete(m);cfSaveDirty();}
  catch(e){CF.quiet=false;if(e.code===400){CF.dirty.delete(m);cfSaveDirty();continue;}break;}}
 CF.busy=false;cfRefresh();}
function cfRefresh(){hud();if(!$('scores').hidden){const b=[...$('scoreTabs').children].find(x=>x.getAttribute('aria-pressed')==='true');
 if(b)renderScores(b.dataset.m);}}
function localTables(){const t=[];try{for(let i=0;i<localStorage.length;i++){const k=localStorage.key(i);
 if(k&&k.startsWith('blocks-scores-')&&!k.endsWith('-bak'))t.push(k.slice(14));}}catch(e){}return t;}
async function cfAfterGame(){if(!CF.on)return;if(!OFEK.player&&!(await OFEK.ensure()))return;cfFlush();}
async function cfInit(){
 if(!window.OFEK||!(await OFEK.ready))return;
 CF.on=true;
 const note=document.createElement('p');note.className='cfnote';note.textContent='🌐 טבלת שיאים משפחתית, משותפת לכל המכשירים';
 $('scoreList').before(note);
 let remote={};try{remote=(await OFEK.api('/api/tables?app=blocks',{quiet:true})).tables||{};}catch(e){if(e.code!==401&&e.code!==403){CF.on=false;return;}}
 const names=new Set([...Object.keys(remote),...localTables()]);
 for(const m of names){const mine=getScores(m),theirs=remote[m]||[];
  CF.quiet=true;setScores(m,mergeScores(theirs,mine));CF.quiet=false;
  const have=new Set(theirs.map(x=>String(x.id)));if(mine.some(x=>!have.has(String(x.id))))CF.dirty.add(m);}
 cfSaveDirty();cfRefresh();cfFlush();
 OFEK.onPlayer(()=>cfFlush());}
window.addEventListener('online',()=>cfFlush());
cfInit();
'''
rep('/* stage mode: how difficulty grows from stage to stage */', CF + '\n/* stage mode: how difficulty grows from stage to stage */')

# offline support
rep('requestAnimationFrame(frame);\n})();\n</script>', '''requestAnimationFrame(frame);
if('serviceWorker' in navigator&&location.protocol==='https:')navigator.serviceWorker.register('/sw.js').catch(()=>{});
})();
</script>''')
# one player name for the whole site: use it when the game has none of its own
rep("name:store.get('blocks-name','')||'שחקן'", "name:(window.OFEK&&OFEK.player)||store.get('blocks-name','')||'שחקן'", 2)
rep("$('nameRow').hidden=!qualifies;", "$('nameRow').hidden=!qualifies||!!(window.OFEK&&OFEK.player);if(qualifies)cfAfterGame();", 2)
open('site/blocks/index.html', 'w', encoding='utf-8').write(s)
print('ok', len(s))
