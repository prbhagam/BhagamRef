'use strict';
/**
 * BhagamRef — digital match anomaly log for VEX V5 Robotics Competition.
 *
 * Express + SQLite server. Responsibilities:
 *   - user accounts (scrypt-hashed passwords, cookie auth)
 *   - competition sessions with join codes (owners + guests)
 *   - violation log, synced live to every participant via Server-Sent Events
 *   - cached proxy to the events.vex.com (RobotEvents v2) API so the API token never leaves the server
 */
const path = require('path');
const fs = require('fs');
const crypto = require('crypto');
const express = require('express');
const Database = require('better-sqlite3');

const PORT = Number(process.env.PORT) || 3000;
const DATA_DIR = process.env.DATA_DIR || path.join(__dirname, 'data');
const VEX_BASE = process.env.VEX_API_BASE || 'https://events.vex.com/api/v2';
const V5RC_PROGRAM_ID = 1;

function loadVexToken() {
  if (process.env.VEX_API_TOKEN) return process.env.VEX_API_TOKEN.trim();
  const file = process.env.VEX_TOKEN_FILE || path.join(__dirname, 'token.txt');
  try { return fs.readFileSync(file, 'utf8').trim(); } catch { return ''; }
}
const VEX_TOKEN = loadVexToken();
if (!VEX_TOKEN) console.warn('[bhagamref] No VEX API token found (set VEX_API_TOKEN or create token.txt). Event data will be unavailable.');

const RULES = JSON.parse(fs.readFileSync(path.join(__dirname, 'public', 'rules.json'), 'utf8'));
const RULE_CODES = new Set(RULES.categories.flatMap(c => c.rules.map(r => r.code)));

// ---------------------------------------------------------------------------
// Database
// ---------------------------------------------------------------------------
fs.mkdirSync(DATA_DIR, { recursive: true });
const db = new Database(path.join(DATA_DIR, 'bhagamref.db'));
db.pragma('journal_mode = WAL');
db.pragma('foreign_keys = ON');
db.exec(`
CREATE TABLE IF NOT EXISTS users (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  username TEXT NOT NULL UNIQUE COLLATE NOCASE,
  display_name TEXT NOT NULL,
  password_hash TEXT NOT NULL,
  created_at INTEGER NOT NULL
);
CREATE TABLE IF NOT EXISTS auth_tokens (
  token_hash TEXT PRIMARY KEY,
  user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  created_at INTEGER NOT NULL,
  last_used INTEGER NOT NULL
);
CREATE TABLE IF NOT EXISTS comp_sessions (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  code TEXT NOT NULL UNIQUE,
  owner_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  name TEXT NOT NULL,
  comp_date TEXT,
  event_id INTEGER NOT NULL,
  event_sku TEXT,
  event_name TEXT,
  event_location TEXT,
  divisions_json TEXT NOT NULL DEFAULT '[]',
  archived INTEGER NOT NULL DEFAULT 0,
  created_at INTEGER NOT NULL
);
CREATE TABLE IF NOT EXISTS participants (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  session_id INTEGER NOT NULL REFERENCES comp_sessions(id) ON DELETE CASCADE,
  user_id INTEGER REFERENCES users(id) ON DELETE CASCADE,
  name TEXT NOT NULL,
  token_hash TEXT NOT NULL UNIQUE,
  role TEXT NOT NULL DEFAULT 'ref',
  created_at INTEGER NOT NULL,
  last_seen INTEGER NOT NULL
);
CREATE UNIQUE INDEX IF NOT EXISTS participants_user ON participants(session_id, user_id) WHERE user_id IS NOT NULL;
CREATE TABLE IF NOT EXISTS custom_matches (
  id TEXT PRIMARY KEY,
  session_id INTEGER NOT NULL REFERENCES comp_sessions(id) ON DELETE CASCADE,
  division_id INTEGER NOT NULL DEFAULT 1,
  name TEXT NOT NULL,
  red_json TEXT NOT NULL,
  blue_json TEXT NOT NULL,
  created_by INTEGER REFERENCES participants(id) ON DELETE SET NULL,
  created_at INTEGER NOT NULL
);
CREATE TABLE IF NOT EXISTS violations (
  id TEXT PRIMARY KEY,
  session_id INTEGER NOT NULL REFERENCES comp_sessions(id) ON DELETE CASCADE,
  match_key TEXT NOT NULL,
  match_name TEXT NOT NULL,
  division_id INTEGER NOT NULL DEFAULT 1,
  team TEXT NOT NULL,
  alliance TEXT,
  severity TEXT NOT NULL CHECK (severity IN ('minor','major')),
  rule_code TEXT NOT NULL,
  comment TEXT NOT NULL DEFAULT '',
  created_by INTEGER REFERENCES participants(id) ON DELETE SET NULL,
  created_by_name TEXT NOT NULL,
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL,
  updated_by_name TEXT
);
CREATE INDEX IF NOT EXISTS violations_session ON violations(session_id, team);
`);

