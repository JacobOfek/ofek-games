// Ofek Games – server side for Cloudflare Pages.
// Serves the game files, plus a small API backed by a D1 database bound as "DB".
//
// Players: each player has a name and a personal code (PIN). Logging in returns a token that the
// page keeps; every write (scores, saved progress, table entries) is recorded under the token's
// player, so nobody can play or save under someone else's name without that person's code.
//   GET  /api/ping                    -> is the database connected, is a family code required
//   GET  /api/players                 -> the list of player names (for the "who is playing" screen)
//   POST /api/login {player,pin}       -> log in with name + 4-digit personal code; returns {player, token}
//   POST /api/login {player,pin,email,create:true} -> sign up a new player (needs the family password when one is set)
//   POST /api/reset {player,email,pin} -> forgot the personal code: the email given at sign-up sets a new one
//   POST /api/pin {newPin}             -> change your own code (needs your token)
//   GET  /api/scores?app=breakout&game=1, POST /api/scores {game,score,level,won}
//   GET/PUT /api/save?app=breakout     -> the logged-in player's saved progress {kv}
//   GET  /api/tables?app=blocks, POST /api/tables {table, entries} -> shared top-10 tables
// Optional: a secret named FAMILY_CODE. When set, every API call must send it (header X-Family-Code).
// To reset a forgotten personal code: in the D1 console run  DELETE FROM players WHERE name='...'
// (the player keeps their scores and progress and simply sets a new code on the next login).
// Tables are created automatically on first use.

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
      fails INTEGER NOT NULL DEFAULT 0, locked_until INTEGER NOT NULL DEFAULT 0, created INTEGER NOT NULL)`),
    db.prepare(`CREATE TABLE IF NOT EXISTS meta (k TEXT PRIMARY KEY, v TEXT NOT NULL)`),
    db.prepare(`INSERT OR IGNORE INTO meta (k, v) VALUES ('secret', ?)`).bind(randHex(32)),
  ]);
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
const APPS = ['breakout', 'blocks', 'snake', 'hub'];
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
function same(a, b) { if (a.length !== b.length) return false; let r = 0; for (let i = 0; i < a.length; i++) r |= a.charCodeAt(i) ^ b.charCodeAt(i); return r === 0; }

let secretCache = null;
async function secret(db) {
  if (!secretCache) secretCache = (await db.prepare(`SELECT v FROM meta WHERE k='secret'`).first()).v;
  return secretCache;
}
// token = base64url(name) + '.' + HMAC(secret, name|hash); changing the code makes old tokens invalid
async function makeToken(db, name, hash) { return b64u(name) + '.' + (await hmac(await secret(db), name + '|' + hash)); }
async function auth(req, db) {
  const t = req.headers.get('x-player-token') || '';
  const dot = t.indexOf('.');
  if (dot < 1) return null;
  let name;
  try { name = unb64u(t.slice(0, dot)); } catch (e) { return null; }
  const row = await db.prepare(`SELECT hash FROM players WHERE name=?`).bind(name).first();
  if (!row) return null;
  const want = await hmac(await secret(db), name + '|' + row.hash);
  return same(want, t.slice(dot + 1)) ? name : null;
}
const needLogin = () => json({ error: 'auth' }, 403);

async function api(req, env, url) {
  const locked = !!env.FAMILY_CODE;
  if (url.pathname === '/api/ping') return json({ ok: true, db: !!env.DB, locked });
  if (locked && req.headers.get('x-family-code') !== env.FAMILY_CODE) return json({ error: 'code' }, 401);
  if (!env.DB) return json({ error: 'no-db' }, 503);
  const db = env.DB;
  await setup(db);

  /* ---- players ---- */
  if (url.pathname === '/api/players' && req.method === 'GET') {
    const rows = await db.prepare(`SELECT name FROM players ORDER BY created ASC`).all();
    return json({ players: rows.results.map(r => r.name) });
  }
  if (url.pathname === '/api/login' && req.method === 'POST') {
    const b = await req.json().catch(() => null);
    const name = cleanName(b && b.player), pin = cleanPin(b && b.pin);
    if (!name) return json({ error: 'name' }, 400);
    if (!pin) return json({ error: 'pin' }, 400);
    const now = Date.now();
    let row = await db.prepare(`SELECT * FROM players WHERE name=?`).bind(name).first();
    if (b.create) {
      const email = cleanEmail(b.email);
      if (!email) return json({ error: 'email' }, 400);
      if (row) return json({ error: 'taken' }, 409);
      if (await db.prepare(`SELECT 1 FROM players WHERE email=?`).bind(email).first()) return json({ error: 'email-used' }, 409);
      const salt = randHex(16), hash = await sha256(salt + '|' + pin);
      await db.prepare(`INSERT INTO players (name, email, salt, hash, created) VALUES (?,?,?,?,?)`).bind(name, email, salt, hash, now).run();
      return json({ player: name, token: await makeToken(db, name, hash), created: true });
    }
    if (!row) return json({ error: 'unknown' }, 404);
    if (row.locked_until > now) return json({ error: 'locked', wait: Math.ceil((row.locked_until - now) / 60000) }, 429);
    if (!same(await sha256(row.salt + '|' + pin), row.hash)) {
      const fails = row.fails + 1, lock = fails >= 5 ? now + 10 * 60000 : 0;   // 5 wrong codes -> 10 minutes pause
      await db.prepare(`UPDATE players SET fails=?, locked_until=? WHERE name=?`).bind(lock ? 0 : fails, lock, name).run();
      return json({ error: lock ? 'locked' : 'wrong', wait: lock ? 10 : 0, left: lock ? 0 : 5 - fails }, lock ? 429 : 403);
    }
    await db.prepare(`UPDATE players SET fails=0, locked_until=0 WHERE name=?`).bind(name).run();
    return json({ player: name, token: await makeToken(db, name, row.hash) });
  }
  if (url.pathname === '/api/reset' && req.method === 'POST') {
    const b = await req.json().catch(() => null);
    const name = cleanName(b && b.player), pin = cleanPin(b && b.pin), email = cleanEmail(b && b.email);
    if (!name || !pin || !email) return json({ error: 'bad' }, 400);
    const now = Date.now();
    const row = await db.prepare(`SELECT * FROM players WHERE name=?`).bind(name).first();
    if (!row) return json({ error: 'unknown' }, 404);
    if (row.locked_until > now) return json({ error: 'locked', wait: Math.ceil((row.locked_until - now) / 60000) }, 429);
    if (!row.email || row.email !== email) {
      const fails = row.fails + 1, lock = fails >= 5 ? now + 10 * 60000 : 0;
      await db.prepare(`UPDATE players SET fails=?, locked_until=? WHERE name=?`).bind(lock ? 0 : fails, lock, name).run();
      return json({ error: lock ? 'locked' : 'email-wrong', wait: lock ? 10 : 0 }, lock ? 429 : 403);
    }
    const salt = randHex(16), hash = await sha256(salt + '|' + pin);
    await db.prepare(`UPDATE players SET salt=?, hash=?, fails=0, locked_until=0 WHERE name=?`).bind(salt, hash, name).run();
    return json({ player: name, token: await makeToken(db, name, hash) });
  }
  if (url.pathname === '/api/pin' && req.method === 'POST') {
    const me = await auth(req, db);
    if (!me) return needLogin();
    const b = await req.json().catch(() => null);
    const pin = cleanPin(b && b.newPin);
    if (!pin) return json({ error: 'pin' }, 400);
    const salt = randHex(16), hash = await sha256(salt + '|' + pin);
    await db.prepare(`UPDATE players SET salt=?, hash=?, fails=0, locked_until=0 WHERE name=?`).bind(salt, hash, me).run();
    return json({ player: me, token: await makeToken(db, me, hash) });
  }

  const app = cleanApp(url.searchParams.get('app') || 'breakout');
  if (!app) return json({ error: 'app' }, 400);

  if (url.pathname === '/api/scores') {
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
      const me = await auth(req, db);
      if (!me) return needLogin();
      const b = await req.json().catch(() => null);
      const score = Math.floor(+(b && b.score));
      const level = Math.floor(+(b && b.level));
      const game = b && b.game === 2 ? 2 : 1;
      if (!(score > 0 && score < 1e8) || !(level >= 1 && level <= 999)) return json({ error: 'bad' }, 400);
      await db
        .prepare(`INSERT INTO scores (app, game, player, score, level, won, at) VALUES (?,?,?,?,?,?,?)`)
        .bind(app, game, me, score, level, b.won ? 1 : 0, Date.now()).run();
      const rank = await db
        .prepare(`SELECT COUNT(*) + 1 AS r FROM scores WHERE app=? AND game=? AND score > ?`)
        .bind(app, game, score).first();
      return json({ ok: true, rank: rank ? rank.r : null });
    }
  }

  if (url.pathname === '/api/save') {
    const me = await auth(req, db);
    if (!me) return needLogin();
    if (req.method === 'GET') {
      const row = await db.prepare(`SELECT kv, at FROM saves WHERE app=? AND player=?`).bind(app, me).first();
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
        .bind(app, me, text, Date.now()).run();
      return json({ ok: true });
    }
  }

  if (url.pathname === '/api/tables') {
    if (req.method === 'GET') {
      const rows = await db.prepare(`SELECT name, data FROM tables WHERE app=?`).bind(app).all();
      const tables = {};
      for (const r of rows.results) tables[r.name] = JSON.parse(r.data);
      return json({ tables });
    }
    if (req.method === 'POST') {
      const me = await auth(req, db);
      if (!me) return needLogin();
      const b = await req.json().catch(() => null);
      const name = b && typeof b.table === 'string' && /^[a-z0-9-]{1,40}$/.test(b.table) ? b.table : null;
      if (!name || !Array.isArray(b.entries) || b.entries.length > 50) return json({ error: 'bad' }, 400);
      const row = await db.prepare(`SELECT data FROM tables WHERE app=? AND name=?`).bind(app, name).first();
      const old = row ? JSON.parse(row.data) : [];
      const have = new Set(old.map(x => String(x.id)));
      // only new results are added, and always under the logged-in player's name
      const add = b.entries.map(cleanEntry).filter(x => x && !have.has(String(x.id))).map(x => ({ ...x, name: me }));
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
