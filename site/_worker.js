// AI Games Center – server side for Cloudflare Pages.
// Serves the game files, plus a small API backed by a D1 database bound as "DB".
//
// Who may use the family data (tables, saves, player list) is set in the admin dashboard (/admin):
//   mode "family": one family password (stored hashed in the database; the FAMILY_CODE secret also works)
//   mode "email":  each invited person gets a personal sign-up code computed from their email and the day
//                    it was issued with a server secret, or a code the owner typed (list in the dashboard)
// Players have a name + 4-digit code; logging in returns a token the device keeps. Every write is
// recorded under the token's player. Blocked players cannot log in or write.
//
//   GET  /api/ping                     -> {ok, db, locked, mode}
//   GET  /api/config                   -> {homeGames}  which games the home page shows (null = all)
//   GET  /api/players                  -> player names (needs family access)
//   POST /api/unlock {email, invite}   -> email mode, new device: {player} for that email
//   POST /api/login {player,pin}       -> {player, token}
//   POST /api/login {player,pin,email,create:true[,invite]} -> sign up
//   POST /api/reset {player,email,pin} -> forgot code: the sign-up email sets a new one
//   POST /api/pin {newPin}             -> change own code
//   GET/POST /api/scores, GET/PUT /api/save, GET/POST /api/tables   (games)
//   /api/admin/*                       -> dashboard (only the site owner)
// Tables are created / upgraded automatically on first use.

const ADMIN_EMAIL_SHA256 = '7edb91764548c48ff5adc3a9505bf66c9c5a040f304c768679f75f1e72804c49';
const APPS = ['breakout', 'blocks', 'snake', 'hub'];
// games already on the site before the dashboard started recording which games it knew about
const KNOWN_BEFORE_LIST = ['breakout', 'blocks', 'snake', 'pulse-lanes', 'boom', 'wonders-dice', 'architects', 'puzzle'];

let ready = false;
async function setup(db) {
  if (ready) return;
  await db.batch([
    db.prepare(`CREATE TABLE IF NOT EXISTS scores (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      app TEXT NOT NULL, game INTEGER NOT NULL, player TEXT NOT NULL,
      score INTEGER NOT NULL, level INTEGER NOT NULL, won INTEGER NOT NULL DEFAULT 0,
      at INTEGER NOT NULL)`),
    db.prepare(`CREATE INDEX IF NOT EXISTS scores_top ON scores (app, game, score DESC)`),
    db.prepare(`CREATE TABLE IF NOT EXISTS saves (
      app TEXT NOT NULL, player TEXT NOT NULL, kv TEXT NOT NULL, at INTEGER NOT NULL,
      PRIMARY KEY (app, player))`),
    db.prepare(`CREATE TABLE IF NOT EXISTS tables (
      app TEXT NOT NULL, name TEXT NOT NULL, data TEXT NOT NULL, at INTEGER NOT NULL,
      PRIMARY KEY (app, name))`),
    db.prepare(`CREATE TABLE IF NOT EXISTS players (
      name TEXT PRIMARY KEY, email TEXT NOT NULL DEFAULT '', salt TEXT NOT NULL, hash TEXT NOT NULL,
      fails INTEGER NOT NULL DEFAULT 0, locked_until INTEGER NOT NULL DEFAULT 0, created INTEGER NOT NULL,
      blocked INTEGER NOT NULL DEFAULT 0, last_seen INTEGER NOT NULL DEFAULT 0)`),
    db.prepare(`CREATE TABLE IF NOT EXISTS meta (k TEXT PRIMARY KEY, v TEXT NOT NULL)`),
    // email mode: the people the owner invited and the sign-up code each one got
    db.prepare(`CREATE TABLE IF NOT EXISTS invites (
      email TEXT PRIMARY KEY, code TEXT NOT NULL, custom INTEGER NOT NULL DEFAULT 0,
      created INTEGER NOT NULL, sent INTEGER NOT NULL DEFAULT 0, day TEXT NOT NULL DEFAULT '', round INTEGER NOT NULL DEFAULT 0)`),
    db.prepare(`INSERT OR IGNORE INTO meta (k, v) VALUES ('secret', ?)`).bind(randHex(32)),
  ]);
  // older databases: add the newer player columns when missing
  for (const sql of [`ALTER TABLE players ADD COLUMN email TEXT NOT NULL DEFAULT ''`,
                     `ALTER TABLE players ADD COLUMN blocked INTEGER NOT NULL DEFAULT 0`,
                     `ALTER TABLE players ADD COLUMN last_seen INTEGER NOT NULL DEFAULT 0`,
                     `ALTER TABLE invites ADD COLUMN day TEXT NOT NULL DEFAULT ''`,
                     `ALTER TABLE invites ADD COLUMN round INTEGER NOT NULL DEFAULT 0`]) {
    try { await db.prepare(sql).run(); } catch (e) { /* already there */ }
  }
  ready = true;
}

