'use strict';
const express = require('express');
const db = require('./db');
const L = require('../shared/logic');
const { requireAny, audit, hashPassword, COOKIE, cookieOpts } = require('./auth');
const { workbook } = require('./xlsx');
const N = require('./notify');

const r = express.Router();
const wrap = (fn) => (req, res, next) => Promise.resolve(fn(req, res, next)).catch(next);

// ---------- input validation ----------
class Bad extends Error { constructor(m, status) { super(m); this.status = status || 400; this.expose = true; } }
function str(v, name, { min = 1, max = 200, optional = false } = {}) {
  if (v == null || v === '') { if (optional) return null; throw new Bad(`Please enter ${name}.`); }
  if (typeof v !== 'string') throw new Bad(`${name} is not in a valid format.`);
  const s = v.trim();
  if (s.length < min || s.length > max) throw new Bad(`${name} must be ${min}-${max} characters.`);
  return s;
}
function int(v, name, { min = 0, max = 1e9, optional = false } = {}) {
  if (v == null || v === '') { if (optional) return null; throw new Bad(`Please enter ${name}.`); }
  const n = Number(v);
  if (!Number.isInteger(n) || n < min || n > max) throw new Bad(`${name} is not a valid value.`);
  return n;
}
function num(v, name, { min = 0, max = 1e6, optional = false } = {}) {
  if (v == null || v === '') { if (optional) return null; throw new Bad(`Please enter ${name}.`); }
  const n = Number(v);
  if (!Number.isFinite(n) || n < min || n > max) throw new Bad(`${name} is not a valid value.`);
  return n;
}
function when(v, name, { optional = false } = {}) {
  if (v == null || v === '') { if (optional) return null; throw new Bad(`Please enter ${name}.`); }
  const d = new Date(v);
  if (typeof v !== 'string' || isNaN(d)) throw new Bad(`${name} is not a valid date.`);
  return d.toISOString();
}
function oneOf(v, name, list) {
  if (!list.includes(v)) throw new Bad(`${name} is not a valid value.`);
  return v;
}
const notFound = () => new Bad('Not found.', 404);

async function getSettings(q = db) {
  const { rows } = await q.query('select key, value from settings');
  const s = Object.assign({}, L.DEFAULT_SETTINGS);
  rows.forEach((x) => { s[x.key] = x.value; });
  return s;
}

// Settings for one driver's pay: their own rate and meal break win over the company values
const payCfg = (settings, driverRate, prof) => ({ ...settings, ...(driverRate == null ? {} : { hourly_rate: Number(driverRate) }),
  ...(prof.meal_min == null ? {} : { meal_deduction_min: prof.meal_min }) });

// ---------- trip loading (every list goes through this) ----------
async function loadTrips(where, params, q = db) {
  const { rows: trips } = await q.query(
    `select t.*, u.name as driver_name, u.hourly_rate as driver_rate, u.pay_profile
       from trips t join users u on u.id = t.driver_id
      where ${where}
      order by t.planned_departure desc, t.id desc
      limit 300`,
    params
  );
  if (!trips.length) return [];
  const ids = trips.map((t) => t.id);
  const teamIds = [...new Set(trips.map((t) => t.team_id).filter(Boolean))];
  const [ev, memos, corr, pay, settings, mateRows] = await Promise.all([
    q.query(`select e.*, u.name as recorded_by_name from trip_events e join users u on u.id = e.recorded_by
              where trip_id = any($1) order by e.id`, [ids]),
    q.query(`select m.*, u.name as author_name from trip_memos m join users u on u.id = m.author_id
              where trip_id = any($1) order by m.id`, [ids]),
    q.query(`select trip_id, count(*)::int as n from correction_requests
              where trip_id = any($1) and status in ('pending','first_approved') group by trip_id`, [ids]),
    q.query('select * from pay_records where trip_id = any($1)', [ids]),
    getSettings(q),
    teamIds.length ? q.query(`select t.id, t.team_id, t.driver_id, t.status, u.name from trips t join users u on u.id = t.driver_id
                               where t.team_id = any($1) order by t.id`, [teamIds]) : { rows: [] },
  ]);
  const now = new Date().toISOString();
  return trips.map((t) => {
    const events = ev.rows.filter((e) => e.trip_id === t.id);
    const eff = L.effectiveTimes(events);
    const at = (k) => (eff[k] ? eff[k].occurred_at : null);
    const pr = pay.rows.find((p) => p.trip_id === t.id) || null;
    // Driver's own hourly rate wins over the company rate
    const prof = L.profileOf(t.pay_profile);
    const calc = L.computePay(at('depart'), at('return'), payCfg(settings, t.driver_rate, prof), { mealPaid: prof.meal_paid });
    const { flags, elapsed } = L.flags(t, eff, settings, now);
    const pending = (corr.rows.find((c) => c.trip_id === t.id) || { n: 0 }).n;
    return {
      id: t.id, trip_no: t.trip_no, driver_id: t.driver_id, driver_name: t.driver_name,
      vehicle: t.vehicle, vehicle_type: t.vehicle_type || null,
      // Team trip: two drivers, one trip row each (each has their own times and pay). `mates` = the other driver.
      team: t.team_id ? { lead_id: t.team_id, mates: mateRows.rows.filter((m) => m.team_id === t.team_id && m.id !== t.id)
        .map((m) => ({ trip_id: m.id, driver_id: m.driver_id, name: m.name, status: m.status })) } : null,
      pickup_location: t.pickup_location, destination: t.destination,
      planned_departure: t.planned_departure, planned_hours: t.planned_hours == null ? null : Number(t.planned_hours),
      cargo_ref: t.cargo_ref, status: t.status, driver_rate: t.driver_rate == null ? null : Number(t.driver_rate), pay_profile: prof, accept_opens_at: L.acceptOpensAt(t.planned_departure, settings),
      times: { depart: at('depart'), pickup_done: at('pickup_done'), return: at('return'), receipt: at('receipt') },
      receipt: eff.receipt ? eff.receipt.data : null,
      events: events.map((e) => ({ id: e.id, type: e.type, occurred_at: e.occurred_at, method: e.method,
        recorded_by_name: e.recorded_by_name, data: e.data, created_at: e.created_at })),
      memos: memos.rows.filter((m) => m.trip_id === t.id)
        .map((m) => ({ id: m.id, note: m.note, author_name: m.author_name, created_at: m.created_at })),
      pending_corrections: pending,
      flags, elapsed_min: elapsed,
      pay: pr
        ? { approved: true, recorded: pr.recorded_minutes, recognized: pr.recognized_minutes, ot: pr.ot_minutes,
            regular: pr.recognized_minutes - pr.ot_minutes - pr.stat_minutes - pr.double_minutes, stat: pr.stat_minutes, dbl: pr.double_minutes,
            callin: pr.callin_minutes, meal_paid: pr.meal_paid, vacation: Number(pr.vacation_pay),
            rate: pr.hourly_rate == null ? null : Number(pr.hourly_rate), amount: pr.amount == null ? null : Number(pr.amount),
            adjustment_reason: pr.adjustment_reason, approved_at: pr.approved_at, paid_at: pr.paid_at, payment_ref: pr.payment_ref }
        : { approved: false, ...calc },
    };
  });
}

// Logistics views count a team trip once: keep one row per team (the first one) and show both driver names.
function collapseTeams(list) {
  const seen = new Set();
  return list.filter((t) => {
    if (!t.team) return true;
    if (seen.has(t.team.lead_id)) return false;
    seen.add(t.team.lead_id); return true;
  });
}

// Can this user see one trip: needs an all-trips permission or it must be their own. Otherwise 404 (hides existence)
async function tripFor(req, id, q = db) {
  const p = req.perms;
  const all = ['history.all', 'board.view', 'dispatch.view', 'dispatch.edit', 'receipt.view', 'receipt.edit',
    'correction.view', 'correction.first', 'correction.final', 'pay.view', 'pay.approve'].some((x) => p.has(x));
  const list = await loadTrips(all ? 't.id = $1' : 't.id = $1 and t.driver_id = $2', all ? [id] : [id, req.user.id], q);
  if (!list.length) throw notFound();
  return list[0];
}

// Recompute status from effective events (never touches approved/paid)
async function recomputeStatus(q, tripId) {
  const { rows: [t] } = await q.query('select status from trips where id = $1 for update', [tripId]);
  if (['approved', 'paid', 'cancelled'].includes(t.status)) return t.status;
  const { rows } = await q.query('select * from trip_events where trip_id = $1 order by id', [tripId]);
  const eff = L.effectiveTimes(rows);
  let s = 'dispatched';
  if (eff.depart) s = 'in_progress';
  if (eff.pickup_done) s = 'returning';
  if (eff.return) s = eff.receipt ? 'received' : 'returned';
  await q.query('update trips set status = $2 where id = $1', [tripId, s]);
  return s;
}

