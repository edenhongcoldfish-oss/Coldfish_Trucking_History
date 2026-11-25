'use strict';
const crypto = require('crypto');
const bcrypt = require('bcryptjs');
const db = require('./db');
const L = require('../shared/logic');

const COOKIE = 'sid';
const BCRYPT_COST = 12;
const MAX_FAILS = 5;
const LOCK_MIN = 15;
// Idle sign-out: office roles 30 min, drivers 16 h so they are not logged out mid-trip
const IDLE_MIN_OFFICE = Number(process.env.IDLE_MIN_OFFICE || 30);
const IDLE_MIN_DRIVER = Number(process.env.IDLE_MIN_DRIVER || 16 * 60);
const ABSOLUTE_HOURS = 24;
// "Keep me signed in": 30 days on that device, signed out after 14 days without use
const REMEMBER_DAYS = 30;
const REMEMBER_IDLE_DAYS = 14;

const sha256 = (s) => crypto.createHash('sha256').update(s).digest('hex');
const hashPassword = (pw) => bcrypt.hash(pw, BCRYPT_COST);
// Dummy hash so unknown usernames take the same time as real ones
const DUMMY_HASH = bcrypt.hashSync('dummy-password-for-timing', BCRYPT_COST);

function cookieOpts(remember) {
  return {
    ...(remember ? { maxAge: REMEMBER_DAYS * 864e5 } : {}),
    httpOnly: true,
    sameSite: 'strict',
    secure: process.env.COOKIE_SECURE !== 'false',
    path: '/',
  };
}

// Per-IP login attempt limit (in memory). Move to DB/Redis if running several instances
const attempts = new Map();
function loginRateLimited(ip) {
  const now = Date.now();
  const win = 15 * 60 * 1000;
  const list = (attempts.get(ip) || []).filter((t) => now - t < win);
  list.push(now);
  attempts.set(ip, list);
  return list.length > 30;
}

async function login(req, res) {
  const username = typeof req.body.username === 'string' ? req.body.username.trim().toLowerCase() : '';
  const password = typeof req.body.password === 'string' ? req.body.password : '';
  if (loginRateLimited(req.ip)) return res.status(429).json({ error: 'Too many attempts. Please try again later.' });
  const fail = () => res.status(401).json({ error: 'Incorrect username or password.' });
  if (!username || !password || password.length > 200) return fail();

  const { rows } = await db.query('select * from users where username = $1', [username]);
  const u = rows[0];
  const ok = await bcrypt.compare(password, u ? u.password_hash : DUMMY_HASH);
  if (!u || !u.active) return fail();
  if (u.locked_until && new Date(u.locked_until) > new Date()) {
    return res.status(423).json({ error: `Too many failed sign-ins. This account is locked for ${LOCK_MIN} minutes.` });
  }
  if (!ok) {
    const fails = u.failed_attempts + 1;
    if (fails >= MAX_FAILS) {
      await db.query(`update users set failed_attempts = 0, locked_until = now() + make_interval(mins => $2::int) where id = $1`, [u.id, LOCK_MIN]);
    } else {
      await db.query('update users set failed_attempts = $2::int where id = $1', [u.id, fails]);
    }
    await audit(null, req, 'login.fail', 'user', u.id, {}, u.id);
    return fail();
  }
  await db.query('update users set failed_attempts = 0, locked_until = null where id = $1', [u.id]);

  const remember = req.body.remember === true;
  await startSession(res, u.id, remember);
  await audit(null, req, 'login', 'user', u.id, { remember }, u.id);
  res.json({ ok: true, must_change_pw: u.must_change_pw });
}

async function startSession(res, userId, remember) {
  const token = crypto.randomBytes(32).toString('base64url');
  const csrf = crypto.randomBytes(24).toString('base64url');
  await db.query(
    `insert into sessions(token_hash, user_id, csrf_token, expires_at, remember)
     values ($1, $2, $3, now() + make_interval(hours => $4), $5)`,
    [sha256(token), userId, csrf, remember ? REMEMBER_DAYS * 24 : ABSOLUTE_HOURS, remember]
  );
  res.cookie(COOKIE, token, cookieOpts(remember));
}

async function logout(req, res) {
  if (req.sessionHash) await db.query('delete from sessions where token_hash = $1', [req.sessionHash]);
  res.clearCookie(COOKIE, cookieOpts());
  res.json({ ok: true });
}