const now = () => Date.now();
const sha256 = s => crypto.createHash('sha256').update(s).digest('hex');
const newToken = () => crypto.randomBytes(32).toString('base64url');

function hashPassword(pw) {
  const salt = crypto.randomBytes(16);
  const hash = crypto.scryptSync(pw, salt, 64, { N: 16384, r: 8, p: 1 });
  return `scrypt$${salt.toString('hex')}$${hash.toString('hex')}`;
}
function verifyPassword(pw, stored) {
  const [alg, saltHex, hashHex] = String(stored).split('$');
  if (alg !== 'scrypt') return false;
  const expected = Buffer.from(hashHex, 'hex');
  const actual = crypto.scryptSync(pw, Buffer.from(saltHex, 'hex'), expected.length, { N: 16384, r: 8, p: 1 });
  return crypto.timingSafeEqual(expected, actual);
}

const CODE_ALPHABET = 'ABCDEFGHJKMNPQRSTUVWXYZ23456789'; // no 0/O, 1/I/L
function generateCode() {
  for (let attempt = 0; attempt < 50; attempt++) {
    let code = '';
    const bytes = crypto.randomBytes(6);
    for (const b of bytes) code += CODE_ALPHABET[b % CODE_ALPHABET.length];
    if (!db.prepare('SELECT 1 FROM comp_sessions WHERE code = ?').get(code)) return code;
  }
  throw new Error('Could not allocate a session code');
}
const normCode = c => String(c || '').toUpperCase().replace(/[^A-Z0-9]/g, '');

// ---------------------------------------------------------------------------
// VEX API proxy with caching + in-flight de-duplication
// ---------------------------------------------------------------------------
const vexCache = new Map(); // key -> { at, ttl, data } | { promise }

async function vexFetchJson(pathAndQuery) {
  if (!VEX_TOKEN) throw httpError(503, 'VEX API token is not configured on the server.');
  const url = pathAndQuery.startsWith('http') ? pathAndQuery : VEX_BASE + pathAndQuery;
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), 20000);
  try {
    const res = await fetch(url, {
      headers: { Authorization: `Bearer ${VEX_TOKEN}`, Accept: 'application/json', 'User-Agent': 'BhagamRef/1.0' },
      signal: ctrl.signal,
    });
    if (res.status === 429) throw httpError(503, 'The VEX API is rate-limiting requests. Try again in a minute.');
    if (res.status === 404) throw httpError(404, 'Not found on events.vex.com.');
    if (!res.ok) throw httpError(502, `events.vex.com returned HTTP ${res.status}.`);
    return await res.json();
  } catch (e) {
    if (e.name === 'AbortError') throw httpError(504, 'events.vex.com timed out.');
    if (e.status) throw e;
    throw httpError(502, 'Could not reach events.vex.com.');
  } finally {
    clearTimeout(timer);
  }
}

/** Fetch every page of a paginated list endpoint. */
async function vexFetchAll(pathAndQuery) {
  const sep = pathAndQuery.includes('?') ? '&' : '?';
  const first = await vexFetchJson(`${pathAndQuery}${sep}per_page=250&page=1`);
  let data = first.data || [];
  const last = first.meta?.last_page || 1;
  for (let p = 2; p <= Math.min(last, 40); p++) {
    const page = await vexFetchJson(`${pathAndQuery}${sep}per_page=250&page=${p}`);
    data = data.concat(page.data || []);
  }
  return data;
}

async function cached(key, ttlMs, loader, { allowStale = true } = {}) {
  const hit = vexCache.get(key);
  if (hit?.data !== undefined && now() - hit.at < ttlMs) return hit.data;
  if (hit?.promise) return hit.promise;
  const promise = loader()
    .then(data => { vexCache.set(key, { at: now(), data }); return data; })
    .catch(err => {
      // Serve stale data rather than failing when the venue Wi-Fi or the API hiccups.
      if (allowStale && hit?.data !== undefined) { vexCache.set(key, hit); return hit.data; }
      vexCache.delete(key);
      throw err;
    });
  vexCache.set(key, { ...(hit || {}), promise });
  return promise;
}

async function currentSeasonId() {
  return cached('season:current', 6 * 3600e3, async () => {
    const res = await vexFetchJson(`/seasons?program%5B%5D=${V5RC_PROGRAM_ID}&active=true&per_page=10`);
    const seasons = (res.data || []).sort((a, b) => b.id - a.id);
    if (!seasons.length) throw httpError(502, 'No active V5RC season found.');
    return seasons[0].id;
  });
}

function slimEvent(e) {
  const loc = e.location || {};
  return {
    id: e.id,
    sku: e.sku,
    name: e.name,
    start: e.start,
    end: e.end,
    level: e.level,
    ongoing: e.ongoing,
    location: [loc.venue, loc.city, loc.region, loc.country].filter(Boolean).join(', '),
    city: [loc.city, loc.region].filter(Boolean).join(', '),
    divisions: (e.divisions || []).map(d => ({ id: d.id, name: d.name, order: d.order })),
  };
}