const json = (data, status = 200) =>
  new Response(JSON.stringify(data), {
    status,
    headers: { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store' },
  });

function cleanName(p) {
  if (typeof p !== 'string') return null;
  p = p.trim().replace(/\s+/g, ' ');
  return p.length >= 1 && p.length <= 20 ? p : null;
}
const cleanPin = p => (typeof p === 'string' && /^\d{4}$/.test(p) ? p : null);
const cleanEmail = e => (typeof e === 'string' && /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(e.trim()) && e.trim().length <= 120 ? e.trim().toLowerCase() : null);
const cleanApp = a => (APPS.includes(a) ? a : null);

/* ---- small crypto helpers ---- */
const enc = new TextEncoder();
const hex = buf => [...new Uint8Array(buf)].map(b => b.toString(16).padStart(2, '0')).join('');
function randHex(n) { const a = new Uint8Array(n); crypto.getRandomValues(a); return hex(a); }
async function sha256(text) { return hex(await crypto.subtle.digest('SHA-256', enc.encode(text))); }
async function hmac(key, text) {
  const k = await crypto.subtle.importKey('raw', enc.encode(key), { name: 'HMAC', hash: 'SHA-256' }, false, ['sign']);
  return hex(await crypto.subtle.sign('HMAC', k, enc.encode(text)));
}
const b64u = s => btoa(String.fromCharCode(...enc.encode(s))).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
const unb64u = s => new TextDecoder().decode(Uint8Array.from(atob(s.replace(/-/g, '+').replace(/_/g, '/')), c => c.charCodeAt(0)));
function same(a, b) { a = String(a); b = String(b); if (a.length !== b.length) return false; let r = 0; for (let i = 0; i < a.length; i++) r |= a.charCodeAt(i) ^ b.charCodeAt(i); return r === 0; }

async function meta(db, k, d = null) { const r = await db.prepare(`SELECT v FROM meta WHERE k=?`).bind(k).first(); return r ? r.v : d; }
async function setMeta(db, k, v) {
  if (v == null) await db.prepare(`DELETE FROM meta WHERE k=?`).bind(k).run();
  else await db.prepare(`INSERT INTO meta (k, v) VALUES (?,?) ON CONFLICT(k) DO UPDATE SET v=excluded.v`).bind(k, v).run();
}
let secretCache = null;
async function secret(db) { if (!secretCache) secretCache = await meta(db, 'secret'); return secretCache; }

// personal sign-up code for an email (email mode): 6 characters, no look-alike letters.
// It is computed with the server secret from the email and the day it was issued (Israel time),
// so issuing a new code on another day replaces the old one.
const ALPH = 'ABCDEFGHJKMNPQRSTUVWXYZ23456789';
const today = () => new Date().toLocaleDateString('en-CA', { timeZone: 'Asia/Jerusalem' });   // YYYY-MM-DD
async function inviteCode(db, email, day) {
  const h = await hmac(await secret(db), 'invite|' + email + (day ? '|' + day : ''));
  let s = ''; for (let i = 0; i < 6; i++) s += ALPH[parseInt(h.slice(i * 4, i * 4 + 4), 16) % ALPH.length];
  return s;
}
const normInvite = c => (typeof c === 'string' ? c.toUpperCase().replace(/[^A-Z0-9]/g, '') : '');
// the code stored for an invited email; emails invited before the invites list keep the older email-only code
async function inviteOK(db, email, given) {
  const row = await db.prepare(`SELECT code FROM invites WHERE email=?`).bind(email).first();
  return same(normInvite(given), row ? row.code : await inviteCode(db, email));
}

/* ---- access ---- */
async function settings(db, env) {
  const mode = (await meta(db, 'auth-mode')) === 'email' ? 'email' : 'family';
  const famHash = await meta(db, 'family-hash');
  return { mode, famHash, famSalt: await meta(db, 'family-salt'), envCode: env.FAMILY_CODE || null };
}
async function familyOK(req, s) {
  const c = req.headers.get('x-family-code');
  if (!c) return false;
  if (s.envCode && same(c, s.envCode)) return true;
  if (s.famHash && same(await sha256(s.famSalt + '|' + c), s.famHash)) return true;
  return false;
}
const isLocked = s => s.mode === 'email' || !!(s.famHash || s.envCode);

// token = base64url(name) + '.' + HMAC(secret, name|hash); a new code makes old tokens invalid
async function makeToken(db, name, hash) { return b64u(name) + '.' + (await hmac(await secret(db), name + '|' + hash)); }
async function auth(req, db) {
  const t = req.headers.get('x-player-token') || '';
  const dot = t.indexOf('.');
  if (dot < 1) return null;
  let name;
  try { name = unb64u(t.slice(0, dot)); } catch (e) { return null; }
  const row = await db.prepare(`SELECT hash, email, blocked, last_seen FROM players WHERE name=?`).bind(name).first();
  if (!row || row.blocked) return null;
  if (!same(await hmac(await secret(db), name + '|' + row.hash), t.slice(dot + 1))) return null;
  if (Date.now() - row.last_seen > 10 * 60000) await db.prepare(`UPDATE players SET last_seen=? WHERE name=?`).bind(Date.now(), name).run();
  return { name, email: row.email };
}
const isAdmin = async me => !!(me && me.email && (await sha256(me.email)) === ADMIN_EMAIL_SHA256);
const needLogin = () => json({ error: 'auth' }, 403);

async function api(req, env, url) {
  if (!env.DB) {
    if (url.pathname === '/api/ping') return json({ ok: true, db: false, locked: false });
    return json({ error: 'no-db' }, 503);
  }
  const db = env.DB;
  await setup(db);
  const s = await settings(db, env);
  const path = url.pathname;
  if (path === '/api/ping') return json({ ok: true, db: true, locked: isLocked(s), mode: s.mode });
  if (path === '/api/config' && req.method === 'GET') {
    const h = await meta(db, 'home-games'), k = await meta(db, 'home-known');
    // homeKnown: the games that were on the site when the owner last chose; newer games show until he turns them off
    return json({ homeGames: h ? JSON.parse(h) : null, homeKnown: k ? JSON.parse(k) : (h ? KNOWN_BEFORE_LIST : null) });
  }

  /* ---- sign-up / login (protected by the code itself, not by family access) ---- */
  if (path === '/api/login' && req.method === 'POST') {
    const b = await req.json().catch(() => null);
    const name = cleanName(b && b.player), pin = cleanPin(b && b.pin);
    if (!name) return json({ error: 'name' }, 400);
    if (!pin) return json({ error: 'pin' }, 400);
    const now = Date.now();
    const row = await db.prepare(`SELECT * FROM players WHERE name=?`).bind(name).first();
    if (b.create) {
      const email = cleanEmail(b.email);
      if (!email) return json({ error: 'email' }, 400);
      if (s.mode === 'email') { if (!(await inviteOK(db, email, b.invite))) return json({ error: 'invite' }, 403); }
      else if (isLocked(s) && !(await familyOK(req, s))) return json({ error: 'code' }, 401);
      if (row) return json({ error: 'taken' }, 409);
      if (await db.prepare(`SELECT 1 FROM players WHERE email=?`).bind(email).first()) return json({ error: 'email-used' }, 409);
      const salt = randHex(16), hash = await sha256(salt + '|' + pin);
      await db.prepare(`INSERT INTO players (name, email, salt, hash, created, last_seen) VALUES (?,?,?,?,?,?)`).bind(name, email, salt, hash, now, now).run();
      return json({ player: name, token: await makeToken(db, name, hash), created: true });
    }
    if (!row) return json({ error: 'unknown' }, 404);
    if (row.blocked) return json({ error: 'blocked' }, 403);
    if (row.locked_until > now) return json({ error: 'locked', wait: Math.ceil((row.locked_until - now) / 60000) }, 429);
    if (!same(await sha256(row.salt + '|' + pin), row.hash)) {
      const fails = row.fails + 1, lock = fails >= 5 ? now + 10 * 60000 : 0;   // 5 wrong codes -> 10 minutes pause
      await db.prepare(`UPDATE players SET fails=?, locked_until=? WHERE name=?`).bind(lock ? 0 : fails, lock, name).run();
      return json({ error: lock ? 'locked' : 'wrong', wait: lock ? 10 : 0, left: lock ? 0 : 5 - fails }, lock ? 429 : 403);
    }
    await db.prepare(`UPDATE players SET fails=0, locked_until=0, last_seen=? WHERE name=?`).bind(now, name).run();
    return json({ player: name, token: await makeToken(db, name, row.hash) });
  }
  if (path === '/api/unlock' && req.method === 'POST') {   // email mode: a registered person on a new device
    const b = await req.json().catch(() => null);
    const email = cleanEmail(b && b.email);
    if (!email || !(await inviteOK(db, email, b.invite))) return json({ error: 'invite' }, 403);
    const row = await db.prepare(`SELECT name, blocked FROM players WHERE email=?`).bind(email).first();
    if (!row) return json({ error: 'unknown' }, 404);
    if (row.blocked) return json({ error: 'blocked' }, 403);
    return json({ player: row.name });
  }
  if (path === '/api/reset' && req.method === 'POST') {
    const b = await req.json().catch(() => null);
    const name = cleanName(b && b.player), pin = cleanPin(b && b.pin), email = cleanEmail(b && b.email);
    if (!name || !pin || !email) return json({ error: 'bad' }, 400);
    const now = Date.now();
    const row = await db.prepare(`SELECT * FROM players WHERE name=?`).bind(name).first();
    if (!row) return json({ error: 'unknown' }, 404);
    if (row.blocked) return json({ error: 'blocked' }, 403);
    if (row.locked_until > now) return json({ error: 'locked', wait: Math.ceil((row.locked_until - now) / 60000) }, 429);
    if (!row.email || row.email !== email) {
      const fails = row.fails + 1, lock = fails >= 5 ? now + 10 * 60000 : 0;
      await db.prepare(`UPDATE players SET fails=?, locked_until=? WHERE name=?`).bind(lock ? 0 : fails, lock, name).run();
      return json({ error: lock ? 'locked' : 'email-wrong', wait: lock ? 10 : 0 }, lock ? 429 : 403);
    }
    const salt = randHex(16), hash = await sha256(salt + '|' + pin);
    await db.prepare(`UPDATE players SET salt=?, hash=?, fails=0, locked_until=0, last_seen=? WHERE name=?`).bind(salt, hash, now, name).run();
    return json({ player: name, token: await makeToken(db, name, hash) });
  }

  /* ---- everything below needs family access: the family password, or being a logged-in player ---- */
  const me = await auth(req, db);
  if (isLocked(s) && !me && !(await familyOK(req, s))) return json({ error: 'code', mode: s.mode }, 401);

  if (path === '/api/players' && req.method === 'GET') {
    const rows = await db.prepare(`SELECT name FROM players WHERE blocked=0 ORDER BY created ASC`).all();
    return json({ players: rows.results.map(r => r.name) });
  }
  if (path === '/api/pin' && req.method === 'POST') {
    if (!me) return needLogin();
    const b = await req.json().catch(() => null);
    const pin = cleanPin(b && b.newPin);
    if (!pin) return json({ error: 'pin' }, 400);
    const salt = randHex(16), hash = await sha256(salt + '|' + pin);
    await db.prepare(`UPDATE players SET salt=?, hash=?, fails=0, locked_until=0 WHERE name=?`).bind(salt, hash, me.name).run();
    return json({ player: me.name, token: await makeToken(db, me.name, hash) });
  }

  /* ---- admin dashboard ---- */
  if (path.startsWith('/api/admin/')) {
    if (!me) return needLogin();
    if (!(await isAdmin(me))) return json({ error: 'not-admin' }, 403);
    if (path === '/api/admin/overview' && req.method === 'GET') {
      const players = (await db.prepare(`SELECT name, email, created, last_seen, blocked FROM players ORDER BY created ASC`).all()).results;
      const counts = (await db.prepare(`SELECT player, COUNT(*) AS n, MAX(at) AS last FROM scores GROUP BY player`).all()).results;
      const h = await meta(db, 'home-games');
      const invites = (await db.prepare(`SELECT i.email, i.code, i.custom, i.created, i.sent, p.name AS player
        FROM invites i LEFT JOIN players p ON p.email = i.email ORDER BY i.created DESC`).all()).results;
      return json({
        mode: s.mode, familySet: !!(s.famHash || s.envCode), familyFromSecret: !!s.envCode,
        familyPassword: (await meta(db, 'family-plain')) || null,
        homeGames: h ? JSON.parse(h) : null,
        homeKnown: (k => k ? JSON.parse(k) : (h ? KNOWN_BEFORE_LIST : null))(await meta(db, 'home-known')), deployRequest: JSON.parse((await meta(db, 'deploy-request')) || 'null'),
        invites,
        players: players.map(p => ({ ...p, games: (counts.find(c => c.player === p.name) || {}).n || 0 })),
      });
    }
    if (path === '/api/admin/config' && req.method === 'POST') {
      const b = await req.json().catch(() => ({}));
      if (Array.isArray(b.homeGames)) await setMeta(db, 'home-games', JSON.stringify(b.homeGames.filter(x => typeof x === 'string').slice(0, 100)));
      if (Array.isArray(b.homeKnown)) await setMeta(db, 'home-known', JSON.stringify(b.homeKnown.filter(x => typeof x === 'string').slice(0, 100)));
      if (b.mode === 'email' || b.mode === 'family') await setMeta(db, 'auth-mode', b.mode);
      if (typeof b.familyPassword === 'string') {
        const p = b.familyPassword.trim();
        if (p.length && p.length < 4) return json({ error: 'short' }, 400);
        // the family password is shared with the whole family anyway, so the owner can see it again in the dashboard
        if (p) { const salt = randHex(16); await setMeta(db, 'family-salt', salt); await setMeta(db, 'family-hash', await sha256(salt + '|' + p)); await setMeta(db, 'family-plain', p); }
        else { await setMeta(db, 'family-hash', null); await setMeta(db, 'family-salt', null); await setMeta(db, 'family-plain', null); }
      }
      if (b.deployRequest) await setMeta(db, 'deploy-request', JSON.stringify({ at: Date.now(), games: (b.deployRequest.games || []).slice(0, 100) }));
      return json({ ok: true });
    }
    if (path === '/api/admin/invite' && req.method === 'POST') {
      const b = await req.json().catch(() => null);
      const email = cleanEmail(b && b.email);
      if (!email) return json({ error: 'email' }, 400);
      if (b.remove) { await db.prepare(`DELETE FROM invites WHERE email=?`).bind(email).run(); return json({ ok: true }); }
      if (b.sent) { await db.prepare(`UPDATE invites SET sent=? WHERE email=?`).bind(Date.now(), email).run(); return json({ ok: true }); }
      let code = '', custom = 0;
      if (typeof b.code === 'string' && b.code.trim()) {   // a code the owner typed
        if (!/^[A-Za-z0-9 -]+$/.test(b.code.trim())) return json({ error: 'chars' }, 400);
        code = normInvite(b.code);
        if (code.length < 4 || code.length > 12) return json({ error: 'length' }, 400);
        custom = 1;
      }
      // from the formula: email + today's date; asking again on the same day moves to the next round, so the code always changes
      const old = await db.prepare(`SELECT day, round FROM invites WHERE email=?`).bind(email).first();
      const day = today(), round = custom ? 0 : (old && old.day === day ? old.round + 1 : 1);
      if (!custom) code = await inviteCode(db, email, round > 1 ? day + '#' + round : day);
      const now = Date.now();
      await db.prepare(`INSERT INTO invites (email, code, custom, created, sent, day, round) VALUES (?,?,?,?,0,?,?)
        ON CONFLICT(email) DO UPDATE SET code=excluded.code, custom=excluded.custom, created=excluded.created, sent=0,
          day=excluded.day, round=CASE WHEN excluded.custom=1 THEN invites.round ELSE excluded.round END`).bind(email, code, custom, now, day, round).run();
      return json({ email, code, custom, created: now });
    }
    if (path === '/api/admin/player' && req.method === 'POST') {
      const b = await req.json().catch(() => null);
      const name = cleanName(b && b.name);
      const row = name && await db.prepare(`SELECT * FROM players WHERE name=?`).bind(name).first();
      if (!row) return json({ error: 'unknown' }, 404);
      if (name === me.name && b.action !== 'reset') return json({ error: 'self' }, 400);
      if (b.action === 'block' || b.action === 'unblock') {
        await db.prepare(`UPDATE players SET blocked=? WHERE name=?`).bind(b.action === 'block' ? 1 : 0, name).run();
        return json({ ok: true });
      }
      if (b.action === 'reset') {   // a new code for the player: the one the owner typed, or a random one
        if (b.pin != null && !cleanPin(b.pin)) return json({ error: 'pin' }, 400);
        const pin = cleanPin(b.pin) || String(Math.floor(1000 + Math.random() * 9000)), salt = randHex(16), hash = await sha256(salt + '|' + pin);
        await db.prepare(`UPDATE players SET salt=?, hash=?, fails=0, locked_until=0 WHERE name=?`).bind(salt, hash, name).run();
        return json({ ok: true, pin });
      }
      if (b.action === 'remove') {
        const q = [db.prepare(`DELETE FROM players WHERE name=?`).bind(name)];
        if (b.removeData) {
          q.push(db.prepare(`DELETE FROM scores WHERE player=?`).bind(name), db.prepare(`DELETE FROM saves WHERE player=?`).bind(name));
          for (const t of (await db.prepare(`SELECT app, name, data FROM tables`).all()).results) {
            const d = JSON.parse(t.data), keep = d.filter(x => x.name !== name);
            if (keep.length !== d.length) q.push(db.prepare(`UPDATE tables SET data=? WHERE app=? AND name=?`).bind(JSON.stringify(keep), t.app, t.name));
          }
        }
        await db.batch(q);
        return json({ ok: true });
      }
      return json({ error: 'bad' }, 400);
    }
    return json({ error: 'not-found' }, 404);
  }

  /* ---- games ---- */
  const app = cleanApp(url.searchParams.get('app') || 'breakout');
  if (!app) return json({ error: 'app' }, 400);

  if (path === '/api/scores') {
    if (req.method === 'GET') {
      const game = url.searchParams.get('game') === '2' ? 2 : 1;
      const top = await db
        .prepare(`SELECT player, score, level, won, at FROM scores WHERE app=? AND game=? ORDER BY score DESC, at ASC LIMIT 15`)
        .bind(app, game).all();
      const players = await db
        .prepare(`SELECT player, MAX(score) AS best, MAX(level) AS level, COUNT(*) AS games, MAX(won) AS won
                  FROM scores WHERE app=? AND game=? GROUP BY player ORDER BY best DESC LIMIT 30`)
        .bind(app, game).all();
      return json({ top: top.results, players: players.results });
    }
    if (req.method === 'POST') {
      if (!me) return needLogin();
      const b = await req.json().catch(() => null);
      const score = Math.floor(+(b && b.score));
      const level = Math.floor(+(b && b.level));
      const game = b && b.game === 2 ? 2 : 1;
      if (!(score > 0 && score < 1e8) || !(level >= 1 && level <= 999)) return json({ error: 'bad' }, 400);
      await db
        .prepare(`INSERT INTO scores (app, game, player, score, level, won, at) VALUES (?,?,?,?,?,?,?)`)
        .bind(app, game, me.name, score, level, b.won ? 1 : 0, Date.now()).run();
      const rank = await db
        .prepare(`SELECT COUNT(*) + 1 AS r FROM scores WHERE app=? AND game=? AND score > ?`)
        .bind(app, game, score).first();
      return json({ ok: true, rank: rank ? rank.r : null });
    }
  }

  if (path === '/api/save') {
    if (!me) return needLogin();
    if (req.method === 'GET') {
      const row = await db.prepare(`SELECT kv, at FROM saves WHERE app=? AND player=?`).bind(app, me.name).first();
      return json(row ? { kv: JSON.parse(row.kv), at: row.at } : { kv: {}, at: 0 });
    }
    if (req.method === 'PUT') {
      const b = await req.json().catch(() => null);
      if (!b || !b.kv || typeof b.kv !== 'object') return json({ error: 'bad' }, 400);
      const kv = {};
      for (const [k, v] of Object.entries(b.kv)) if (k.startsWith(app) && typeof v === 'string') kv[k] = v;
      const text = JSON.stringify(kv);
      if (text.length > 200000) return json({ error: 'too-big' }, 413);
      await db
        .prepare(`INSERT INTO saves (app, player, kv, at) VALUES (?,?,?,?)
                  ON CONFLICT(app, player) DO UPDATE SET kv=excluded.kv, at=excluded.at`)
        .bind(app, me.name, text, Date.now()).run();
      return json({ ok: true });
    }
  }

  if (path === '/api/tables') {
    if (req.method === 'GET') {
      const rows = await db.prepare(`SELECT name, data FROM tables WHERE app=?`).bind(app).all();
      const tables = {};
      for (const r of rows.results) tables[r.name] = JSON.parse(r.data);
      return json({ tables });
    }
    if (req.method === 'POST') {
      if (!me) return needLogin();
      const b = await req.json().catch(() => null);
      const name = b && typeof b.table === 'string' && /^[a-z0-9-]{1,40}$/.test(b.table) ? b.table : null;
      if (!name || !Array.isArray(b.entries) || b.entries.length > 50) return json({ error: 'bad' }, 400);
      const row = await db.prepare(`SELECT data FROM tables WHERE app=? AND name=?`).bind(app, name).first();
      const old = row ? JSON.parse(row.data) : [];
      const have = new Set(old.map(x => String(x.id)));
      // only new results are added, and always under the logged-in player's name
      const add = b.entries.map(cleanEntry).filter(x => x && !have.has(String(x.id))).map(x => ({ ...x, name: me.name }));
      const merged = mergeEntries(old, add);
      if (add.length)
        await db
          .prepare(`INSERT INTO tables (app, name, data, at) VALUES (?,?,?,?)
                    ON CONFLICT(app, name) DO UPDATE SET data=excluded.data, at=excluded.at`)
          .bind(app, name, JSON.stringify(merged), Date.now()).run();
      return json({ entries: merged });
    }
  }
  return json({ error: 'not-found' }, 404);
}

// one row of a top-10 table; only known fields are kept
function cleanEntry(x) {
  if (!x || typeof x !== 'object' || typeof x.score !== 'number' || !(x.score >= 0 && x.score < 1e9)) return null;
  const id = typeof x.id === 'number' || typeof x.id === 'string' ? String(x.id).slice(0, 40) : null;
  if (!id) return null;
  const e = { id: typeof x.id === 'number' ? x.id : id, score: Math.floor(x.score) };
  for (const k of ['lines', 'lvl', 't']) if (typeof x[k] === 'number' && isFinite(x[k])) e[k] = x[k];
  e.d = typeof x.d === 'string' ? x.d.slice(0, 10) : '';
  return e;
}
function mergeEntries(old, add) {
  const by = new Map();
  for (const x of old) by.set(String(x.id), x);
  for (const x of add) by.set(String(x.id), x);
  const timed = (a, b) => typeof a.t === 'number' && typeof b.t === 'number';
  return [...by.values()]
    .sort((a, b) => (timed(a, b) ? a.t - b.t || b.score - a.score : b.score - a.score))
    .slice(0, 10);
}

export default {
  async fetch(req, env) {
    const url = new URL(req.url);
    if (url.pathname.startsWith('/api/')) {
      try { return await api(req, env, url); }
      catch (e) { return json({ error: 'server', detail: String(e && e.message || e) }, 500); }
    }
    return env.ASSETS.fetch(req);
  },
};
