#!/usr/bin/env python3
"""Adds a 'home' button to every game page on the site (run after the build_*.py scripts).
Pressing it saves what the game has (records, saved game, family-table entries), sends pending
data to the shared database (up to 1.5 s), then opens the games home page '/'."""
import sys

HOUSE = ('<button class="icon" id="homeBtn" aria-label="מסך הבית" title="מסך הבית">'
         '<svg width="21" height="21" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" '
         'stroke-linecap="round" stroke-linejoin="round"><path d="M3 11.5 12 4l9 7.5"/><path d="M5.5 10v10h13V10"/>'
         '<path d="M10 20v-5.5h4V20"/></svg></button>\n  ')

COMMON = r'''
/* ---------- home button: save, sync, then back to the games home page ---------- */
let goingHome=false;
const flushWithin=(p,ms)=>Promise.race([Promise.resolve(p).catch(()=>{}),new Promise(r=>setTimeout(r,ms))]);
async function goHome(){if(goingHome)return;goingHome=true;$('homeBtn').disabled=true;
 try{await flushWithin(saveBeforeHome(),1500);}catch(e){}
 location.href='/';}
$('homeBtn').addEventListener('click',e=>{e.stopPropagation();goHome();});
'''

GAMES = {
  'breakout': dict(
    anchor='showHome();\ncloudInit();',
    save=r'''async function saveBeforeHome(){
 if(S.state==='play'||S.state==='ready')pause();          // pause() also stores the game for "continue from save"
 saveProgress(true);
 const w=[];if(cloud.ref){cloud.dirty=true;w.push(cloudWrite());}
 if(typeof cfFlush==='function')w.push(cfFlush());
 await Promise.all(w);}
'''),
  'blocks': dict(
    anchor="markMenu();hud();size();requestAnimationFrame(()=>{size();lastBox='';});requestAnimationFrame(frame);",
    save=r'''async function saveBeforeHome(){
 if((state==='play'||state==='paused'||state==='intro')&&score>0&&mode!=='missions')gameOver();   // the game so far goes into the tables
 clearTimeout(CF.t);if(CF.on)await cfFlush();}
'''),
  'snake': dict(
    anchor='size();pickGrid();preview();\nmarkMenu();hud();requestAnimationFrame(frame);syncRecords();',
    save=r'''async function saveBeforeHome(){
 if(['play','paused','ready','grace'].includes(state)&&score>0)die();   // records the game and queues it for the family table
 saveRecords();if(CF.on)await cfFlush();}
'''),
}

for name, g in GAMES.items():
    p = f'site/{name}/index.html'
    s = open(p, encoding='utf-8').read()
    if 'id="homeBtn"' in s:
        print(name, 'already has a home button'); continue
    a = '<button class="icon" id="muteBtn"'
    assert s.count(a) == 1, (name, 'mute')
    s = s.replace(a, HOUSE + a)
    assert s.count(g['anchor']) == 1, (name, 'anchor')
    s = s.replace(g['anchor'], g['save'] + COMMON + g['anchor'])
    open(p, 'w', encoding='utf-8').write(s)
    print(name, 'ok')