const ROUND_SHORT = { 1: 'P', 2: 'Q', 3: 'QF', 4: 'SF', 5: 'F', 6: 'R16', 7: 'R32', 8: 'R64', 9: 'R128', 15: 'TM' };
const ROUND_ORDER = { 1: 0, 2: 1, 9: 2, 8: 3, 7: 4, 6: 5, 3: 6, 4: 7, 5: 8, 15: 9 };
function slimMatch(m) {
  const alliance = color => {
    const a = (m.alliances || []).find(x => x.color === color) || { teams: [] };
    return { score: a.score, teams: (a.teams || []).map(t => ({ number: t.team?.name, id: t.team?.id, sitting: !!t.sitting })) };
  };
  const short = ROUND_SHORT[m.round] || 'M';
  const label = m.round === 2 || m.round === 1 ? `${short}${m.matchnum}` : `${short} ${m.instance}-${m.matchnum}`;
  return {
    key: `vex:${m.id}`,
    id: m.id,
    division: m.division?.id ?? 1,
    round: m.round,
    instance: m.instance,
    matchnum: m.matchnum,
    label,
    name: m.name,
    field: m.field,
    scheduled: m.scheduled,
    started: m.started,
    scored: m.scored,
    red: alliance('red'),
    blue: alliance('blue'),
    sort: (ROUND_ORDER[m.round] ?? 50) * 1e6 + (m.instance || 0) * 1e3 + (m.matchnum || 0),
  };
}

// ---------------------------------------------------------------------------
// Live sync (Server-Sent Events)
// ---------------------------------------------------------------------------
const streams = new Map(); // session_id -> Set<{res, participantId, name}>

function broadcast(sessionId, type, payload) {
  const set = streams.get(sessionId);
  if (!set) return;
  const msg = `event: ${type}\ndata: ${JSON.stringify(payload)}\n\n`;
  for (const client of set) {
    try { client.res.write(msg); } catch { /* connection cleaned up on close */ }
  }
}
function presence(sessionId) {
  const set = streams.get(sessionId) || new Set();
  const byId = new Map();
  for (const c of set) byId.set(c.participantId, c.name);
  return [...byId].map(([id, name]) => ({ id, name }));
}
setInterval(() => {
  for (const set of streams.values()) for (const c of set) { try { c.res.write(': ping\n\n'); } catch {} }
}, 20000).unref();

// ---------------------------------------------------------------------------
// Live match schedule + scores
// While refs have a session open, the server polls events.vex.com for that event/division and pushes
// the full match list over SSE whenever anything changes (new elimination matches, saved scores, etc.).
// ---------------------------------------------------------------------------
const MATCH_POLL_MS = Math.max(5000, Number(process.env.MATCH_POLL_MS) || 15000);
const WATCH_IDLE_MS = 3 * 60e3; // stop polling a division nobody has asked about for this long
const matchWatch = new Map(); // `${eventId}:${div}` -> { eventId, div, sessions:Set<id>, lastWanted, sig, busy }

const matchSig = list => crypto.createHash('sha1').update(JSON.stringify(list)).digest('hex');

async function fetchMatches(eventId, div, { fresh = false } = {}) {
  const key = `matches:${eventId}:${div}`;
  if (fresh) { const hit = vexCache.get(key); if (hit && !hit.promise) hit.at = 0; }
  const raw = await cached(key, 10e3, () => vexFetchAll(`/events/${eventId}/divisions/${div}/matches`));
  return { division: div, fetchedAt: vexCache.get(key)?.at || now(), matches: raw.map(slimMatch).sort((a, b) => a.sort - b.sort) };
}

function watchMatches(session, div) {
  const key = `${session.event_id}:${div}`;
  let w = matchWatch.get(key);
  if (!w) { w = { eventId: session.event_id, div, sessions: new Set(), lastWanted: 0, sig: null, busy: false }; matchWatch.set(key, w); }
  w.sessions.add(session.id);
  w.lastWanted = now();
  return w;
}

/** Record the latest match list for a watcher and push it to connected refs if it changed. */
function publishMatches(w, data) {
  const sig = matchSig(data.matches);
  const changed = w.sig !== null && sig !== w.sig;
  w.sig = sig;
  if (!changed) return;
  for (const sessionId of w.sessions) broadcast(sessionId, 'matches', data);
}

setInterval(async () => {
  for (const [key, w] of matchWatch) {
    const live = [...w.sessions].some(id => streams.has(id));
    if (now() - w.lastWanted > WATCH_IDLE_MS && !live) { matchWatch.delete(key); continue; }
    if (!live || w.busy || now() - w.lastWanted > WATCH_IDLE_MS) continue;
    w.busy = true;
    try { publishMatches(w, await fetchMatches(w.eventId, w.div, { fresh: true })); }
    catch { /* transient API/network failure — try again next tick */ }
    finally { w.busy = false; }
  }
}, MATCH_POLL_MS).unref();

