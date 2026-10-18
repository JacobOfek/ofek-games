/* Ofek Games – shared player login for every page on the site.
   window.OFEK:
     OFEK.ready       Promise<boolean>  true when the shared database is reachable
     OFEK.player      logged-in player name, or null
     OFEK.api(path, {method, body})    JSON call with the family code + player token; asks for them when needed
     OFEK.ensure()    Promise<boolean>  logged in (shows the login screen if not)
     OFEK.login({switch:true})         let the person choose / change player
     OFEK.onPlayer(fn)                 called with the new name after every login / logout
   Stored on this device: ofek-code (family code), ofek-player + ofek-token (who is playing). */
(() => {
  if (window.OFEK) return;
  const LS = {
    get(k) { try { return localStorage.getItem(k); } catch (e) { return null; } },
    set(k, v) { try { v == null ? localStorage.removeItem(k) : localStorage.setItem(k, v); } catch (e) {} },
  };
  const st = { token: LS.get('ofek-token'), code: LS.get('ofek-code'), on: false, db: false, locked: false };
  st.player = st.token ? LS.get('ofek-player') : null;
  const listeners = [];
  const err = (code, data) => Object.assign(new Error('api ' + code), { code, data });

  const ready = fetch('/api/ping', { cache: 'no-store' })
    .then(r => (r.ok ? r.json() : null))
    .then(j => { if (j && j.ok === true) { st.on = true; st.db = !!j.db; st.locked = !!j.locked; st.mode = j.mode || 'family'; } return st.on && st.db; })
    .catch(() => false);

  async function raw(path, opt) {
    opt = opt || {};
    const h = { 'content-type': 'application/json' };
    if (st.code) h['x-family-code'] = st.code;
    if (st.token) h['x-player-token'] = st.token;
    const body = opt.body == null ? undefined : typeof opt.body === 'string' ? opt.body : JSON.stringify(opt.body);
    const r = await fetch(path, { method: opt.method || 'GET', headers: h, body, cache: 'no-store' });
    let data = null;
    try { data = await r.json(); } catch (e) {}
    return { status: r.status, ok: r.ok, data };
  }
  async function api(path, opt) {
    for (let i = 0; i < 3; i++) {
      const r = await raw(path, opt);
      if (r.status === 401) { if (await askCode()) continue; throw err(401, r.data); }
      if (r.status === 403 && r.data && r.data.error === 'auth') { setLogin(null, null); if (await login()) continue; throw err(403, r.data); }
      if (!r.ok) throw err(r.status, r.data);
      return r.data;
    }
    throw err(0);
  }
  function setLogin(player, token) {
    st.player = player; st.token = token;
    LS.set('ofek-token', token);
    if (player) LS.set('ofek-player', player);
    listeners.forEach(fn => { try { fn(player); } catch (e) {} });
  }

  /* ---------- the login screen ---------- */
  const css = `
  .ofk{position:fixed;inset:0;z-index:2147483000;display:grid;place-items:center;padding:20px;background:rgba(10,12,18,.82);
    font-family:system-ui,-apple-system,'Segoe UI',Arial,sans-serif;direction:rtl;-webkit-tap-highlight-color:transparent}
  .ofk[hidden]{display:none!important}
  .ofk *{box-sizing:border-box}
  .ofk .bx{width:min(360px,100%);max-height:calc(100% - 20px);overflow:auto;background:#191C25;color:#ECEEF3;border:1px solid rgba(236,238,243,.14);
    border-radius:22px;padding:22px 20px;text-align:center;box-shadow:0 20px 60px rgba(0,0,0,.45)}
  .ofk h2{margin:0 0 6px;font-size:24px}
  .ofk p{margin:0 0 16px;color:#8D94A7;font-size:14px;line-height:1.5}
  .ofk .names{display:flex;flex-wrap:wrap;gap:8px;justify-content:center;margin:0 0 14px}
  .ofk .names button{font:inherit;font-size:16px;padding:10px 16px;border-radius:999px;border:1px solid rgba(236,238,243,.16);background:#20242F;color:#ECEEF3;cursor:pointer}
  .ofk .names button.me{border-color:#F2C14E}
  .ofk input{display:block;width:100%;font:inherit;font-size:20px;padding:12px 14px;margin:0 0 10px;border-radius:14px;border:1px solid rgba(236,238,243,.18);
    background:#101218;color:#ECEEF3;text-align:center}
  .ofk input.pin{letter-spacing:.5em;font-variant-numeric:tabular-nums}
  .ofk .go{display:block;width:100%;font:inherit;font-size:17px;font-weight:600;padding:13px;border:0;border-radius:999px;background:#F2C14E;color:#1d1600;cursor:pointer;margin-top:4px}
  .ofk .go:disabled{opacity:.6}
  .ofk .lnk{display:block;margin:12px auto 0;font:inherit;font-size:14px;background:none;border:0;color:#8D94A7;text-decoration:underline;cursor:pointer;padding:6px}
  .ofk .er{color:#FF7B72;font-size:14px;margin:0 0 10px;min-height:1em}`;
  let box = null, open = null;
  function ui(html) {
    if (!box) {
      const s = document.createElement('style'); s.textContent = css; document.head.appendChild(s);
      box = document.createElement('div'); box.className = 'ofk';
      ['pointerdown', 'touchstart', 'touchmove', 'keydown', 'keyup', 'click', 'mousedown', 'wheel'].forEach(t =>
        box.addEventListener(t, ev => ev.stopPropagation(), { passive: true }));
      document.body.appendChild(box);
    }
    box.innerHTML = '<div class="bx">' + html + '</div>';
    box.hidden = false;
    const f = box.querySelector('input'); if (f) setTimeout(() => f.focus(), 60);
    return sel => box.querySelector(sel);
  }
  function close() { if (box) box.hidden = true; }
  const esc = t => String(t).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const onEnter = (el, fn) => el && el.addEventListener('keydown', e => { if (e.key === 'Enter') fn(); });

  function askCode() {
    if (open) return open;
    open = new Promise(done => {
      const q = ui(`<h2>הסיסמה הכללית</h2><p>האתר מוגן בסיסמה משפחתית. כותבים אותה פעם אחת, והמכשיר זוכר.</p>
        <input id="ofkCode" autocomplete="off" placeholder="הסיסמה הכללית" type="password"><div class="er" id="ofkEr"></div>
        <button class="go" id="ofkGo">אישור</button><button class="lnk" id="ofkNo">לא עכשיו</button>`);
      const go = async () => {
        const c = q('#ofkCode').value.trim(); if (!c) return;
        st.code = c; q('#ofkGo').disabled = true;
        const r = await raw('/api/players').catch(() => null);
        if (r && r.status === 401) { q('#ofkEr').textContent = 'הסיסמה לא נכונה'; q('#ofkGo').disabled = false; return; }
        LS.set('ofek-code', c); close(); open = null; done(true);
      };
      q('#ofkGo').onclick = go; onEnter(q('#ofkCode'), go);
      q('#ofkNo').onclick = () => { close(); open = null; done(false); };
    });
    return open;
  }

  function login(o) {
    o = o || {};
    if (open) return open;
    let done;
    open = new Promise(r => (done = r));
    const finish = ok => { close(); open = null; done(ok); };
    (async () => {
      if (!(await ready)) { finish(false); return; }
      let names = [], fresh = false;
      const loadNames = async () => {
        const r = await raw('/api/players').catch(() => null);
        if (r && r.status === 401) return false;          // this device does not know the family password yet
        names = (r && r.ok && r.data.players) || []; return true;
      };
      if (!(await loadNames())) fresh = true;
      const pick = () => {
        const q = ui(`<h2>מי משחק?</h2><p>${names.length ? 'בוחרים את השם שלך ומקלידים את הקוד האישי. פעם ראשונה? ״שחקן חדש״.' : 'עוד אין שחקנים. נרשמים כשחקן ראשון:'}</p>
          <div class="names">${names.map(n => `<button data-n="${esc(n)}"${n === st.player ? ' class="me"' : ''}>${esc(n)}</button>`).join('')}</div>
          <button class="go" id="ofkNew">➕ שחקן חדש</button>
          ${st.player && o.switch ? '<button class="lnk" id="ofkOut">יציאה מהשחקן ' + esc(st.player) + '</button>' : ''}
          <button class="lnk" id="ofkNo">${o.switch && st.player ? 'ביטול' : 'לשחק בלי שם'}</button>`);
        box.querySelectorAll('[data-n]').forEach(b => (b.onclick = () => enterPin(b.dataset.n)));
        q('#ofkNew').onclick = create;
        if (q('#ofkOut')) q('#ofkOut').onclick = () => { setLogin(null, null); finish(false); };
        q('#ofkNo').onclick = () => finish(!!st.token);
        if (!names.length) create();
      };
      const pinInput = (id, ph) => `<input id="${id}" class="pin" type="password" inputmode="numeric" pattern="[0-9]*" maxlength="4" autocomplete="off"${ph ? ` placeholder="${ph}"` : ''}>`;
      const pinOk = v => /^\d{4}$/.test(v);
      const fail = (r, map) => !r ? 'אין חיבור לאינטרנט' : (r.data && map[r.data.error]) ||
        (r.data && r.data.error === 'locked' ? `יותר מדי ניסיונות. נסו שוב בעוד ${r.data.wait || 10} דקות` : 'משהו השתבש, נסו שוב');
      const enterPin = name => {
        const q = ui(`<h2>${esc(name)}</h2><p>הקוד האישי שלך (4 ספרות)</p>${pinInput('ofkPin')}
          <div class="er" id="ofkEr"></div><button class="go" id="ofkGo">כניסה</button>
          <button class="lnk" id="ofkForgot">שכחתי את הקוד</button><button class="lnk" id="ofkBack">חזרה</button>`);
        const go = async () => {
          const pin = q('#ofkPin').value.trim();
          if (!pinOk(pin)) { q('#ofkEr').textContent = 'הקוד הוא 4 ספרות'; return; }
          q('#ofkGo').disabled = true;
          const r = await raw('/api/login', { method: 'POST', body: { player: name, pin } }).catch(() => null);
          if (r && r.ok) { setLogin(r.data.player, r.data.token); finish(true); return; }
          q('#ofkGo').disabled = false; q('#ofkPin').value = '';
          q('#ofkEr').textContent = fail(r, { wrong: `הקוד לא נכון${r && r.data && r.data.left ? ` (נשארו ${r.data.left} ניסיונות)` : ''}`, blocked: 'השחקן הזה חסום. פנו למנהל האתר' });
        };
        q('#ofkGo').onclick = go; onEnter(q('#ofkPin'), go);
        q('#ofkForgot').onclick = () => forgot(name); q('#ofkBack').onclick = pick;
      };
      const forgot = name => {
        const q = ui(`<h2>קוד חדש ל${esc(name)}</h2><p>כותבים את המייל שנרשם לשחקן הזה, ובוחרים קוד חדש.</p>
          <input id="ofkMail" type="email" inputmode="email" autocomplete="email" placeholder="כתובת מייל" dir="ltr">
          ${pinInput('ofkPin', 'קוד חדש')}${pinInput('ofkPin2', 'שוב הקוד')}
          <div class="er" id="ofkEr"></div><button class="go" id="ofkGo">שמירה</button><button class="lnk" id="ofkBack">חזרה</button>`);
        const go = async () => {
          const email = q('#ofkMail').value.trim(), pin = q('#ofkPin').value.trim();
          if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) { q('#ofkEr').textContent = 'כתובת המייל לא תקינה'; return; }
          if (!pinOk(pin)) { q('#ofkEr').textContent = 'הקוד הוא 4 ספרות'; return; }
          if (pin !== q('#ofkPin2').value.trim()) { q('#ofkEr').textContent = 'שני הקודים לא זהים'; return; }
          q('#ofkGo').disabled = true;
          const r = await raw('/api/reset', { method: 'POST', body: { player: name, email, pin } }).catch(() => null);
          if (r && r.ok) { setLogin(r.data.player, r.data.token); finish(true); return; }
          q('#ofkGo').disabled = false;
          q('#ofkEr').textContent = fail(r, { 'email-wrong': 'המייל לא תואם לשחקן הזה' });
        };
        q('#ofkGo').onclick = go; onEnter(q('#ofkPin2'), go); q('#ofkBack').onclick = () => enterPin(name);
      };
      const famOnly = () => {
        if (st.mode === 'email') return emailOnly();
        const q = ui(`<h2>כניסה במכשיר חדש</h2><p>כבר נרשמת? כותבים את הסיסמה הכללית, ואז בוחרים את השם שלך.</p>
          <input id="ofkFam" type="password" autocomplete="off" placeholder="הסיסמה הכללית">
          <div class="er" id="ofkEr"></div><button class="go" id="ofkGo">המשך</button><button class="lnk" id="ofkBack">חזרה להרשמה</button>`);
        const go = async () => {
          const c = q('#ofkFam').value.trim(); if (!c) return;
          q('#ofkGo').disabled = true; const prev = st.code; st.code = c;
          if (!(await loadNames())) { st.code = prev; q('#ofkGo').disabled = false; q('#ofkEr').textContent = 'הסיסמה הכללית לא נכונה'; return; }
          LS.set('ofek-code', c); fresh = false; pick();
        };
        q('#ofkGo').onclick = go; onEnter(q('#ofkFam'), go); q('#ofkBack').onclick = create;
      };
      const emailOnly = () => {
        const q = ui(`<h2>כניסה במכשיר חדש</h2><p>כבר נרשמת? כותבים את המייל ואת הקוד האישי שקיבלת, ואז את הקוד בן 4 הספרות שלך.</p>
          <input id="ofkMail" type="email" inputmode="email" autocomplete="email" placeholder="כתובת מייל" dir="ltr">
          <input id="ofkInv" autocomplete="off" autocapitalize="characters" placeholder="הקוד האישי שקיבלת" dir="ltr">
          <div class="er" id="ofkEr"></div><button class="go" id="ofkGo">המשך</button><button class="lnk" id="ofkBack">חזרה להרשמה</button>`);
        const go = async () => {
          const email = q('#ofkMail').value.trim(), invite = q('#ofkInv').value.trim();
          if (!email || !invite) return;
          q('#ofkGo').disabled = true;
          const r = await raw('/api/unlock', { method: 'POST', body: { email, invite } }).catch(() => null);
          q('#ofkGo').disabled = false;
          if (r && r.ok) { enterPin(r.data.player); return; }
          q('#ofkEr').textContent = fail(r, { invite: 'המייל והקוד לא תואמים', unknown: 'המייל הזה עוד לא רשום. חוזרים להרשמה', blocked: 'השחקן הזה חסום. פנו למנהל האתר' });
        };
        q('#ofkGo').onclick = go; onEnter(q('#ofkInv'), go); q('#ofkBack').onclick = create;
      };
      // sign-up, step 1: email + the general family password (when the site has one)
      const create = () => {
        const byEmail = st.mode === 'email', needCode = st.locked && !byEmail;
        const q = ui(`<h2>הרשמה</h2><p>כניסה ראשונה: כתובת המייל שלך${byEmail ? ' והקוד האישי שקיבלת' : needCode ? ' והסיסמה הכללית של המשפחה' : ''}.</p>
          <input id="ofkMail" type="email" inputmode="email" autocomplete="email" placeholder="כתובת מייל" dir="ltr">
          ${byEmail ? '<input id="ofkInv" autocomplete="off" autocapitalize="characters" placeholder="הקוד האישי שקיבלת" dir="ltr">' : ''}
          ${needCode ? `<input id="ofkFam" type="password" autocomplete="off" placeholder="הסיסמה הכללית" value="${esc(st.code || '')}">` : ''}
          <div class="er" id="ofkEr"></div><button class="go" id="ofkGo">המשך</button>
          ${fresh ? '<button class="lnk" id="ofkOld">כבר נרשמתי, אני במכשיר חדש</button>' : ''}
          ${names.length && !fresh ? '<button class="lnk" id="ofkBack">חזרה</button>' : '<button class="lnk" id="ofkNo">לשחק בלי שם</button>'}`);
        if (q('#ofkOld')) q('#ofkOld').onclick = famOnly;
        const go = async () => {
          const email = q('#ofkMail').value.trim();
          if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) { q('#ofkEr').textContent = 'כתובת המייל לא תקינה'; return; }
          if (byEmail) {
            const invite = q('#ofkInv').value.trim(); if (!invite) { q('#ofkEr').textContent = 'צריך את הקוד האישי שקיבלת'; return; }
            q('#ofkGo').disabled = true;
            const r = await raw('/api/unlock', { method: 'POST', body: { email, invite } }).catch(() => null);
            q('#ofkGo').disabled = false;
            if (r && r.ok) { enterPin(r.data.player); return; }               // already registered: just the 4-digit code
            if (!(r && r.status === 404)) { q('#ofkEr').textContent = fail(r, { invite: 'המייל והקוד לא תואמים', blocked: 'השחקן הזה חסום. פנו למנהל האתר' }); return; }
            profile(email, invite); return;
          }
          if (needCode) {
            const c = q('#ofkFam').value.trim();
            if (!c) { q('#ofkEr').textContent = 'צריך את הסיסמה הכללית'; return; }
            q('#ofkGo').disabled = true; const prev = st.code; st.code = c;
            const r = await raw('/api/players').catch(() => null);
            q('#ofkGo').disabled = false;
            if (!r) { st.code = prev; q('#ofkEr').textContent = 'אין חיבור לאינטרנט'; return; }
            if (r.status === 401) { st.code = prev; q('#ofkEr').textContent = 'הסיסמה הכללית לא נכונה'; return; }
            LS.set('ofek-code', c); fresh = false; names = (r.ok && r.data.players) || names;
          }
          profile(email);
        };
        q('#ofkGo').onclick = go; onEnter(q(needCode ? '#ofkFam' : '#ofkMail'), go);
        if (q('#ofkBack')) q('#ofkBack').onclick = pick;
        if (q('#ofkNo')) q('#ofkNo').onclick = () => finish(!!st.token);
      };
      // sign-up, step 2: user name + a short 4-digit code for switching players on a device
      const profile = (email, invite) => {
        const q = ui(`<h2>שם וקוד אישי</h2><p>בוחרים שם וקוד של 4 ספרות. המכשיר יזכור אותך; את הקוד צריך רק כשמחליפים שחקן או נכנסים ממכשיר אחר.</p>
          <input id="ofkName" maxlength="20" placeholder="שם משתמש" autocomplete="nickname">
          ${pinInput('ofkPin', 'קוד (4 ספרות)')}${pinInput('ofkPin2', 'שוב הקוד')}
          <div class="er" id="ofkEr"></div><button class="go" id="ofkGo">סיום</button><button class="lnk" id="ofkBack">חזרה</button>`);
        const go = async () => {
          const name = q('#ofkName').value.trim().replace(/\s+/g, ' ').slice(0, 20), pin = q('#ofkPin').value.trim();
          if (!name) { q('#ofkEr').textContent = 'צריך לבחור שם'; return; }
          if (!pinOk(pin)) { q('#ofkEr').textContent = 'הקוד הוא 4 ספרות'; return; }
          if (pin !== q('#ofkPin2').value.trim()) { q('#ofkEr').textContent = 'שני הקודים לא זהים'; return; }
          q('#ofkGo').disabled = true;
          const r = await raw('/api/login', { method: 'POST', body: { player: name, pin, email, invite, create: true } }).catch(() => null);
          if (r && r.ok) { setLogin(r.data.player, r.data.token); finish(true); return; }
          q('#ofkGo').disabled = false;
          q('#ofkEr').textContent = fail(r, { taken: 'השם הזה כבר תפוס. בוחרים שם אחר', 'email-used': 'המייל הזה כבר רשום לשחקן אחר', email: 'כתובת המייל לא תקינה', invite: 'הקוד האישי לא תואם למייל' });
        };
        q('#ofkGo').onclick = go; onEnter(q('#ofkPin2'), go); q('#ofkBack').onclick = create;
      };
      fresh ? create() : pick();
    })();
    return open;
  }
  async function ensure() { if (st.token) return true; if (!(await ready)) return false; return login(); }

  window.OFEK = {
    ready, api, ensure, login, askCode,
    get player() { return st.player; },
    get online() { return st.on && st.db; },
    onPlayer(fn) { listeners.push(fn); },
    logout() { setLogin(null, null); },
  };
})();