// First start of a real (non-demo) install: no accounts yet, so the sign-in page offers to create the first admin.
async function setupNeeded() {
  const { rows: [r] } = await db.query('select count(*)::int as n from users');
  return r.n === 0;
}
async function setup(req, res) {
  const b = req.body || {};
  const username = typeof b.username === 'string' ? b.username.trim().toLowerCase() : '';
  const name = typeof b.name === 'string' ? b.name.trim() : '';
  const pw = typeof b.password === 'string' ? b.password : '';
  if (!/^[a-z0-9._-]{3,40}$/.test(username)) return res.status(400).json({ error: 'Username: 3-40 lowercase letters, digits, . _ -' });
  if (!name || name.length > 80) return res.status(400).json({ error: 'Please enter your name.' });
  if (pw.length < 10 || pw.length > 200) return res.status(400).json({ error: 'Password must be at least 10 characters.' });
  const hash = await hashPassword(pw);
  const id = await db.tx(async (q) => {
    if (db.kind === 'postgres') await q.query('lock table users in exclusive mode');
    const { rows: [r] } = await q.query('select count(*)::int as n from users');
    if (r.n) return null;
    const { rows: [u] } = await q.query('insert into users(username, name, password_hash) values ($1,$2,$3) returning id', [username, name, hash]);
    await q.query(`insert into user_roles(user_id, role) values ($1, 'admin')`, [u.id]);
    await q.query(`insert into audit_log(user_id, action, entity, entity_id, detail, ip) values ($1, 'setup.admin', 'user', $2, '{}', $3)`, [u.id, String(u.id), req.ip]);
    return u.id;
  });
  if (!id) return res.status(409).json({ error: 'Setup is already done. Please sign in.' });
  await startSession(res, id, false);
  res.status(201).json({ ok: true });
}

// Every /api request: check session -> load user and roles -> check CSRF on changes
async function authenticate(req, res, next) {
  try {
    const token = req.cookies && req.cookies[COOKIE];
    if (!token || typeof token !== 'string' || token.length > 100) return unauth(res);
    const h = sha256(token);
    const { rows } = await db.query(
      `select s.*, u.username, u.name, u.active, u.must_change_pw,
              coalesce(array_agg(r.role) filter (where r.role is not null), '{}') as roles
         from sessions s join users u on u.id = s.user_id
         left join user_roles r on r.user_id = u.id
        where s.token_hash = $1
        group by s.token_hash, u.id`,
      [h]
    );
    const s = rows[0];
    if (!s || !s.active || new Date(s.expires_at) < new Date()) return unauth(res, h);
    const roles = s.roles;
    const officeRoles = roles.filter((r) => r !== 'driver');
    const idle = s.remember ? REMEMBER_IDLE_DAYS * 1440 : officeRoles.length ? IDLE_MIN_OFFICE : IDLE_MIN_DRIVER;
    if (Date.now() - new Date(s.last_seen).getTime() > idle * 60000) return unauth(res, h);

    if (!['GET', 'HEAD', 'OPTIONS'].includes(req.method)) {
      const sent = String(req.get('x-csrf-token') || '');
      const a = Buffer.from(sent);
      const b = Buffer.from(s.csrf_token);
      if (a.length !== b.length || !crypto.timingSafeEqual(a, b)) {
        return res.status(403).json({ error: 'Request rejected. Refresh the page and try again.' });
      }
    }
    await db.query('update sessions set last_seen = now() where token_hash = $1', [h]);
    req.sessionHash = h;
    req.user = { id: s.user_id, username: s.username, name: s.name, roles, csrf: s.csrf_token, must_change_pw: s.must_change_pw };
    // A temporary password from the admin must be replaced before anything else
    if (s.must_change_pw && !['/me', '/me/password', '/logout'].includes(req.path)) {
      return res.status(403).json({ error: 'Please choose a new password first.', must_change_pw: true });
    }
    req.perms = L.permsFor(roles);
    next();
  } catch (e) {
    next(e);
  }
}

async function unauth(res, h) {
  if (h) await db.query('delete from sessions where token_hash = $1', [h]);
  res.clearCookie(COOKIE, cookieOpts());
  res.status(401).json({ error: 'Please sign in.' });
}

// Permission check: pass if the user has any of them, otherwise 403
const requireAny = (...perms) => (req, res, next) =>
  perms.some((p) => req.perms.has(p)) ? next() : res.status(403).json({ error: 'You do not have permission.' });

async function audit(q, req, action, entity, entityId, detail, userId) {
  await (q || db).query(
    'insert into audit_log(user_id, action, entity, entity_id, detail, ip) values ($1,$2,$3,$4,$5,$6)',
    [userId || (req.user && req.user.id) || null, action, entity, entityId == null ? null : String(entityId),
     JSON.stringify(detail || {}), req.ip]
  );
}

// Demo reset starts sign-in counting over too (the presenter switches demo accounts a lot)
const clearLoginLimits = () => attempts.clear();

module.exports = { COOKIE, cookieOpts, clearLoginLimits, login, logout, authenticate, requireAny, audit, hashPassword, sha256, setupNeeded, setup, bcrypt };