// ---------------------------------------------------------------------------
// HTTP helpers
// ---------------------------------------------------------------------------
function httpError(status, message) { const e = new Error(message); e.status = status; return e; }
const wrap = fn => (req, res, next) => Promise.resolve(fn(req, res, next)).catch(next);

function parseCookies(header) {
  const out = {};
  for (const part of String(header || '').split(';')) {
    const i = part.indexOf('=');
    if (i < 0) continue;
    out[part.slice(0, i).trim()] = decodeURIComponent(part.slice(i + 1).trim());
  }
  return out;
}
function setCookie(req, res, name, value, { maxAgeSec = 60 * 60 * 24 * 180, pathAttr = '/' } = {}) {
  const secure = req.secure || req.headers['x-forwarded-proto'] === 'https';
  const parts = [`${name}=${encodeURIComponent(value)}`, `Path=${pathAttr}`, 'HttpOnly', 'SameSite=Lax', `Max-Age=${maxAgeSec}`];
  if (secure) parts.push('Secure');
  res.append('Set-Cookie', parts.join('; '));
}
function clearCookie(req, res, name, pathAttr = '/') { setCookie(req, res, name, '', { maxAgeSec: 0, pathAttr }); }

const str = (v, max) => String(v ?? '').trim().slice(0, max);

// Very small fixed-window rate limiter for auth endpoints.
const attempts = new Map();
function rateLimit(key, limit, windowMs) {
  const t = now();
  const rec = attempts.get(key);
  if (!rec || t - rec.start > windowMs) { attempts.set(key, { start: t, count: 1 }); return; }
  if (++rec.count > limit) throw httpError(429, 'Too many attempts. Wait a few minutes and try again.');
}

// ---------------------------------------------------------------------------
// App
// ---------------------------------------------------------------------------
const app = express();
app.set('trust proxy', 1);
app.disable('x-powered-by');
app.use(express.json({ limit: '64kb' }));
app.use((req, res, next) => { if (!req.body || typeof req.body !== 'object') req.body = {}; next(); });

// Mutating API calls must be JSON — together with SameSite cookies this blocks cross-site form posts.
app.use('/api', (req, res, next) => {
  if (['POST', 'PUT', 'PATCH', 'DELETE'].includes(req.method) && !req.is('application/json')) {
    return res.status(415).json({ error: 'Expected application/json' });
  }
  next();
});

// Attach the logged-in user (if any).
app.use((req, res, next) => {
  const token = parseCookies(req.headers.cookie).br_auth;
  if (token) {
    const row = db.prepare(`SELECT u.id, u.username, u.display_name FROM auth_tokens t JOIN users u ON u.id = t.user_id WHERE t.token_hash = ?`).get(sha256(token));
    if (row) {
      req.user = { id: row.id, username: row.username, displayName: row.display_name };
      db.prepare('UPDATE auth_tokens SET last_used = ? WHERE token_hash = ?').run(now(), sha256(token));
    }
  }
  next();
});
const requireUser = (req, res, next) => (req.user ? next() : next(httpError(401, 'Sign in to do that.')));

function loginUser(req, res, userId) {
  const token = newToken();
  db.prepare('INSERT INTO auth_tokens (token_hash, user_id, created_at, last_used) VALUES (?, ?, ?, ?)').run(sha256(token), userId, now(), now());
  setCookie(req, res, 'br_auth', token, { maxAgeSec: 60 * 60 * 24 * 90 });
}

// ---- Auth -----------------------------------------------------------------
app.post('/api/auth/register', wrap(async (req, res) => {
  rateLimit(`reg:${req.ip}`, 10, 15 * 60e3);
  const username = str(req.body.username, 32).toLowerCase();
  const displayName = str(req.body.displayName, 40) || username;
  const password = String(req.body.password || '');
  if (!/^[a-z0-9_.-]{3,32}$/.test(username)) throw httpError(400, 'Username must be 3–32 characters: letters, numbers, . _ -');
  if (password.length < 8) throw httpError(400, 'Password must be at least 8 characters.');
  if (db.prepare('SELECT 1 FROM users WHERE username = ?').get(username)) throw httpError(409, 'That username is taken.');
  const info = db.prepare('INSERT INTO users (username, display_name, password_hash, created_at) VALUES (?, ?, ?, ?)')
    .run(username, displayName, hashPassword(password), now());
  loginUser(req, res, info.lastInsertRowid);
  res.json({ user: { id: info.lastInsertRowid, username, displayName } });
}));

app.post('/api/auth/login', wrap(async (req, res) => {
  rateLimit(`login:${req.ip}`, 20, 15 * 60e3);
  const username = str(req.body.username, 32).toLowerCase();
  const row = db.prepare('SELECT * FROM users WHERE username = ?').get(username);
  if (!row || !verifyPassword(String(req.body.password || ''), row.password_hash)) throw httpError(401, 'Wrong username or password.');
  loginUser(req, res, row.id);
  res.json({ user: { id: row.id, username: row.username, displayName: row.display_name } });
}));