// ---------- current user ----------
r.get('/me', wrap(async (req, res) => {
  res.json({
    app_version: L.APP_VERSION,
    user: { id: req.user.id, name: req.user.name, username: req.user.username, roles: req.user.roles },
    must_change_pw: !!req.user.must_change_pw, demo: process.env.DEMO_LOGIN === 'true',
    demo_reset: req.user.roles.includes('admin') && db.demoResetAllowed(),
    perms: [...req.perms], pages: L.pagesFor(req.user.roles), csrf: req.user.csrf,
  });
}));

r.post('/me/password', wrap(async (req, res) => {
  const b = req.body || {};
  const next = str(b.new_password, 'a new password (10+ characters)', { min: 10, max: 200 });
  if (next === b.current_password) throw new Bad('Choose a password different from the current one.');
  const { rows: [u] } = await db.query('select password_hash from users where id = $1', [req.user.id]);
  const ok = await require('./auth').bcrypt.compare(String(b.current_password || ''), u.password_hash);
  if (!ok) throw new Bad('The current password is not correct.', 400);
  await db.tx(async (q) => {
    await q.query('update users set password_hash = $2, must_change_pw = false where id = $1', [req.user.id, await hashPassword(next)]);
    await q.query('delete from sessions where user_id = $1 and token_hash <> $2', [req.user.id, req.sessionHash]); // sign out other devices
    await audit(q, req, 'user.password', 'user', req.user.id, {});
  });
  res.json({ ok: true });
}));