app.post('/api/auth/logout', (req, res) => {
  const token = parseCookies(req.headers.cookie).br_auth;
  if (token) db.prepare('DELETE FROM auth_tokens WHERE token_hash = ?').run(sha256(token));
  clearCookie(req, res, 'br_auth');
  res.json({ ok: true });
});

app.get('/api/me', (req, res) => res.json({ user: req.user || null }));

// ---- VEX event browsing (signed-in users creating sessions) ---------------
app.get('/api/vex/events', requireUser, wrap(async (req, res) => {
  const iso = d => /^\d{4}-\d{2}-\d{2}$/.test(d || '') ? d : null;
  const today = new Date();
  const shift = days => new Date(today.getTime() + days * 864e5).toISOString().slice(0, 10);
  const from = iso(req.query.from) || shift(-2);
  const to = iso(req.query.to) || shift(10);
  const sku = str(req.query.sku, 40).toUpperCase();
  if (sku) {
    const events = await cached(`events:sku:${sku}`, 5 * 60e3, () => vexFetchAll(`/events?sku%5B%5D=${encodeURIComponent(sku)}`));
    return res.json({ events: events.filter(e => e.program?.id === V5RC_PROGRAM_ID).map(slimEvent) });
  }
  const season = await currentSeasonId();
  const events = await cached(`events:${season}:${from}:${to}`, 5 * 60e3,
    () => vexFetchAll(`/events?season%5B%5D=${season}&start=${from}&end=${to}`));
  const list = events.map(slimEvent).sort((a, b) => (a.start || '').localeCompare(b.start || '') || a.name.localeCompare(b.name));
  res.json({ from, to, season, events: list });
}));

// ---- Competition sessions ------------------------------------------------
function sessionRow(code) {
  const s = db.prepare('SELECT * FROM comp_sessions WHERE code = ?').get(normCode(code));
  if (!s) throw httpError(404, 'No competition session with that code.');
  return s;
}
function publicSession(s) {
  return {
    code: s.code,
    name: s.name,
    date: s.comp_date,
    eventId: s.event_id,
    eventSku: s.event_sku,
    eventName: s.event_name,
    eventLocation: s.event_location,
    divisions: JSON.parse(s.divisions_json || '[]'),
    ownerId: s.owner_id,
    archived: !!s.archived,
    createdAt: s.created_at,
  };
}
function addParticipant(sessionId, { userId = null, name, role = 'ref' }) {
  const token = newToken();
  const info = db.prepare('INSERT INTO participants (session_id, user_id, name, token_hash, role, created_at, last_seen) VALUES (?, ?, ?, ?, ?, ?, ?)')
    .run(sessionId, userId, name, sha256(token), role, now(), now());
  return { id: info.lastInsertRowid, token };
}
const participantCookie = code => `br_p_${code}`;
const participantPath = code => `/api/s/${code}`;

app.get('/api/sessions', requireUser, (req, res) => {
  const rows = db.prepare(`
    SELECT s.*, (SELECT COUNT(*) FROM violations v WHERE v.session_id = s.id) AS violation_count,
           (SELECT COUNT(*) FROM participants p WHERE p.session_id = s.id) AS participant_count
    FROM comp_sessions s
    WHERE s.owner_id = @uid OR s.id IN (SELECT session_id FROM participants WHERE user_id = @uid)
    ORDER BY COALESCE(s.comp_date, '') DESC, s.created_at DESC`).all({ uid: req.user.id });
  res.json({ sessions: rows.map(r => ({ ...publicSession(r), isOwner: r.owner_id === req.user.id, violationCount: r.violation_count, participantCount: r.participant_count })) });
});

app.post('/api/sessions', requireUser, wrap(async (req, res) => {
  const eventId = Number(req.body.eventId);
  if (!Number.isInteger(eventId) || eventId <= 0) throw httpError(400, 'Pick an event.');
  const event = slimEvent(await cached(`event:${eventId}`, 5 * 60e3, () => vexFetchJson(`/events/${eventId}`)));
  const date = /^\d{4}-\d{2}-\d{2}$/.test(req.body.date || '') ? req.body.date : (event.start || '').slice(0, 10) || null;
  const name = str(req.body.name, 80) || event.name.split(':')[0].trim();
  const code = generateCode();
  const tx = db.transaction(() => {
    const info = db.prepare(`INSERT INTO comp_sessions (code, owner_id, name, comp_date, event_id, event_sku, event_name, event_location, divisions_json, created_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`).run(code, req.user.id, name, date, event.id, event.sku, event.name, event.location, JSON.stringify(event.divisions.length ? event.divisions : [{ id: 1, name: 'Default' }]), now());
    return addParticipant(info.lastInsertRowid, { userId: req.user.id, name: req.user.displayName, role: 'owner' });
  });
  const p = tx();
  setCookie(req, res, participantCookie(code), p.token, { pathAttr: participantPath(code) });
  res.json({ session: publicSession(sessionRow(code)) });
}));

app.patch('/api/sessions/:code', requireUser, (req, res) => {
  const s = sessionRow(req.params.code);
  if (s.owner_id !== req.user.id) throw httpError(403, 'Only the session owner can change it.');
  const name = req.body.name !== undefined ? str(req.body.name, 80) || s.name : s.name;
  const date = /^\d{4}-\d{2}-\d{2}$/.test(req.body.date || '') ? req.body.date : s.comp_date;
  const archived = req.body.archived !== undefined ? (req.body.archived ? 1 : 0) : s.archived;
  db.prepare('UPDATE comp_sessions SET name = ?, comp_date = ?, archived = ? WHERE id = ?').run(name, date, archived, s.id);
  const updated = publicSession(sessionRow(s.code));
  broadcast(s.id, 'session', updated);
  res.json({ session: updated });
});

app.delete('/api/sessions/:code', requireUser, (req, res) => {
  const s = sessionRow(req.params.code);
  if (s.owner_id !== req.user.id) throw httpError(403, 'Only the session owner can delete it.');
  broadcast(s.id, 'deleted', { code: s.code });
  db.prepare('DELETE FROM comp_sessions WHERE id = ?').run(s.id);
  res.json({ ok: true });
});

// Peek at a session before joining (name + event only).
app.get('/api/join/:code', (req, res) => {
  const s = sessionRow(req.params.code);
  res.json({ session: { code: s.code, name: s.name, eventName: s.event_name, date: s.comp_date } });
});

// ---- Session-scoped routes (/api/s/:code/...) -----------------------------
const scoped = express.Router({ mergeParams: true });

scoped.post('/join', wrap(async (req, res) => {
  rateLimit(`join:${req.ip}`, 40, 10 * 60e3);
  const s = sessionRow(req.params.code);
  const existing = parseCookies(req.headers.cookie)[participantCookie(s.code)];
  if (existing) {
    const p = db.prepare('SELECT * FROM participants WHERE token_hash = ? AND session_id = ?').get(sha256(existing), s.id);
    if (p) return res.json({ ok: true, participant: { id: p.id, name: p.name, role: p.role } });
  }
  let p;
  if (req.user) {
    const prior = db.prepare('SELECT * FROM participants WHERE session_id = ? AND user_id = ?').get(s.id, req.user.id);
    if (prior) {
      // Issue a fresh device token for this signed-in user's existing participant record.
      const token = newToken();
      db.prepare('UPDATE participants SET token_hash = ?, last_seen = ? WHERE id = ?').run(sha256(token), now(), prior.id);
      p = { id: prior.id, token, name: prior.name, role: prior.role };
    } else {
      p = { ...addParticipant(s.id, { userId: req.user.id, name: req.user.displayName }), name: req.user.displayName, role: 'ref' };
    }
  } else {
    const name = str(req.body.name, 40);
    if (!name) throw httpError(400, 'Enter your name so others know who logged each call.');
    p = { ...addParticipant(s.id, { name, role: 'guest' }), name, role: 'guest' };
  }
  setCookie(req, res, participantCookie(s.code), p.token, { pathAttr: participantPath(s.code) });
  res.json({ ok: true, participant: { id: p.id, name: p.name, role: p.role } });
}));

// Everything below requires a participant cookie for this session.
scoped.use((req, res, next) => {
  const s = sessionRow(req.params.code);
  const token = parseCookies(req.headers.cookie)[participantCookie(s.code)];
  const p = token && db.prepare('SELECT * FROM participants WHERE token_hash = ? AND session_id = ?').get(sha256(token), s.id);
  if (!p) return next(httpError(403, 'Join this session first.'));
  if (now() - p.last_seen > 60e3) db.prepare('UPDATE participants SET last_seen = ? WHERE id = ?').run(now(), p.id);
  req.session = s;
  req.participant = p;
  req.isOwner = (req.user && req.user.id === s.owner_id) || p.role === 'owner';
  next();
});

function violationOut(v) {
  return {
    id: v.id, matchKey: v.match_key, matchName: v.match_name, division: v.division_id, team: v.team, alliance: v.alliance,
    severity: v.severity, rule: v.rule_code, comment: v.comment, createdBy: v.created_by, createdByName: v.created_by_name,
    createdAt: v.created_at, updatedAt: v.updated_at, updatedByName: v.updated_by_name,
  };
}
function customMatchOut(m) {
  const toAlliance = json => ({ score: null, teams: JSON.parse(json).map(n => ({ number: n, sitting: false })) });
  return { key: `custom:${m.id}`, id: m.id, custom: true, division: m.division_id, label: m.name, name: m.name, red: toAlliance(m.red_json), blue: toAlliance(m.blue_json), sort: 1e9 + m.created_at / 1e6, createdAt: m.created_at };
}