// ---------- notifications ----------
r.get('/notifications', wrap(async (req, res) => {
  const { rows } = await db.query(
    `select id, kind, title, body, link, created_at, read_at from notifications where user_id = $1 order by id desc limit 30`, [req.user.id]);
  const { rows: [c] } = await db.query('select count(*)::int as n from notifications where user_id = $1 and read_at is null', [req.user.id]);
  res.json({ unread: c.n, items: rows });
}));
r.post('/notifications/read', wrap(async (req, res) => {
  await db.query('update notifications set read_at = now() where user_id = $1 and read_at is null', [req.user.id]);
  res.json({ ok: true });
}));
r.post('/push/subscribe', wrap(async (req, res) => {
  const b = req.body || {};
  const endpoint = str(b.endpoint, 'endpoint', { max: 1000 });
  if (!/^https:\/\//.test(endpoint)) throw new Bad('Invalid push endpoint.');
  const keys = b.keys || {};
  const p256dh = str(keys.p256dh, 'key', { max: 200 });
  const authKey = str(keys.auth, 'key', { max: 100 });
  await db.query(`insert into push_subs(user_id, endpoint, p256dh, auth) values ($1,$2,$3,$4)
                  on conflict (endpoint) do update set user_id = excluded.user_id, p256dh = excluded.p256dh, auth = excluded.auth`,
  [req.user.id, endpoint, p256dh, authKey]);
  res.json({ ok: true });
}));
r.post('/push/unsubscribe', wrap(async (req, res) => {
  await db.query('delete from push_subs where user_id = $1 and endpoint = $2', [req.user.id, String((req.body || {}).endpoint || '')]);
  res.json({ ok: true });
}));

// ---------- Today (office home): only things that need someone's action ----------
r.get('/today', wrap(async (req, res) => {
  const trips = await loadTrips(`t.status not in ('paid','cancelled')`, []);
  const { rows: corrections } = await db.query(
    `select c.id, c.trip_id, c.status, c.requested_by, c.first_by, t.trip_no, u.name as driver_name
       from correction_requests c join trips t on t.id = c.trip_id join users u on u.id = t.driver_id
      where c.status in ('pending','first_approved')`);
  res.json(L.todayItems({ perms: req.perms, userId: req.user.id, trips, corrections, settings: await getSettings(), now: Date.now() }));
}));

r.get('/drivers', requireAny('dispatch.view', 'dispatch.edit', 'history.all', 'pay.view', 'pay.approve', 'payout.view', 'payout.edit', 'payhist.view'),
  wrap(async (req, res) => {
    const { rows } = await db.query(
      `select u.id, u.name from users u join user_roles r on r.user_id = u.id and r.role = 'driver'
        where u.active order by u.name`);
    res.json(rows);
  }));

// ---------- trip lists ----------
r.get('/trips', wrap(async (req, res) => {
  const p = req.perms;
  const scope = String(req.query.scope || '');
  const from = when(req.query.from, 'start date', { optional: true });
  const to = when(req.query.to, 'end date', { optional: true });
  const driver = int(req.query.driver_id, 'driver', { optional: true });
  const cond = [];
  const params = [];
  const add = (sql, v) => { params.push(v); cond.push(sql.replace('?', `$${params.length}`)); };

  if (scope === 'my') {
    if (!p.has('trip.own')) throw new Bad('You do not have permission.', 403);
    add('t.driver_id = ?', req.user.id);
    cond.push(`t.status in ('dispatched','in_progress','returning')`); // finished trips live in Trip History
  } else if (scope === 'board') {
    if (!p.has('board.view')) throw new Bad('You do not have permission.', 403);
    cond.push(`t.status in ('dispatched','in_progress','returning','returned')`);
  } else if (scope === 'dispatch') {
    if (!p.has('dispatch.view') && !p.has('dispatch.edit')) throw new Bad('You do not have permission.', 403);
    cond.push(`(t.status = 'dispatched' or t.created_at > now() - interval '7 days')`);
  } else if (scope === 'receipt') {
    if (!p.has('receipt.view') && !p.has('receipt.edit')) throw new Bad('You do not have permission.', 403);
    cond.push(`(t.status in ('in_progress','returning','returned') or (t.status = 'received' and t.created_at > now() - interval '3 days'))`);
  } else if (scope === 'history') {
    if (p.has('history.all')) { if (driver) add('t.driver_id = ?', driver); }
    else if (p.has('history.own')) add('t.driver_id = ?', req.user.id); // drivers only ever see their own
    else throw new Bad('You do not have permission.', 403);
    if (from) add('t.planned_departure >= ?', from);
    if (to) add('t.planned_departure < ?', to);
  } else throw new Bad('Invalid request.');

  const list = await loadTrips(cond.length ? cond.join(' and ') : 'true', params);
  // Live trips, Receiving and the full Trip History count a team trip once. A driver's own lists keep their own row.
  const once = scope === 'board' || scope === 'receipt' || (scope === 'history' && p.has('history.all') && !driver);
  res.json(once ? collapseTeams(list) : list);
}));

r.get('/trips/:id', wrap(async (req, res) => {
  res.json(await tripFor(req, int(req.params.id, 'id', { min: 1 })));
}));

// ---------- dispatch ----------
r.post('/trips', requireAny('dispatch.edit'), wrap(async (req, res) => {
  const b = req.body || {};
  const driverId = int(b.driver_id, 'driver', { min: 1 });
  // Optional second driver = team trip (both drivers get the trip, each with their own times and pay)
  const driver2 = int(b.second_driver_id, 'second driver', { min: 1, optional: true });
  if (driver2 === driverId) throw new Bad('Pick two different drivers for a team trip.');
  const v = {
    vehicle_type: str(b.vehicle_type, 'vehicle type', { max: 40, optional: true }),
    vehicle: str(b.vehicle, 'vehicle', { max: 40 }),
    pickup: str(b.pickup_location, 'pickup location', { max: 200 }),
    dest: str(b.destination, 'destination', { max: 200 }),
    planned: when(b.planned_departure, 'planned departure'),
    hours: num(b.planned_hours, 'estimated hours', { min: 0, max: 48, optional: true }),
    cargo: str(b.cargo_ref, 'cargo / PO number', { max: 100, optional: true }),
  };
  const out = await db.tx(async (q) => {
    for (const id of [driverId, driver2].filter(Boolean)) {
      const { rows: d } = await q.query(
        `select 1 from users u join user_roles r on r.user_id = u.id and r.role = 'driver' where u.id = $1 and u.active`, [id]);
      if (!d.length) throw new Bad('Driver not found.');
    }
    if (v.vehicle_type) {
      const { rows: vt } = await q.query('select name from vehicle_types where lower(name) = lower($1)', [v.vehicle_type]);
      if (!vt.length) throw new Bad('Pick a vehicle type from the list, or add it with the Add button.');
      v.vehicle_type = vt[0].name;
    }
    const { rows: [{ n }] } = await q.query(`select count(*)::int + 1 as n from trips where created_at::date = now()::date`);
    const tripNo = `T${new Date().toISOString().slice(2, 10).replace(/-/g, '')}-${String(n).padStart(3, '0')}`;
    const ins = (no, driver) => q.query(
      `insert into trips(trip_no, driver_id, vehicle, vehicle_type, pickup_location, destination, planned_departure, planned_hours, cargo_ref, created_by)
       values ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10) returning id, trip_no`,
      [no, driver, v.vehicle, v.vehicle_type, v.pickup, v.dest, v.planned, v.hours, v.cargo, req.user.id]).then((x) => x.rows[0]);
    const t = await ins(tripNo, driverId);
    await audit(q, req, 'trip.create', 'trip', t.id, { trip_no: t.trip_no, driver_id: driverId, ...v });
    if (driver2) {
      // Team trip: a second row for the second driver, linked to the first (trip number gets -B)
      const t2 = await ins(`${tripNo}-B`, driver2);
      await q.query('update trips set team_id = $1 where id in ($1, $2)', [t.id, t2.id]);
      await audit(q, req, 'trip.create', 'trip', t2.id, { trip_no: t2.trip_no, driver_id: driver2, team_with: t.id, ...v });
      t.team_trip_id = t2.id;
    }
    // Every address used in Dispatch is saved to the address book automatically
    for (const a of [v.pickup, v.dest]) await saveAddress(q, a, req.user.id);
    return t;
  });
  const startTxt = new Date(v.planned).toLocaleString('en-CA', { timeZone: L.TIMEZONE, weekday: 'short', month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit', hour12: false });
  await N.safeNotify([driverId], { kind: 'trip', title: driver2 ? 'New team trip assigned' : 'New trip assigned', body: `${startTxt} · ${v.pickup} → ${v.dest}`, link: '#my', key: `trip:${out.id}` });
  if (driver2) await N.safeNotify([driver2], { kind: 'trip', title: 'New team trip assigned', body: `${startTxt} · ${v.pickup} → ${v.dest}`, link: '#my', key: `trip:${out.team_trip_id}` });
  res.status(201).json(out);
}));

// ---------- vehicle types (10 ton, 5 ton ...) ----------
// A plain list; Scheduler/Admin add a new type with one button. Trips keep the type's name as it was when assigned.
r.get('/vehicle-types', requireAny('dispatch.view', 'dispatch.edit'), wrap(async (req, res) => {
  const { rows } = await db.query('select id, name from vehicle_types order by id');
  res.json(rows);
}));
r.post('/vehicle-types', requireAny('dispatch.edit'), wrap(async (req, res) => {
  const name = str((req.body || {}).name, 'a vehicle type', { max: 40 }).replace(/\s+/g, ' ');
  const row = await db.tx(async (q) => {
    const { rows: dup } = await q.query('select 1 from vehicle_types where lower(name) = lower($1)', [name]);
    if (dup.length) throw new Bad('That vehicle type is already in the list.', 409);
    const { rows: [x] } = await q.query('insert into vehicle_types(name) values ($1) returning id, name', [name]);
    await audit(q, req, 'vehicle_type.add', 'vehicle_type', x.id, { name });
    return x;
  });
  res.status(201).json(row);
}));

// ---------- address book ----------
async function saveAddress(q, text, userId) {
  const a = String(text).trim().replace(/\s+/g, ' ');
  if (!a) return;
  await q.query(
    `insert into addresses(address, created_by, use_count, last_used) values ($1,$2,1,now())
     on conflict (lower(address)) do update set use_count = addresses.use_count + 1, last_used = now()`, [a, userId]);
}
r.get('/addresses', requireAny('dispatch.view', 'dispatch.edit'), wrap(async (req, res) => {
  const { rows } = await db.query('select id, address, use_count, last_used from addresses order by use_count desc, address limit 1000');
  res.json(rows);
}));
r.post('/addresses', requireAny('dispatch.edit'), wrap(async (req, res) => {
  const a = str((req.body || {}).address, 'an address', { max: 200 });
  await db.tx(async (q) => { await saveAddress(q, a, req.user.id); await audit(q, req, 'address.add', 'address', null, { address: a }); });
  res.status(201).json({ ok: true });
}));
r.post('/addresses/:id', requireAny('dispatch.edit'), wrap(async (req, res) => {
  const id = int(req.params.id, 'id', { min: 1 });
  const b = req.body || {};
  await db.tx(async (q) => {
    const { rows: [x] } = await q.query('select address from addresses where id = $1 for update', [id]);
    if (!x) throw notFound();
    if (b.remove === true) {
      await q.query('delete from addresses where id = $1', [id]);
      await audit(q, req, 'address.remove', 'address', id, { address: x.address });
    } else {
      const a = str(b.address, 'an address', { max: 200 }).replace(/\s+/g, ' ');
      const { rows: dup } = await q.query('select 1 from addresses where lower(address) = lower($1) and id <> $2', [a, id]);
      if (dup.length) throw new Bad('That address is already saved.', 409);
      await q.query('update addresses set address = $2 where id = $1', [id, a]);
      await audit(q, req, 'address.edit', 'address', id, { before: x.address, after: a });
    }
  });
  res.json({ ok: true });
}));

r.post('/trips/:id/cancel', requireAny('dispatch.edit'), wrap(async (req, res) => {
  const id = int(req.params.id, 'id', { min: 1 });
  const reason = str((req.body || {}).reason, 'a cancel reason', { max: 500 });
  await db.tx(async (q) => {
    const { rows: [t] } = await q.query('select status, team_id from trips where id = $1 for update', [id]);
    if (!t) throw notFound();
    // A team trip is cancelled for both drivers, and only while neither has accepted
    const { rows: group } = await q.query('select id, status from trips where id = $1 or (team_id is not null and team_id = $2) order by id for update', [id, t.team_id]);
    if (group.some((x) => x.status !== 'dispatched')) throw new Bad(t.team_id ? 'Only team trips that neither driver has accepted can be cancelled.' : 'Only trips that have not departed can be cancelled.', 409);
    for (const x of group) {
      await q.query(`update trips set status = 'cancelled' where id = $1`, [x.id]);
      await audit(q, req, 'trip.cancel', 'trip', x.id, { reason });
    }
  });
  res.json({ ok: true });
}));

// ---------- driver buttons ----------
// Times come from the server clock. The app waits 10 seconds before sending Accept/Finish (so the driver can undo),
// so it sends the moment of the tap; the server accepts it only if it is at most 2 minutes old and not in the future.
r.post('/trips/:id/events', requireAny('trip.own'), wrap(async (req, res) => {
  const id = int(req.params.id, 'id', { min: 1 });
  const type = oneOf((req.body || {}).type, 'type', L.DRIVER_EVENTS);
  const tapped = (req.body || {}).at;
  let at = null;
  if (tapped != null) {
    const ms = new Date(String(tapped)).getTime();
    if (Number.isFinite(ms) && ms <= Date.now() + 5000 && ms >= Date.now() - 120000) at = new Date(Math.min(ms, Date.now())).toISOString();
  }
  const out = await db.tx(async (q) => {
    const { rows: [t] } = await q.query('select * from trips where id = $1 for update', [id]);
    // non-admins: own trips only
    if (!t || (t.driver_id !== req.user.id && !req.user.roles.includes('admin'))) throw notFound();
    if (!(L.ALLOWED_EVENTS[t.status] || []).includes(type)) {
      // Usually a double tap or a second phone: the step was already recorded
      const done = t.status === 'cancelled' ? 'This trip was cancelled.'
        : (type === 'return' && !L.ACTIVE_STATUSES.includes(t.status)) ? 'This trip is already finished.'
        : (type === 'depart' && t.status !== 'dispatched') ? 'This trip is already accepted.'
        : `'${L.BUTTON_LABELS[type]}' is not available right now.`;
      throw new Bad(done, 409);
    }
    if (type === 'depart') {
      // Accept starts the pay clock, so it only opens shortly before the planned departure (server clock)
      const opens = L.acceptOpensAt(t.planned_departure, await getSettings(q));
      if (Date.now() < new Date(opens).getTime()) {
        throw new Bad(`Accept opens at ${new Date(opens).toLocaleString('en-CA', { timeZone: process.env.TZ_DISPLAY || L.TIMEZONE, month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit', hour12: false })}.`, 409);
      }
      const { rows: other } = await q.query(
        `select trip_no from trips where driver_id = $1 and id <> $2 and status in ('in_progress','returning')`, [t.driver_id, id]);
      if (other.length) throw new Bad(`You already have a trip in progress (${other[0].trip_no}).`, 409);
    }
    const { rows: [e] } = await q.query(
      `insert into trip_events(trip_id, type, occurred_at, recorded_by, method) values ($1,$2,coalesce($4::timestamptz, now()),$3,'button') returning id, occurred_at`,
      [id, type, req.user.id, at]);
    const status = await recomputeStatus(q, id);
    await audit(q, req, 'trip.event', 'trip', id, { type, event_id: e.id, tapped_at: at });
    return { status, occurred_at: e.occurred_at };
  });
  res.json(out);
}));

// ---------- receiving ----------
r.post('/trips/:id/receipt', requireAny('receipt.edit'), wrap(async (req, res) => {
  const id = int(req.params.id, 'id', { min: 1 });
  const b = req.body || {};
  const result = oneOf(b.result, 'inspection result', ['ok', 'issue']);
  const note = str(b.note, 'issue details', { max: 1000, optional: result === 'ok' });
  // Fish received: one line per species / lot number
  const raw = Array.isArray(b.items) ? b.items : [];
  if (raw.length > 30) throw new Bad('Too many lines (30 max).');
  const items = raw.map((x) => {
    x = x || {};
    const species = str(x.species, 'the fish species', { max: 80 });
    const lot = str(x.lot, 'the lot number', { max: 60 });
    // Weight is entered in lb; tonnes is kept alongside for reports (older clients may still send tonnes)
    const lb = x.lb != null && x.lb !== '' ? num(x.lb, 'the weight in lb', { min: 1, max: 220000 })
      : Math.round(num(x.tonnes, 'the weight in lb', { min: 0.001, max: 100 }) * L.LB_PER_TONNE);
    const unit = x.unit ? oneOf(x.unit, 'case or tote', Object.keys(L.PACK_UNITS)) : null;
    const count = unit ? (x.count == null || x.count === '' ? L.countFromWeight(lb, unit) : int(x.count, 'the count', { min: 1, max: 100000 })) : null;
    return { species, lot, lb, tonnes: Math.round(lb / L.LB_PER_TONNE * 1000) / 1000, unit, count };
  });
  if (!items.length) throw new Bad('Please enter at least one fish line (species, lot number, weight).');
  // Received date and time: defaults to now; may be entered for the past 7 days, never the future
  const at = b.received_at ? when(b.received_at, 'received time') : new Date().toISOString();
  const atMs = new Date(at).getTime();
  if (atMs > Date.now() + 5 * 60000 || atMs < Date.now() - 7 * 864e5) throw new Bad('Received time must be within the last 7 days.');
  const out = await db.tx(async (q) => {
    const { rows: [t] } = await q.query('select status, team_id from trips where id = $1 for update', [id]);
    if (!t) throw notFound();
    // A team trip is received once: the same record is saved on both drivers' trips, and both must have finished
    const { rows: group } = await q.query('select id, status from trips where id = $1 or (team_id is not null and team_id = $2) order by id for update', [id, t.team_id]);
    if (group.some((x) => x.status !== 'returned')) {
      throw new Bad(t.team_id ? 'Both drivers of this team trip must tap Finish before it can be received.' : 'Only trips the driver has finished can be received.', 409);
    }
    let status;
    for (const x of group) {
      const { rows: [e] } = await q.query(
        `insert into trip_events(trip_id, type, occurred_at, recorded_by, method, data) values ($1,'receipt',$2,$3,'receipt',$4) returning id`,
        [x.id, at, req.user.id, JSON.stringify({ result, note, items })]);
      const st = await recomputeStatus(q, x.id);
      if (x.id === id) status = st;
      await audit(q, req, 'trip.receipt', 'trip', x.id, { result, note, items, received_at: at, event_id: e.id });
    }
    return { status };
  });
  res.json(out);
}));

// ---------- exception notes (logistics manager) ----------
r.post('/trips/:id/memos', requireAny('board.memo'), wrap(async (req, res) => {
  const id = int(req.params.id, 'id', { min: 1 });
  const note = str((req.body || {}).note, 'a note', { max: 1000 });
  await db.tx(async (q) => {
    const { rows } = await q.query('select 1 from trips where id = $1', [id]);
    if (!rows.length) throw notFound();
    const { rows: [m] } = await q.query('insert into trip_memos(trip_id, author_id, note) values ($1,$2,$3) returning id', [id, req.user.id, note]);
    await audit(q, req, 'trip.memo', 'trip', id, { memo_id: m.id, note });
  });
  res.status(201).json({ ok: true });
}));

// ---------- corrections (driver requests -> scheduler first approval -> payroll final) ----------
r.get('/corrections', requireAny('correction.own', 'correction.view', 'correction.first', 'correction.final'),
  wrap(async (req, res) => {
    const p = req.perms;
    const seeAll = p.has('correction.view') || p.has('correction.first') || p.has('correction.final');
    const { rows } = await db.query(
      `select c.*, t.trip_no, t.driver_id, d.name as driver_name, rq.name as requested_by_name,
              f.name as first_by_name, fn.name as final_by_name,
              (select occurred_at from trip_events e where e.trip_id = c.trip_id and e.type = c.event_type
                 and e.id < coalesce(c.result_event_id, 2147483647) order by e.id desc limit 1) as original_time
         from correction_requests c
         join trips t on t.id = c.trip_id join users d on d.id = t.driver_id
         join users rq on rq.id = c.requested_by
         left join users f on f.id = c.first_by left join users fn on fn.id = c.final_by
        where ${seeAll ? 'true' : 't.driver_id = $1'}
        order by (c.status in ('pending','first_approved')) desc, c.id desc limit 200`,
      seeAll ? [] : [req.user.id]);
    res.json(rows);
  }));

r.post('/corrections', requireAny('correction.own'), wrap(async (req, res) => {
  const b = req.body || {};
  const tripId = int(b.trip_id, 'trip', { min: 1 });
  const type = oneOf(b.event_type, 'the item to correct', L.DRIVER_EVENTS);
  const time = when(b.requested_time, 'the correct time');
  const reason = str(b.reason, 'a reason', { max: 1000 });
  if (new Date(time) > new Date(Date.now() + 5 * 60000)) throw new Bad('A correction cannot be set in the future.');
  const out = await db.tx(async (q) => {
    const { rows: [t] } = await q.query('select * from trips where id = $1 for update', [tripId]);
    if (!t || (t.driver_id !== req.user.id && !req.user.roles.includes('admin'))) throw notFound();
    if (['approved', 'paid', 'cancelled'].includes(t.status)) throw new Bad('This trip is pay-approved and can no longer be corrected. It will be handled as an adjustment on the next pay run.', 409);
    const { rows: dup } = await q.query(
      `select 1 from correction_requests where trip_id = $1 and event_type = $2 and status in ('pending','first_approved')`, [tripId, type]);
    if (dup.length) throw new Bad('There is already an open correction for this item.', 409);
    await assertOrder(q, tripId, type, time);
    const { rows: [c] } = await q.query(
      `insert into correction_requests(trip_id, event_type, requested_time, reason, requested_by) values ($1,$2,$3,$4,$5) returning id`,
      [tripId, type, time, reason, req.user.id]);
    await audit(q, req, 'correction.request', 'correction', c.id, { trip_id: tripId, event_type: type, requested_time: time, reason });
    return { ...c, trip_no: t.trip_no };
  });
  await N.safeNotify(N.usersWith(['correction.first'], [req.user.id]), { kind: 'correction', title: 'Time correction to check',
    body: `${req.user.name} · trip ${out.trip_no}: ${L.EVENT_LABELS[type]} time`, link: '#corrections', key: `corr1:${out.id}` });
  res.status(201).json({ id: out.id });
}));

async function assertOrder(q, tripId, type, time) {
  const { rows } = await q.query('select * from trip_events where trip_id = $1 order by id', [tripId]);
  const eff = L.effectiveTimes(rows);
  const times = {};
  L.DRIVER_EVENTS.forEach((k) => { times[k] = eff[k] ? eff[k].occurred_at : null; });
  times[type] = time;
  if (!L.orderOk(times)) throw new Bad('Times are out of order. They must go Accept -> Pickup Done -> Finish.', 409);
}

async function decide(req, res, stage) {
  const id = int(req.params.id, 'id', { min: 1 });
  const b = req.body || {};
  const approve = b.approve === true;
  const reason = approve ? null : str(b.reason, 'a rejection reason', { max: 500 });
  const out = await db.tx(async (q) => {
    const { rows: [c] } = await q.query('select * from correction_requests where id = $1 for update', [id]);
    if (!c) throw notFound();
    const expected = stage === 'first' ? 'pending' : 'first_approved';
    if (c.status !== expected) throw new Bad('Already handled, or the previous approval step is still pending.', 409);
    // Separation of duties: the requester and the first approver cannot handle the next step of the same request
    if (c.requested_by === req.user.id) throw new Bad('You cannot approve your own correction request.', 403);
    if (stage === 'final' && c.first_by === req.user.id) throw new Bad('The first approver cannot also give final approval.', 403);
    if (!approve) {
      await q.query(`update correction_requests set status = 'rejected', reject_reason = $2,
                       ${stage}_by = $3, ${stage}_at = now() where id = $1`, [id, reason, req.user.id]);
      await audit(q, req, `correction.${stage}.reject`, 'correction', id, { reason });
      return { status: 'rejected' };
    }
    if (stage === 'first') {
      await q.query(`update correction_requests set status = 'first_approved', first_by = $2, first_at = now() where id = $1`, [id, req.user.id]);
      await audit(q, req, 'correction.first.approve', 'correction', id, {});
      return { status: 'first_approved' };
    }
    const { rows: [t] } = await q.query('select status from trips where id = $1 for update', [c.trip_id]);
    if (['approved', 'paid', 'cancelled'].includes(t.status)) throw new Bad('This trip is already pay-approved.', 409);
    await assertOrder(q, c.trip_id, c.event_type, c.requested_time);
    const { rows: [e] } = await q.query(
      `insert into trip_events(trip_id, type, occurred_at, recorded_by, method, data)
       values ($1,$2,$3,$4,'correction',$5) returning id`,
      [c.trip_id, c.event_type, c.requested_time, req.user.id, JSON.stringify({ correction_id: id })]);
    await q.query(`update correction_requests set status = 'approved', final_by = $2, final_at = now(), result_event_id = $3 where id = $1`,
      [id, req.user.id, e.id]);
    await recomputeStatus(q, c.trip_id);
    await audit(q, req, 'correction.final.approve', 'correction', id, { event_id: e.id });
    return { status: 'approved' };
  });
  const { rows: [c] } = await db.query(
    `select c.*, t.trip_no, t.driver_id from correction_requests c join trips t on t.id = c.trip_id where c.id = $1`, [id]);
  if (out.status === 'first_approved') {
    await N.safeNotify(N.usersWith(['correction.final'], [c.requested_by, c.first_by]), { kind: 'correction', title: 'Correction ready for final approval',
      body: `Trip ${c.trip_no}: ${L.EVENT_LABELS[c.event_type]} time`, link: '#corrections', key: `corr2:${id}` });
  } else {
    await N.safeNotify([c.requested_by], { kind: 'correction', title: out.status === 'approved' ? 'Your time correction was approved' : 'Your time correction was not approved',
      body: `Trip ${c.trip_no}: ${L.EVENT_LABELS[c.event_type]}${c.reject_reason ? ' · ' + c.reject_reason : ''}`, link: '#history', key: `corr3:${id}` });
  }
  res.json(out);
}
r.post('/corrections/:id/first', requireAny('correction.first'), wrap((req, res) => decide(req, res, 'first')));
r.post('/corrections/:id/final', requireAny('correction.final'), wrap((req, res) => decide(req, res, 'final')));

// ---------- pay approval ----------
const PAID_STATUSES = `('returned','received','approved','paid')`;
r.get('/pay', requireAny('pay.own', 'pay.view', 'pay.approve'), wrap(async (req, res) => {
  const all = req.perms.has('pay.view') || req.perms.has('pay.approve');
  const from = when(req.query.from, 'start date', { optional: true });
  const to = when(req.query.to, 'end date', { optional: true });
  const driver = int(req.query.driver_id, 'driver', { optional: true });
  const cond = [`t.status in ${PAID_STATUSES}`];
  const params = [];
  const add = (sql, v) => { params.push(v); cond.push(sql.replace('?', `$${params.length}`)); };
  const only = all ? driver : req.user.id;
  if (only) add('t.driver_id = ?', only);
  if (from) add('t.planned_departure >= ?', from);
  if (to) add('t.planned_departure < ?', to);
  const trips = await withDriverPay(await loadTrips(cond.join(' and '), params));
  const settings = await getSettings();
  // Trips whose driver has not pressed Finish yet: shown to Payroll as "waiting", never approvable
  let waiting = [];
  if (req.perms.has('pay.approve')) {
    const wc = cond.filter((c) => !c.startsWith('t.status')).concat(`t.status in ('dispatched','in_progress','returning')`);
    waiting = (await loadTrips(wc.join(' and '), params)).map((t) => ({ id: t.id, trip_no: t.trip_no, driver_name: t.driver_name, status: t.status,
      planned_departure: t.planned_departure, team: t.team, vehicle_type: t.vehicle_type, elapsed_min: t.elapsed_min, pickup_location: t.pickup_location, destination: t.destination }));
  }
  res.json({ trips, waiting, holidays: await holidayItems(only, from, to, settings), rules: L.rulesOf(settings),
    settings: { hourly_rate: settings.hourly_rate, rounding_unit_min: settings.rounding_unit_min,
      rounding_mode: settings.rounding_mode, meal_deduction_min: settings.meal_deduction_min, currency: settings.currency } });
}));

// Overtime, minimum pay and holiday eligibility depend on the driver's other trips, so load whole weeks around the
// trips plus the 30 days before.
async function driverContext(driverId, fromDay, toDay, q = db) {
  const from = new Date(L.weekOf(fromDay) + 'T00:00:00Z').getTime() - 32 * 864e5;
  const to = new Date(L.weekOf(toDay) + 'T00:00:00Z').getTime() + 9 * 864e5;
  return loadTrips(`t.driver_id = $1 and t.status in ${PAID_STATUSES}
    and t.id in (select trip_id from trip_events where type = 'depart' and occurred_at >= $2 and occurred_at < $3)`,
  [driverId, new Date(from).toISOString(), new Date(to).toISOString()], q);
}
async function withDriverPay(trips, q = db, override = {}) {
  const byDriver = new Map();
  trips.forEach((t) => { if (!byDriver.has(t.driver_id)) byDriver.set(t.driver_id, []); byDriver.get(t.driver_id).push(t); });
  const settings = await getSettings(q);
  for (const [driverId, list] of byDriver) {
    const days = list.map((t) => t.times.depart).filter(Boolean).map(L.localDay).sort();
    if (!days.length) continue;
    const ctx = await driverContext(driverId, days[0], days[days.length - 1], q);
    ctx.forEach((t) => { if (override[t.id] != null && !t.pay.approved) t.pay.recognized = override[t.id]; });
    const d = ctx[0] || list[0];
    L.applyDriverPay(ctx, d.pay_profile, d.driver_rate != null ? d.driver_rate : settings.hourly_rate, settings);
    list.forEach((t) => { const c = ctx.find((x) => x.id === t.id); if (c) t.pay = c.pay; });
  }
  return trips;
}

// Stat holidays a driver did not work: computed (not approved yet) for the last 45 days, plus approved ones in the period
const todayLocal = () => L.localDay(new Date().toISOString());
async function holidayDue(driverId, q = db) {
  const { rows: [u] } = await q.query('select id, name, hourly_rate, pay_profile from users where id = $1', [driverId]);
  if (!u) return [];
  const settings = await getSettings(q);
  const today = todayLocal();
  const ctx = await driverContext(driverId, L.addDays(today, -80), today, q);
  L.applyDriverPay(ctx, u.pay_profile, u.hourly_rate != null ? u.hourly_rate : settings.hourly_rate, settings);
  const { rows: done } = await q.query('select holiday from holiday_pay where driver_id = $1', [driverId]);
  const doneSet = new Set(done.map((x) => (x.holiday instanceof Date ? x.holiday.toISOString().slice(0, 10) : String(x.holiday).slice(0, 10))));
  return L.holidayPayDue(ctx, u.pay_profile, settings, today, 45).filter((x) => !doneSet.has(x.date))
    .map((x) => ({ ...x, driver_id: u.id, driver_name: u.name, approved: false }));
}
const holidayRow = (x) => ({ id: x.id, driver_id: x.driver_id, driver_name: x.driver_name, date: x.holiday instanceof Date ? x.holiday.toISOString().slice(0, 10) : String(x.holiday).slice(0, 10),
  name: x.name, days_worked: x.days_worked, avg: Number(x.avg_day_pay), vacation: Number(x.vacation_pay), amount: Number(x.amount), eligible: true,
  approved: true, approved_at: x.approved_at, paid_at: x.paid_at, payment_ref: x.payment_ref });
async function holidayItems(driverId, from, to, settings) {
  const cond = ['true']; const params = [];
  if (driverId) { params.push(driverId); cond.push(`h.driver_id = $${params.length}`); }
  if (from) { params.push(from.slice(0, 10)); cond.push(`h.holiday >= $${params.length}`); }
  if (to) { params.push(to.slice(0, 10)); cond.push(`h.holiday < $${params.length}`); }
  const { rows } = await db.query(`select h.*, u.name as driver_name from holiday_pay h join users u on u.id = h.driver_id
    where ${cond.join(' and ')} order by h.holiday desc`, params);
  const out = rows.map(holidayRow);
  let ids = [driverId];
  if (!driverId) ids = (await db.query(`select u.id from users u join user_roles r on r.user_id = u.id and r.role = 'driver' where u.active`)).rows.map((x) => x.id);
  for (const id of ids) out.push(...await holidayDue(id));
  void settings;
  return out;
}
r.post('/pay/holiday/approve', requireAny('pay.approve'), wrap(async (req, res) => {
  const b = req.body || {};
  const driverId = int(b.driver_id, 'driver', { min: 1 });
  const date = str(b.date, 'holiday date', { max: 10 });
  const out = await db.tx(async (q) => {
    await q.query('select 1 from users where id = $1 for update', [driverId]);
    const item = (await holidayDue(driverId, q)).find((x) => x.date === date);
    if (!item) throw new Bad('Nothing to approve for this holiday. It may be approved already, or the driver worked that day.', 409);
    const settings = await getSettings(q);
    const { rows: [u] } = await q.query('select hourly_rate from users where id = $1', [driverId]);
    const rate = u.hourly_rate != null ? Number(u.hourly_rate) : settings.hourly_rate;
    if (rate != null && rate < L.rulesOf(settings).min_wage) throw new Bad('This driver\'s hourly rate is below the minimum wage in Pay rules. Fix it on the Drivers page first.', 409);
    const { rows: [h] } = await q.query(
      `insert into holiday_pay(driver_id, holiday, name, days_worked, avg_day_pay, vacation_pay, amount, approved_by)
       values ($1,$2,$3,$4,$5,$6,$7,$8) returning id`, [driverId, item.date, item.name, item.days_worked, item.avg, item.vacation, item.amount, req.user.id]);
    await audit(q, req, 'pay.holiday', 'user', driverId, { date: item.date, name: item.name, days_worked: item.days_worked, eligible: item.eligible, amount: item.amount });
    return { id: h.id, amount: item.amount };
  });
  res.json(out);
}));

// Drivers page: each driver's pay options
r.get('/pay/drivers', requireAny('pay.view', 'pay.approve'), wrap(async (req, res) => {
  const { rows } = await db.query(
    `select u.id, u.name, u.hourly_rate, u.pay_profile from users u join user_roles r on r.user_id = u.id and r.role = 'driver'
      where u.active order by u.name`);
  res.json(rows.map((u) => ({ id: u.id, name: u.name, hourly_rate: u.hourly_rate == null ? null : Number(u.hourly_rate), profile: L.profileOf(u.pay_profile) })));
}));
const bool = (v, def) => (v == null || v === '' ? def : v === true || v === 'true');
// Payroll sets a driver's pay options. Already approved trips keep their numbers.
r.post('/pay/profile/:driverId', requireAny('pay.approve', 'settings.edit'), wrap(async (req, res) => {
  const id = int(req.params.driverId, 'driver', { min: 1 });
  const b = req.body || {};
  const rate = num(b.hourly_rate, 'hourly rate', { min: 0, max: 1000, optional: true });
  const profile = {
    ot_rule: oneOf(b.ot_rule || 'none', 'overtime rule', Object.keys(L.OT_RULES)),
    vacation_pct: num(b.vacation_pct === '' || b.vacation_pct == null ? 0 : b.vacation_pct, 'vacation pay %', { min: 0, max: 20 }),
    meal_min: int(b.meal_min, 'meal break minutes', { min: 0, max: 240, optional: true }),
    stat_pay: bool(b.stat_pay, true), callin: bool(b.callin, true), meal_paid: bool(b.meal_paid, false),
  };
  await db.tx(async (q) => {
    const { rows: [u] } = await q.query(
      `select u.hourly_rate, u.pay_profile from users u join user_roles r on r.user_id = u.id and r.role = 'driver' where u.id = $1 for update`, [id]);
    if (!u) throw notFound();
    await q.query('update users set hourly_rate = $2, pay_profile = $3 where id = $1', [id, rate, JSON.stringify(profile)]);
    await audit(q, req, 'pay.profile', 'user', id, { before: { hourly_rate: u.hourly_rate == null ? null : Number(u.hourly_rate), ...L.profileOf(u.pay_profile) }, after: { hourly_rate: rate, ...profile } });
  });
  res.json({ ok: true });
}));

// Company pay rules (BC defaults). Payroll can change them; approved pay never changes.
r.get('/pay/rules', requireAny('pay.view', 'pay.approve', 'settings.view', 'settings.edit'), wrap(async (req, res) => {
  const settings = await getSettings();
  const year = Number(todayLocal().slice(0, 4));
  res.json({ rules: L.rulesOf(settings), bc_defaults: L.BC_RULES, holidays: [year, year + 1].map((y) => ({ year: y, list: [...L.holidayMap(settings, [y]).entries()].filter(([d]) => d.startsWith(String(y))).sort().map(([date, name]) => ({ date, name })) })) });
}));
function lines(v, name, parse) {
  if (v == null || v === '') return [];
  if (!Array.isArray(v) || v.length > 60) throw new Bad(`${name} is not in a valid format.`);
  return v.map(parse);
}
r.put('/pay/rules', requireAny('pay.approve', 'settings.edit'), wrap(async (req, res) => {
  const b = req.body || {};
  const n = (k, label, min, max) => num(b[k], label, { min, max });
  const rules = {
    min_wage: n('min_wage', 'minimum wage', 0, 1000), ot_mult: n('ot_mult', 'overtime rate', 1, 5),
    short_day_h: n('short_day_h', 'short haul daily hours', 1, 24), short_week_h: n('short_week_h', 'short haul weekly hours', 1, 168),
    long_week_h: n('long_week_h', 'long haul weekly hours', 1, 168),
    stat_mult: n('stat_mult', 'holiday rate', 1, 5), stat_double_after_h: n('stat_double_after_h', 'holiday double-time hours', 1, 24),
    stat_double_mult: n('stat_double_mult', 'holiday double-time rate', 1, 5), stat_eligible_days: int(b.stat_eligible_days, 'holiday eligibility days', { min: 0, max: 30 }),
    callin_h: n('callin_h', 'minimum pay hours', 0, 12), callin_long_h: n('callin_long_h', 'minimum pay hours (long day)', 0, 12),
    callin_long_after_h: n('callin_long_after_h', 'long day hours', 0, 24), meal_after_h: n('meal_after_h', 'meal break after hours', 0, 24),
    bc_holidays: bool(b.bc_holidays, true),
    extra_holidays: lines(b.extra_holidays, 'Extra holidays', (x) => {
      const date = str(x && x.date, 'holiday date', { max: 10 });
      if (!/^\d{4}-\d{2}-\d{2}$/.test(date) || isNaN(new Date(date))) throw new Bad(`${date} is not a valid date (use YYYY-MM-DD).`);
      return { date, name: str(x.name, 'holiday name', { max: 60, optional: true }) || 'Company holiday' };
    }),
    deductions: lines(b.deductions, 'Deductions', (x) => ({ name: str(x && x.name, 'deduction name', { max: 40 }), pct: num(x.pct, `${x.name} %`, { min: 0, max: 60 }) })),
  };
  const hourly = num(b.hourly_rate, 'company hourly rate', { min: 0, max: 1000, optional: true });
  const meal = int(b.meal_min, 'meal break minutes', { min: 0, max: 240 });
  await db.tx(async (q) => {
    const before = await getSettings(q);
    const save = (k, v) => q.query(`insert into settings(key, value) values ($1,$2) on conflict (key) do update set value = excluded.value`, [k, JSON.stringify(v)]);
    await save('pay_rules', rules); await save('hourly_rate', hourly); await save('meal_deduction_min', meal);
    await audit(q, req, 'pay.rules', 'settings', null, { before: { ...L.rulesOf(before) }, after: { ...rules, hourly_rate: hourly, meal_min: meal } });
  });
  res.json({ ok: true });
}));

r.post('/pay/:tripId/approve', requireAny('pay.approve'), wrap(async (req, res) => {
  const id = int(req.params.tripId, 'id', { min: 1 });
  res.json(await db.tx((q) => approveTrip(q, req, id, req.body || {})));
}));
// Pay approval itself. Also used by the demo seed so sample approved/paid trips carry real numbers.
async function approveTrip(q, req, id, b, approvedAt) {
  const override = int(b.recognized_minutes, 'paid minutes', { min: 0, max: 48 * 60, optional: true });
  const [trip] = await loadTrips('t.id = $1', [id], q);
  if (!trip) throw notFound();
  await q.query('select 1 from trips where id = $1 for update', [id]);
  // Pay can only be approved after the driver pressed Finish. On a team trip each driver's own trip is checked.
  if (L.ACTIVE_STATUSES.includes(trip.status) || !trip.times.return) throw new Bad(L.NOT_FINISHED_MSG, 409);
  if (!['returned', 'received'].includes(trip.status)) throw new Bad('This trip is not waiting for pay approval.', 409);
  if (trip.pending_corrections) throw new Bad('This trip has an open correction request. Resolve it before approving.', 409);
  const settings = await getSettings(q);
  // Break paid because the driver stayed on call: chosen per trip, otherwise the driver's default
  const mealPaid = b.meal_paid == null ? trip.pay_profile.meal_paid : bool(b.meal_paid, false);
  const calc = L.computePay(trip.times.depart, trip.times.return, payCfg(settings, trip.driver_rate, trip.pay_profile), { mealPaid });
  if (calc.recorded == null || calc.recorded <= 0) throw new Bad('Accept/Finish times are not valid, so this trip cannot be approved. Fix them with a correction request.', 409);
  let reason = null;
  const ov = { [id]: calc.recognized };
  if (override != null && override !== calc.recognized) {
    reason = str(b.reason, 'an adjustment reason', { max: 500 });
    ov[id] = override;
  }
  const [p] = (await withDriverPay([trip], q, ov)).map((t) => t.pay);
  if (p.rate == null || p.amount == null) throw new Bad(`No hourly rate for ${trip.driver_name} yet. Set it on the Drivers page.`, 409);
  if (p.rate < L.rulesOf(settings).min_wage) throw new Bad(`${trip.driver_name}'s hourly rate is below the minimum wage in Pay rules. Fix it on the Drivers page first.`, 409);
  await q.query(
    `insert into pay_records(trip_id, recorded_minutes, recognized_minutes, ot_minutes, stat_minutes, double_minutes, callin_minutes, meal_paid,
       hourly_rate, vacation_pay, amount, adjustment_reason, approved_by, approved_at)
     values ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,coalesce($14::timestamptz, now()))`,
    [id, calc.recorded, p.recognized, p.ot || 0, p.stat || 0, p.dbl || 0, p.callin || 0, !!calc.meal_paid, p.rate, p.vacation || 0, p.amount, reason, req.user.id, approvedAt || null]);
  await q.query(`update trips set status = 'approved' where id = $1`, [id]);
  await audit(q, req, 'pay.approve', 'trip', id, { recorded: calc.recorded, recognized: p.recognized, ot: p.ot, stat: p.stat, double: p.dbl, callin: p.callin,
    meal_paid: !!calc.meal_paid, rate: p.rate, vacation: p.vacation, amount: p.amount, rule: p.ot_rule, reason });
  return { amount: p.amount, recognized: p.recognized };
}

// ---------- payouts (accounting) ----------
async function payoutRows(req) {
  const from = when(req.query.from, 'start date', { optional: true });
  const to = when(req.query.to, 'end date', { optional: true });
  const cond = ['true'];
  const params = [];
  if (from) { params.push(from); cond.push(`t.planned_departure >= $${params.length}`); }
  if (to) { params.push(to); cond.push(`t.planned_departure < $${params.length}`); }
  const { rows } = await db.query(
    `select p.*, t.trip_no, t.vehicle, t.vehicle_type, t.destination, t.planned_departure, d.name as driver_name,
            (select string_agg(u2.name, ', ' order by t2.id) from trips t2 join users u2 on u2.id = t2.driver_id
              where t.team_id is not null and t2.team_id = t.team_id and t2.id <> t.id) as team_with,
            a.name as approved_by_name, pb.name as paid_by_name
       from pay_records p join trips t on t.id = p.trip_id join users d on d.id = t.driver_id
       join users a on a.id = p.approved_by left join users pb on pb.id = p.paid_by
      where ${cond.join(' and ')} order by p.paid_at nulls first, t.planned_departure desc limit 1000`, params);
  // Stat holiday pay (days the driver did not work) appears as its own line
  const hc = ['true']; const hp = [];
  if (from) { hp.push(from.slice(0, 10)); hc.push(`h.holiday >= $${hp.length}`); }
  if (to) { hp.push(to.slice(0, 10)); hc.push(`h.holiday < $${hp.length}`); }
  const { rows: hol } = await db.query(
    `select h.*, d.name as driver_name, a.name as approved_by_name, pb.name as paid_by_name
       from holiday_pay h join users d on d.id = h.driver_id join users a on a.id = h.approved_by left join users pb on pb.id = h.paid_by
      where ${hc.join(' and ')} order by h.paid_at nulls first, h.holiday desc limit 500`, hp);
  const settings = await getSettings();
  const out = rows.map((x) => ({ ...x, kind: 'trip' })).concat(hol.map((x) => ({
    kind: 'holiday', holiday_id: x.id, trip_id: null, trip_no: `Stat holiday · ${x.name}`, driver_name: x.driver_name,
    planned_departure: x.holiday, recorded_minutes: null, recognized_minutes: null, hourly_rate: null, vacation_pay: x.vacation_pay, amount: x.amount,
    adjustment_reason: `Average day's pay (${x.days_worked} days worked in the 30 days before)`, approved_by_name: x.approved_by_name,
    approved_at: x.approved_at, paid_at: x.paid_at, payment_ref: x.payment_ref, paid_by_name: x.paid_by_name })));
  out.forEach((x) => { const d = L.deductionsFor(x.amount, settings); x.deductions = d.total; x.net = d.net; });
  return out.sort((a, b) => (a.paid_at ? 1 : 0) - (b.paid_at ? 1 : 0) || new Date(b.planned_departure) - new Date(a.planned_departure));
}
// ---------- pay history (Payroll, Accounting) ----------
async function payHistory(req) {
  const from = when(req.query.from, 'start date', { optional: true });
  const to = when(req.query.to, 'end date', { optional: true });
  const driver = int(req.query.driver_id, 'driver', { optional: true });
  const cond = [`t.status in ('approved','paid')`];
  const params = [];
  const add = (sql, v) => { params.push(v); cond.push(sql.replace('?', `$${params.length}`)); };
  if (driver) add('t.driver_id = ?', driver);
  if (from) add('t.planned_departure >= ?', from);
  if (to) add('t.planned_departure < ?', to);
  const trips = await loadTrips(cond.join(' and '), params);
  return L.payHistoryRows(trips, {
    fish: str(req.query.fish, 'fish', { max: 80, optional: true }) || '',
    lot: str(req.query.lot, 'lot', { max: 60, optional: true }) || '',
    sort: oneOf(req.query.sort || 'date', 'sort', ['date', 'driver', 'fish', 'lot']),
  });
}
r.get('/payhist', requireAny('payhist.view'), wrap(async (req, res) => res.json(await payHistory(req))));
r.get('/payhist/export.xlsx', requireAny('payhist.view'), wrap(async (req, res) => {
  const rows = await payHistory(req);
  const day = (v) => (v ? new Date(v).toISOString().slice(0, 10) : '');
  const buf = workbook('Pay History',
    ['Date', 'Trip No', 'Driver', 'Team With', 'Vehicle Type', 'Fish', 'Lot No', 'Tonnes', 'Paid Hours', 'Hourly Rate', 'Amount', 'Status', 'Approved', 'Paid'],
    rows.map((x) => [day(x.date), x.trip_no, x.driver, x.team_with || '', x.vehicle_type || '', x.species, x.lot, x.tonnes,
      x.same_trip ? 'Same trip' : x.paid_min == null ? null : Math.round((x.paid_min / 60) * 100) / 100, x.rate, x.amount,
      L.STATUS_LABELS[x.status] || x.status, day(x.approved_at), day(x.paid_at)]),
    [12, 14, 20, 20, 14, 16, 16, 9, 11, 11, 12, 13, 12, 12]);
  await audit(null, req, 'payhist.export', 'payout', null, { rows: rows.length });
  res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
  res.setHeader('Content-Disposition', `attachment; filename="pay-history-${new Date().toISOString().slice(0, 10)}.xlsx"`);
  res.send(buf);
}));
r.get('/payout', requireAny('payout.view', 'payout.edit'), wrap(async (req, res) => {
  const settings = await getSettings();
  res.json({ rows: await payoutRows(req), deductions: L.rulesOf(settings).deductions });
}));
r.post('/payout/holiday/:id/paid', requireAny('payout.edit'), wrap(async (req, res) => {
  const id = int(req.params.id, 'id', { min: 1 });
  const ref = str((req.body || {}).payment_ref, 'payment reference', { max: 100, optional: true });
  await db.tx(async (q) => {
    const { rows: [p] } = await q.query('select paid_at from holiday_pay where id = $1 for update', [id]);
    if (!p) throw notFound();
    if (p.paid_at) throw new Bad('Already marked as paid.', 409);
    await q.query('update holiday_pay set paid_by = $2, paid_at = now(), payment_ref = $3 where id = $1', [id, req.user.id, ref]);
    await audit(q, req, 'payout.paid', 'holiday_pay', id, { payment_ref: ref });
  });
  res.json({ ok: true });
}));

r.post('/payout/:tripId/paid', requireAny('payout.edit'), wrap(async (req, res) => {
  const id = int(req.params.tripId, 'id', { min: 1 });
  const ref = str((req.body || {}).payment_ref, 'payment reference', { max: 100, optional: true });
  await db.tx(async (q) => {
    const { rows: [p] } = await q.query('select paid_at from pay_records where trip_id = $1 for update', [id]);
    if (!p) throw notFound();
    if (p.paid_at) throw new Bad('Already marked as paid.', 409);
    // Safety net: never pay a trip whose driver has not pressed Finish
    const { rows: [tr] } = await q.query(`select 1 as ok from trip_events where trip_id = $1 and type = 'return' limit 1`, [id]);
    if (!tr) throw new Bad(L.NOT_FINISHED_MSG, 409);
    await q.query('update pay_records set paid_by = $2, paid_at = now(), payment_ref = $3 where trip_id = $1', [id, req.user.id, ref]);
    await q.query(`update trips set status = 'paid' where id = $1`, [id]);
    await audit(q, req, 'payout.paid', 'trip', id, { payment_ref: ref });
  });
  res.json({ ok: true });
}));

// CSV that opens in Excel. Blocks formula injection (cells starting with =, +, -, @)
const csvCell = (v) => {
  let s = v == null ? '' : String(v instanceof Date ? v.toISOString() : v);
  if (/^[=+\-@\t\r]/.test(s)) s = "'" + s;
  return '"' + s.replace(/"/g, '""') + '"';
};
r.get('/payout/export.csv', requireAny('payout.view', 'payout.edit'), wrap(async (req, res) => {
  const rows = await payoutRows(req);
  const head = ['Trip No', 'Driver', 'Vehicle', 'Destination', 'Planned Departure', 'Recorded (min)', 'Paid (min)', 'Overtime (min)', 'Stat Holiday (min)',
    'Minimum Pay Top-up (min)', 'Hourly Rate', 'Vacation Pay', 'Amount', 'Est. Deductions', 'Est. Net', 'Note', 'Approved By', 'Approved At', 'Paid At', 'Payment Ref', 'Team With', 'Vehicle Type'];
  const lines = [head.map(csvCell).join(',')].concat(rows.map((x) => [
    x.trip_no, x.driver_name, x.vehicle, x.destination, x.planned_departure, x.recorded_minutes, x.recognized_minutes, x.ot_minutes,
    x.kind === 'trip' ? (x.stat_minutes || 0) + (x.double_minutes || 0) : null, x.callin_minutes,
    x.hourly_rate, x.vacation_pay, x.amount, x.deductions, x.net, x.adjustment_reason, x.approved_by_name, x.approved_at, x.paid_at, x.payment_ref, x.team_with, x.vehicle_type,
  ].map(csvCell).join(',')));
  await audit(null, req, 'payout.export', 'payout', null, { rows: rows.length });
  res.setHeader('Content-Type', 'text/csv; charset=utf-8');
  res.setHeader('Content-Disposition', 'attachment; filename="payout.csv"');
  res.send('﻿' + lines.join('\r\n'));
}));

// ---------- settings ----------
r.get('/settings', requireAny('settings.view', 'settings.edit'), wrap(async (req, res) => res.json(await getSettings())));
r.put('/settings', requireAny('settings.edit'), wrap(async (req, res) => {
  const b = req.body || {};
  // Company hourly rate and meal break are set with the other pay rules (PUT /pay/rules)
  const next = {
    rounding_unit_min: int(b.rounding_unit_min, 'rounding unit', { min: 1, max: 60 }),
    rounding_mode: oneOf(b.rounding_mode, 'rounding mode', ['none', 'nearest', 'down', 'up']),
    long_trip_warn_hours: num(b.long_trip_warn_hours, 'long trip warning', { min: 1, max: 48 }),
    mismatch_warn_min: int(b.mismatch_warn_min, 'mismatch warning', { min: 1, max: 600 }),
    accept_early_min: int(b.accept_early_min, 'accept window', { min: 0, max: 240 }),
  };
  await db.tx(async (q) => {
    const before = await getSettings(q);
    for (const [k, v] of Object.entries(next)) {
      await q.query(`insert into settings(key, value) values ($1,$2) on conflict (key) do update set value = excluded.value`, [k, JSON.stringify(v)]);
    }
    await audit(q, req, 'settings.update', 'settings', null, { before, after: next });
  });
  res.json(await getSettings());
}));

// ---------- users (admin) ----------
const ROLE_KEYS = Object.keys(L.ROLES);
function roleList(v) {
  if (!Array.isArray(v) || !v.length || v.some((x) => !ROLE_KEYS.includes(x))) throw new Bad('Select at least one role.');
  return [...new Set(v)];
}
function password(v) {
  const s = str(v, 'password', { min: 10, max: 200 });
  return s;
}
r.get('/users', requireAny('users.manage'), wrap(async (req, res) => {
  const { rows } = await db.query(
    `select u.id, u.username, u.name, u.phone, u.active, u.locked_until, u.created_at,
            coalesce(array_agg(r.role order by r.role) filter (where r.role is not null), '{}') as roles
       from users u left join user_roles r on r.user_id = u.id group by u.id order by u.active desc, u.name`);
  res.json(rows);
}));
r.post('/users', requireAny('users.manage'), wrap(async (req, res) => {
  const b = req.body || {};
  const username = str(b.username, 'username', { min: 3, max: 40 }).toLowerCase();
  if (!/^[a-z0-9._-]+$/.test(username)) throw new Bad('Username may only contain lowercase letters, digits, . _ -');
  const name = str(b.name, 'name', { max: 80 });
  const phone = str(b.phone, 'phone', { max: 30, optional: true });
  const roles = roleList(b.roles);
  const hash = await hashPassword(password(b.password));
  const out = await db.tx(async (q) => {
    const { rows: ex } = await q.query('select 1 from users where username = $1', [username]);
    if (ex.length) throw new Bad('That username is already taken.', 409);
    const { rows: [u] } = await q.query('insert into users(username, name, phone, password_hash, must_change_pw) values ($1,$2,$3,$4,true) returning id', [username, name, phone, hash]);
    for (const role of roles) await q.query('insert into user_roles(user_id, role) values ($1,$2)', [u.id, role]);
    await audit(q, req, 'user.create', 'user', u.id, { username, name, roles });
    return u;
  });
  res.status(201).json(out);
}));
r.post('/users/:id', requireAny('users.manage'), wrap(async (req, res) => {
  const id = int(req.params.id, 'id', { min: 1 });
  const b = req.body || {};
  const roles = b.roles !== undefined ? roleList(b.roles) : null;
  const active = b.active !== undefined ? b.active === true : null;
  const name = b.name !== undefined ? str(b.name, 'name', { max: 80 }) : null;
  const hash = b.password ? await hashPassword(password(b.password)) : null;
  if (id === req.user.id && (active === false || (roles && !roles.includes('admin')))) {
    throw new Bad('You cannot remove your own admin role or deactivate yourself.');
  }
  await db.tx(async (q) => {
    const { rows } = await q.query('select 1 from users where id = $1 for update', [id]);
    if (!rows.length) throw notFound();
    if (roles) {
      await q.query('delete from user_roles where user_id = $1', [id]);
      for (const role of roles) await q.query('insert into user_roles(user_id, role) values ($1,$2)', [id, role]);
    }
    if (active !== null) await q.query('update users set active = $2 where id = $1', [id, active]);
    if (name !== null) await q.query('update users set name = $2 where id = $1', [id, name]);
    if (hash) await q.query('update users set password_hash = $2, failed_attempts = 0, locked_until = null, must_change_pw = true where id = $1', [id, hash]);
    // Any role/status/password change signs that person out everywhere (a name change does not)
    if (roles || active !== null || hash) await q.query('delete from sessions where user_id = $1', [id]);
    await audit(q, req, 'user.update', 'user', id, { roles, active, name, password_reset: !!hash });
  });
  res.json({ ok: true });
}));

// ---------- demo reset (admin, local demo only) ----------
// Deletes all data and loads the sample data again, so the next person sees a clean demo.
// Three locks: admin role, local demo database only (never the NAS), and the request must say RESET.
let resetting = false;
r.post('/admin/demo-reset', requireAny('users.manage'), wrap(async (req, res) => {
  if (!req.user.roles.includes('admin')) throw new Bad('Only an admin can reset the demo.', 403);
  if (!db.demoResetAllowed()) throw new Bad('Reset is only available in the local demo, never on real data.', 403);
  if ((req.body || {}).confirm !== 'RESET') throw new Bad('Please confirm the reset.');
  if (resetting) throw new Bad('A reset is already running. Please wait a moment.', 409);
  resetting = true;
  try {
    await db.wipeForDemo();
    await require('./seed').seed();
    require('./auth').clearLoginLimits();
    const { rows: [a] } = await db.query(`select id from users where username = 'admin'`);
    await audit(null, req, 'demo.reset', 'system', null, { by: req.user.username }, a && a.id);
  } finally { resetting = false; }
  // Every session was deleted with the data, including this one
  res.clearCookie(COOKIE, cookieOpts());
  res.json({ ok: true });
}));

// ---------- received fish search (Logistics) ----------
// One row per fish line. Search by lot number, species and the date it was received.
r.get('/receipts', requireAny('receipt.view', 'receipt.edit', 'history.all'), wrap(async (req, res) => {
  const lot = (str(req.query.lot, 'lot', { max: 60, optional: true }) || '').toLowerCase();
  const fish = str(req.query.fish, 'fish', { max: 80, optional: true }) || '';
  const from = when(req.query.from, 'start date', { optional: true });
  const to = when(req.query.to, 'end date', { optional: true });
  const params = []; const cond = [`e.type = 'receipt'`];
  if (from) { params.push(from); cond.push(`e.occurred_at >= $${params.length}`); }
  if (to) { params.push(to); cond.push(`e.occurred_at < $${params.length}`); }
  const trips = await loadTrips(`t.id in (select e.trip_id from trip_events e where ${cond.join(' and ')})`, params);
  const rows = [];
  // A team trip's receipt is saved on both drivers' trips; list its fish once
  collapseTeams(trips).filter((t) => t.receipt && (!from || t.times.receipt >= from) && (!to || t.times.receipt < to)).forEach((t) => (t.receipt.items || []).forEach((x) => {
    if (lot && !String(x.lot || '').toLowerCase().includes(lot)) return;
    if (fish && (fish === 'Other' ? L.MAIN_SPECIES.includes(x.species) : x.species !== fish)) return;
    rows.push({ trip_id: t.id, trip_no: t.trip_no, driver_name: t.driver_name + (t.team ? ' + ' + t.team.mates.map((m) => m.name).join(' + ') : ''), team: !!t.team, vehicle: t.vehicle, vehicle_type: t.vehicle_type, received_at: t.times.receipt,
      species: x.species, lot: x.lot, tonnes: x.tonnes == null ? null : Number(x.tonnes), lb: L.lbOf(x), unit: x.unit || null, count: x.count == null ? null : Number(x.count), result: t.receipt.result, note: t.receipt.note || null });
  }));
  rows.sort((a, b) => (a.received_at < b.received_at ? 1 : -1));
  res.json(rows);
}));

// ---------- audit log ----------
r.get('/audit', requireAny('audit.view'), wrap(async (req, res) => {
  const { rows } = await db.query(
    `select a.id, a.at, a.action, a.entity, a.entity_id, a.detail, a.ip, u.name as user_name
       from audit_log a left join users u on u.id = a.user_id order by a.id desc limit 300`);
  res.json(rows);
}));

module.exports = { router: r, Bad, approveTrip };