scoped.get('/', (req, res) => {
  const s = req.session;
  res.json({
    session: publicSession(s),
    me: { id: req.participant.id, name: req.participant.name, role: req.participant.role, isOwner: !!req.isOwner },
    participants: db.prepare('SELECT id, name, role, last_seen FROM participants WHERE session_id = ? ORDER BY created_at').all(s.id)
      .map(p => ({ id: p.id, name: p.name, role: p.role, lastSeen: p.last_seen })),
    online: presence(s.id),
    violations: db.prepare('SELECT * FROM violations WHERE session_id = ? ORDER BY created_at').all(s.id).map(violationOut),
    customMatches: db.prepare('SELECT * FROM custom_matches WHERE session_id = ? ORDER BY created_at').all(s.id).map(customMatchOut),
    serverTime: now(),
  });
});

scoped.get('/matches', wrap(async (req, res) => {
  const s = req.session;
  const divisions = JSON.parse(s.divisions_json || '[]');
  const div = Number(req.query.division) || divisions[0]?.id || 1;
  const w = watchMatches(s, div);
  const data = await fetchMatches(s.event_id, div, { fresh: req.query.fresh === '1' });
  publishMatches(w, data); // a manual refresh that finds new data updates everyone else too
  res.json(data);
}));

scoped.get('/teams', wrap(async (req, res) => {
  const s = req.session;
  const teams = await cached(`teams:${s.event_id}`, 5 * 60e3, () => vexFetchAll(`/events/${s.event_id}/teams`));
  res.json({ teams: teams.map(t => ({ id: t.id, number: t.number, name: t.team_name, org: t.organization, city: [t.location?.city, t.location?.region].filter(Boolean).join(', ') })) });
}));

scoped.post('/violations', (req, res) => {
  const s = req.session;
  const b = req.body || {};
  const id = /^[A-Za-z0-9-]{8,64}$/.test(b.id || '') ? b.id : crypto.randomUUID();
  const severity = b.severity === 'major' ? 'major' : b.severity === 'minor' ? 'minor' : null;
  const rule = str(b.rule, 10).toUpperCase();
  const team = str(b.team, 12).toUpperCase();
  const matchKey = str(b.matchKey, 64);
  if (!severity) throw httpError(400, 'Pick Minor or Major.');
  if (!RULE_CODES.has(rule)) throw httpError(400, 'Pick a rule from the game manual.');
  if (!team) throw httpError(400, 'Pick a team.');
  if (!matchKey) throw httpError(400, 'Missing match.');
  const existing = db.prepare('SELECT * FROM violations WHERE id = ?').get(id);
  if (existing) {
    // Idempotent retry from an offline outbox — return what we already stored.
    if (existing.session_id !== s.id) throw httpError(409, 'Duplicate id.');
    return res.json({ violation: violationOut(existing) });
  }
  const t = now();
  db.prepare(`INSERT INTO violations (id, session_id, match_key, match_name, division_id, team, alliance, severity, rule_code, comment, created_by, created_by_name, created_at, updated_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`)
    .run(id, s.id, matchKey, str(b.matchName, 40) || matchKey, Number(b.division) || 1, team, ['red', 'blue'].includes(b.alliance) ? b.alliance : null,
      severity, rule, str(b.comment, 1000), req.participant.id, req.participant.name, Number(b.createdAt) && Number(b.createdAt) <= t ? Number(b.createdAt) : t, t);
  const v = violationOut(db.prepare('SELECT * FROM violations WHERE id = ?').get(id));
  broadcast(s.id, 'violation', v);
  res.json({ violation: v });
});

scoped.patch('/violations/:id', (req, res) => {
  const s = req.session;
  const v = db.prepare('SELECT * FROM violations WHERE id = ? AND session_id = ?').get(req.params.id, s.id);
  if (!v) throw httpError(404, 'That violation no longer exists.');
  const b = req.body || {};
  const severity = b.severity === 'major' || b.severity === 'minor' ? b.severity : v.severity;
  const rule = b.rule !== undefined ? str(b.rule, 10).toUpperCase() : v.rule_code;
  if (!RULE_CODES.has(rule)) throw httpError(400, 'Pick a rule from the game manual.');
  const comment = b.comment !== undefined ? str(b.comment, 1000) : v.comment;
  const team = b.team !== undefined ? str(b.team, 12).toUpperCase() || v.team : v.team;
  db.prepare('UPDATE violations SET severity = ?, rule_code = ?, comment = ?, team = ?, updated_at = ?, updated_by_name = ? WHERE id = ?')
    .run(severity, rule, comment, team, now(), req.participant.name, v.id);
  const out = violationOut(db.prepare('SELECT * FROM violations WHERE id = ?').get(v.id));
  broadcast(s.id, 'violation', out);
  res.json({ violation: out });
});

scoped.delete('/violations/:id', (req, res) => {
  const s = req.session;
  const v = db.prepare('SELECT * FROM violations WHERE id = ? AND session_id = ?').get(req.params.id, s.id);
  if (!v) return res.json({ ok: true }); // already gone — idempotent
  if (!req.isOwner && v.created_by !== req.participant.id) throw httpError(403, 'Only the person who logged it or the session owner can delete it.');
  db.prepare('DELETE FROM violations WHERE id = ?').run(v.id);
  broadcast(s.id, 'violation-deleted', { id: v.id });
  res.json({ ok: true });
});

scoped.post('/matches', (req, res) => {
  const s = req.session;
  const b = req.body || {};
  const name = str(b.name, 24);
  const clean = list => (Array.isArray(list) ? list : []).map(x => str(x, 12).toUpperCase()).filter(Boolean).slice(0, 3);
  const red = clean(b.red), blue = clean(b.blue);
  if (!name) throw httpError(400, 'Give the match a name, e.g. Q12.');
  if (!red.length && !blue.length) throw httpError(400, 'Add at least one team.');
  const id = /^[A-Za-z0-9-]{8,64}$/.test(b.id || '') ? b.id : crypto.randomUUID();
  if (!db.prepare('SELECT 1 FROM custom_matches WHERE id = ?').get(id)) {
    db.prepare('INSERT INTO custom_matches (id, session_id, division_id, name, red_json, blue_json, created_by, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)')
      .run(id, s.id, Number(b.division) || 1, name, JSON.stringify(red), JSON.stringify(blue), req.participant.id, now());
  }
  const m = customMatchOut(db.prepare('SELECT * FROM custom_matches WHERE id = ?').get(id));
  broadcast(s.id, 'custom-match', m);
  res.json({ match: m });
});

scoped.delete('/matches/:id', (req, res) => {
  const s = req.session;
  const m = db.prepare('SELECT * FROM custom_matches WHERE id = ? AND session_id = ?').get(req.params.id, s.id);
  if (!m) return res.json({ ok: true });
  if (!req.isOwner && m.created_by !== req.participant.id) throw httpError(403, 'Only its creator or the session owner can remove this match.');
  db.prepare('DELETE FROM custom_matches WHERE id = ?').run(m.id);
  broadcast(s.id, 'custom-match-deleted', { id: m.id, key: `custom:${m.id}` });
  res.json({ ok: true });
});

scoped.get('/stream', (req, res) => {
  const s = req.session;
  res.writeHead(200, {
    'Content-Type': 'text/event-stream',
    'Cache-Control': 'no-cache, no-transform',
    Connection: 'keep-alive',
    'X-Accel-Buffering': 'no',
  });
  res.write(`retry: 3000\n\n`);
  const client = { res, participantId: req.participant.id, name: req.participant.name };
  if (!streams.has(s.id)) streams.set(s.id, new Set());
  streams.get(s.id).add(client);
  broadcast(s.id, 'presence', presence(s.id));
  req.on('close', () => {
    const set = streams.get(s.id);
    if (!set) return;
    set.delete(client);
    if (!set.size) streams.delete(s.id);
    else broadcast(s.id, 'presence', presence(s.id));
  });
});

scoped.get('/export.csv', (req, res) => {
  const s = req.session;
  const titles = new Map(RULES.categories.flatMap(c => c.rules.map(r => [r.code, r.title])));
  const rows = db.prepare('SELECT * FROM violations WHERE session_id = ? ORDER BY created_at').all(s.id);
  const esc = v => { const t = String(v ?? ''); return /[",\n]/.test(t) ? `"${t.replace(/"/g, '""')}"` : t; };
  const lines = [['Time', 'Match', 'Division', 'Team', 'Alliance', 'Severity', 'Rule', 'Rule title', 'Comment', 'Logged by'].join(',')];
  for (const v of rows) {
    lines.push([new Date(v.created_at).toISOString(), v.match_name, v.division_id, v.team, v.alliance || '', v.severity, v.rule_code, titles.get(v.rule_code) || '', v.comment, v.created_by_name].map(esc).join(','));
  }
  res.setHeader('Content-Type', 'text/csv; charset=utf-8');
  res.setHeader('Content-Disposition', `attachment; filename="bhagamref-${s.code}.csv"`);
  res.send(lines.join('\n'));
});

scoped.post('/leave', (req, res) => {
  clearCookie(req, res, participantCookie(req.session.code), participantPath(req.session.code));
  res.json({ ok: true });
});

app.use('/api/s/:code', scoped);
app.use('/api', (req, res) => res.status(404).json({ error: 'Not found' }));

// ---- Static client (SPA) ---------------------------------------------------
app.use(express.static(path.join(__dirname, 'public'), {
  setHeaders(res, file) {
    if (/\.(html|js|css|json|webmanifest)$/.test(file)) res.setHeader('Cache-Control', 'no-cache');
  },
}));
app.get(/^\/(?!api\/).*/, (req, res) => res.sendFile(path.join(__dirname, 'public', 'index.html')));

// ---- Errors ------------------------------------------------------------------
app.use((err, req, res, _next) => {
  const status = err.status || (err.type === 'entity.parse.failed' ? 400 : 500);
  if (status >= 500) console.error('[bhagamref]', err);
  res.status(status).json({ error: status >= 500 && !err.status ? 'Something went wrong on the server.' : err.message });
});

if (require.main === module) {
  app.listen(PORT, () => console.log(`BhagamRef running on http://localhost:${PORT}`));
}
module.exports = { app, db };
