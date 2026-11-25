'use strict';
// Run with the server up: BASE=http://127.0.0.1:3100 node test/smoke.js
// Checks permissions (role and own-data), CSRF, two-step corrections, pay approval/lock, and payouts.
const BASE = process.env.BASE || 'http://127.0.0.1:3100';
const PW = process.env.DEMO_PASSWORD || 'demo1234!!';
let pass = 0, fail = 0;
const check = (name, cond, extra) => { if (cond) { pass++; console.log('  ok  ', name); } else { fail++; console.log('  FAIL', name, extra !== undefined ? JSON.stringify(extra) : ''); } };

async function session(username, password = PW) {
  const r = await fetch(BASE + '/api/login', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ username, password }) });
  const cookie = (r.headers.get('set-cookie') || '').split(';')[0];
  const call = async (method, path, body, opts = {}) => {
    const headers = { 'Content-Type': 'application/json', Cookie: cookie };
    if (method !== 'GET' && !opts.noCsrf) headers['X-CSRF-Token'] = s.csrf;
    const res = await fetch(BASE + '/api' + path, { method, headers, body: body ? JSON.stringify(body) : undefined });
    const text = await res.text();
    let data; try { data = JSON.parse(text); } catch { data = text; }
    return { status: res.status, data };
  };
  const s = { call, csrf: '', cookie };
  const me = await call('GET', '/me');
  s.csrf = me.data.csrf; s.me = me.data;
  return s;
}

// ---------- BC pay rules (pure logic) ----------
function logicChecks() {
  const L = require('../shared/logic');
  const at = (day, h) => new Date(`${day}T${String(h).padStart(2, '0')}:00:00-08:00`).toISOString();
  const trip = (id, day, h0, h1, opts = {}) => {
    const pay = L.computePay(at(day, h0), at(day, h1), { hourly_rate: 20, meal_deduction_min: 30 }, opts);
    return { id, planned_hours: opts.planned || null, times: { depart: at(day, h0) }, pay: Object.assign({ approved: false }, pay) };
  };
  const set = { hourly_rate: 20, meal_deduction_min: 30 };
  const short = trip(1, '2026-11-03', 8, 9);
  check('trip of 5 h or less: no meal deduction', short.pay.recognized === 60 && short.pay.meal === 0, short.pay);
  const paidBreak = trip(2, '2026-11-04', 8, 16, { mealPaid: true });
  check('break paid when on call: no deduction', paidBreak.pay.recognized === 480 && paidBreak.pay.meal_paid, paidBreak.pay);
  L.applyDriverPay([short], {}, 20, set);
  check('minimum 2 h daily pay tops up a 1 h day', short.pay.callin === 60 && short.pay.amount === Number((40 * 1.04).toFixed(2)), short.pay);
  const sched = trip(3, '2026-11-05', 8, 9, { planned: 9 });
  L.applyDriverPay([sched], {}, 20, set);
  check('scheduled over 8 h: minimum 4 h', sched.pay.callin === 180, sched.pay);
  const off = trip(4, '2026-11-06', 8, 9); L.applyDriverPay([off], { callin: false }, 20, set);
  check('minimum pay option off', !off.pay.callin, off.pay);
  // Remembrance Day 2026-11-11: worked 14 h -> 1.5x for 12 h, 2x after
  const hol = trip(5, '2026-11-11', 6, 20, { mealPaid: true });
  const before = [];
  for (let i = 1; i <= 20; i++) { const d = L.addDays('2026-11-11', -i); before.push(trip(100 + i, d, 8, 16)); }
  L.applyDriverPay(before.concat([hol]), { vacation_pct: 0 }, 20, set);
  check('worked stat holiday: 1.5x, 2x after 12 h, no overtime', hol.pay.stat === 720 && hol.pay.dbl === 120 && hol.pay.amount === 20 * 12 * 1.5 + 20 * 2 * 2 && !hol.pay.ot, hol.pay);
  check('eligible driver: no eligibility warning', !hol.pay.checks.some((c) => /eligib/.test(c.text)), hol.pay.checks);
  const lone = trip(6, '2026-11-11', 8, 12); L.applyDriverPay([lone], {}, 20, set);
  check('few days worked before the holiday -> eligibility warning', lone.pay.checks.some((c) => c.tone === 'warn' && /eligib/.test(c.text)), lone.pay.checks);
  const due = L.holidayPayDue(before, { vacation_pct: 4 }, set, '2026-11-20', 45);
  const rd = due.find((x) => x.date === '2026-11-11');
  check('holiday not worked: average day\'s pay + vacation', rd && rd.days_worked === 20 && rd.avg === 150 && rd.amount === 156 && rd.eligible, due);
  const low = trip(7, '2026-11-12', 8, 12); L.applyDriverPay([low], {}, 15, set);
  check('rate below minimum wage flagged', low.pay.checks.some((c) => c.tone === 'bad' && /minimum wage/.test(c.text)), low.pay.checks);
  const custom = Object.assign({}, set, { pay_rules: { min_wage: 10, callin_h: 3 } });
  const c2 = trip(8, '2026-11-13', 8, 9); L.applyDriverPay([c2], {}, 15, custom);
  check('pay rules are editable (3 h minimum, lower wage floor)', c2.pay.callin === 120 && !c2.pay.checks.some((c) => c.tone === 'bad'), c2.pay);
  check('BC holiday list 2027', L.bcHolidays(2027).map((x) => x.date).join() === '2027-01-01,2027-02-15,2027-03-26,2027-05-24,2027-07-01,2027-08-02,2027-09-30,2027-10-11,2027-11-11,2027-12-25');
  // one trip at a time (v0.8.1)
  const T = (h, m, hours, status = 'dispatched', id = 1) => ({ id, status, planned_hours: hours, planned_departure: new Date(`2026-12-01T${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}:00-08:00`).toISOString() });
  const at1040 = T(10, 40).planned_departure;
  check('overlap: 10:30 (no estimate = 8 h) clashes with 10:40', L.tripConflicts([T(10, 30, null)], at1040, null).length === 1);
  check('overlap: 09:00 for 1 h does not clash with 10:40', L.tripConflicts([T(9, 0, 1)], at1040, 2).length === 0);
  check('overlap: 10:30 with no estimate runs to 18:30, so 18:31 is free', L.tripConflicts([T(10, 30, null)], T(18, 31).planned_departure, 1).length === 0
    && L.tripConflicts([T(10, 30, null)], T(18, 29).planned_departure, 1).length === 1);
  check('overlap: new trip with no estimate counts 8 h (10:40 to 18:40 hits a 17:00 trip)', L.tripConflicts([T(17, 0, 1)], at1040, null).length === 1);
  check('overlap: a running trip always clashes, finished/cancelled never do', L.tripConflicts([T(1, 0, 1, 'in_progress')], at1040, 1).length === 1
    && L.tripConflicts([T(10, 30, 8, 'returned'), T(10, 30, 8, 'cancelled')], at1040, 1).length === 0);
  check('current trip: running one wins, else earliest planned (then lowest id)', L.currentTrip([T(8, 0, 1, 'dispatched', 1), T(9, 0, 1, 'in_progress', 2)]).id === 2
    && L.currentTrip([T(9, 0, 1, 'dispatched', 3), T(8, 0, 1, 'dispatched', 4), T(8, 0, 1, 'dispatched', 2)]).id === 2 && L.currentTrip([]) === null);
  const dd = L.deductionsFor(100, { pay_rules: { deductions: [{ name: 'CPP', pct: 5.95 }, { name: 'EI', pct: 1.64 }] } });
  check('deduction estimate', dd.total === 7.59 && dd.net === 92.41, dd);
}

(async () => {
  logicChecks();
  if (process.env.LOGIC_ONLY) { console.log(`\n${pass} passed, ${fail} failed`); process.exit(fail ? 1 : 0); }
  const bad = await fetch(BASE + '/api/login', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ username: 'driver1', password: 'wrong' }) });
  check('wrong password -> 401', bad.status === 401);
  check('API without sign-in -> 401', (await fetch(BASE + '/api/trips?scope=board')).status === 401);

  const [admin, d1, d2, sch, log, rec, pay, acc] = await Promise.all(
    ['admin', 'driver1', 'driver2', 'scheduler', 'logistics', 'logistics', 'payer', 'accounting'].map((u) => session(u)));

  check('admin sees every page', admin.me.pages.length === 15, admin.me.pages.length);
  // Demo data shows every stage of the flow: assigned -> on trip -> finished -> received -> pay approved -> paid
  const seeded = (await admin.call('GET', '/trips?scope=history')).data.filter((t) => /^T-DEMO-/.test(t.trip_no));
  const stages = seeded.reduce((m, t) => (m[t.status] = (m[t.status] || 0) + 1, m), {});
  check('demo data covers every stage', ['dispatched', 'in_progress', 'returning', 'returned', 'received', 'approved', 'paid'].every((k) => stages[k] > 0) && stages.paid >= 2, stages);
  const seededPay = (await acc.call('GET', '/payout')).data.rows.filter((x) => /^T-DEMO-/.test(x.trip_no));
  check('demo payments for accounting, more than one driver', seededPay.filter((x) => x.paid_at).length >= 2 && new Set(seededPay.filter((x) => x.paid_at).map((x) => x.driver_name)).size >= 2
    && seededPay.every((x) => Number(x.amount) > 0), seededPay);
  check('reset button shown to admin only', admin.me.demo_reset === true && pay.me.demo_reset === false && d1.me.demo_reset === false);
  check('payroll menu: Drivers pay setting yes, Payouts no', pay.me.pages.some((p) => p.id === 'drivers') && !pay.me.pages.some((p) => p.id === 'payout'), pay.me.pages.map((p) => p.id));
  check('payroll cannot open Payouts -> 403', (await pay.call('GET', '/payout')).status === 403);
  check('office roles start on Today', sch.me.pages[0].id === 'today' && pay.me.pages[0].id === 'today' && !d1.me.pages.some((p) => p.id === 'today'));
  check('setup is closed once accounts exist', (await (await fetch(BASE + '/api/setup')).json()).needed === false
    && (await fetch(BASE + '/api/setup', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ username: 'evil', name: 'x', password: 'xxxxxxxxxxxx' }) })).status === 409);
  const rem = await fetch(BASE + '/api/login', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ username: 'driver3', password: PW, remember: true }) });
  check('keep me signed in -> long-lived cookie', /Max-Age=2592000/i.test(rem.headers.get('set-cookie') || ''), rem.headers.get('set-cookie'));
  check('accounting menu: no Pay page (Payouts, Pay History only), Pay API -> 403', !acc.me.pages.some((p) => p.id === 'pay') && (await acc.call('GET', '/pay')).status === 403, acc.me.pages.map((p) => p.id));
  check('accounting has no trip board', !acc.me.pages.find((p) => p.id === 'board'));

  // role permissions
  check('driver calls trip board API -> 403', (await d1.call('GET', '/trips?scope=board')).status === 403);
  check('driver creates a trip -> 403', (await d1.call('POST', '/trips', {})).status === 403);
  check('logistics approves pay -> 403', (await log.call('POST', '/pay/1/approve', {})).status === 403);
  check('accounting changes settings -> 403', (await acc.call('PUT', '/settings', {})).status === 403);
  check('logistics lists users -> 403', (await log.call('GET', '/users')).status === 403);

  // own data only
  const d2trips = (await d2.call('GET', '/trips?scope=my')).data;
  const other = d2trips[0].id;
  check('driver1 opens driver2 trip -> 404', (await d1.call('GET', `/trips/${other}`)).status === 404);
  const h1 = (await d1.call('GET', '/trips?scope=history&driver_id=' + d2trips[0].driver_id)).data;
  check('driver history ignores another driver_id', h1.every((t) => t.driver_id === d1.me.user.id) && h1.length > 0);
  const p1 = (await d1.call('GET', '/pay?driver_id=' + d2trips[0].driver_id)).data;
  check('driver pay shows own amounts only', p1.trips.every((t) => t.driver_id === d1.me.user.id));
  check('driver1 presses button on driver2 trip -> 404', (await d1.call('POST', `/trips/${other}/events`, { type: 'pickup_done' })).status === 404);

  // CSRF
  check('change without CSRF token -> 403', (await sch.call('POST', '/trips', {}, { noCsrf: true })).status === 403);

  // input validation / no internals in errors
  const v = await sch.call('POST', '/trips', { driver_id: d1.me.user.id, vehicle: '', pickup_location: 'x', destination: 'y', planned_departure: 'nope' });
  check('validation -> 400 + readable message', v.status === 400 && /Please enter/.test(v.data.error), v.data);
  const sqli = await sch.call('GET', "/trips?scope=history&driver_id=1;drop table users");
  check('SQL injection attempt -> 400', sqli.status === 400);

  // dispatch -> trip flow
  const later = await sch.call('POST', '/trips', { driver_id: d1.me.user.id, vehicle: 'TRK-98', pickup_location: 'Tomorrow Pickup', destination: 'Company Yard', planned_departure: new Date(Date.now() + 20 * 3600000).toISOString(), planned_hours: 5 });
  const acceptEarly = await d1.call('POST', `/trips/${later.data.id}/events`, { type: 'depart' });
  check('Accept the day before -> 409', acceptEarly.status === 409 && /Accept opens/.test(acceptEarly.data.error), acceptEarly.data);
  const createBody = { driver_id: d1.me.user.id, vehicle: 'TRK-99', pickup_location: 'Test Pickup', destination: 'Company Yard', planned_departure: new Date().toISOString(), planned_hours: 5 };
  const warn = await sch.call('POST', '/trips', createBody);
  check('driver 1 already has a trip at that time -> 409 warning (not created)', warn.status === 409 && warn.data.code === 'driver_busy' && warn.data.error === 'This driver is currently on a trip. Create anyway?'
    && warn.data.conflicts.some((c) => c.driver_id === d1.me.user.id && c.status === 'dispatched'), warn.data);
  const created = await sch.call('POST', '/trips', { ...createBody, confirm: true });
  check('scheduler creates trip -> 201', created.status === 201, created.data);
  const tid = created.data.id;
  const nd = (await d1.call('GET', '/notifications')).data;
  check('driver is notified of the new trip', nd.unread > 0 && nd.items.some((n) => n.title === 'New trip assigned' && n.link === '#my'), nd);
  check('mark notifications read', (await d1.call('POST', '/notifications/read', {})).status === 200 && (await d1.call('GET', '/notifications')).data.unread === 0);
  check('others cannot see that notification', !(await d2.call('GET', '/notifications')).data.items.some((n) => n.title === 'New trip assigned' && n.body.includes('Test Pickup')));
  const today0 = (await sch.call('GET', '/today')).data;
  check('Today for scheduler lists only action items', Array.isArray(today0) && today0.every((x) => x.count > 0 && x.page), today0);
  check('driver Today -> no items', (await d1.call('GET', '/today')).data.length === 0);
  check('out-of-order button (return first) -> 409', (await d1.call('POST', `/trips/${tid}/events`, { type: 'return' })).status === 409);
  check('new trip shows on My Trips', (await d1.call('GET', '/trips?scope=my')).data.some((t) => t.id === tid && t.accept_opens_at));
  for (const type of ['depart', 'pickup_done', 'return']) {
    const r = await d1.call('POST', `/trips/${tid}/events`, { type });
    check(`driver ${type} button`, r.status === 200, r.data);
  }
  check('finished trip leaves My Trips', !(await d1.call('GET', '/trips?scope=my')).data.some((t) => t.id === tid));
  check('finished trip stays in Trip History', (await d1.call('GET', '/trips?scope=history')).data.some((t) => t.id === tid));
  // A truck still on the road cannot be received (only after the driver taps Finish)
  const early = await sch.call('POST', '/trips', { driver_id: d2.me.user.id, vehicle: 'TRK-97', pickup_location: 'Early Pickup', destination: 'Company Yard', planned_departure: new Date().toISOString(), planned_hours: 5, confirm: true });
  await d2.call('POST', `/trips/${early.data.id}/events`, { type: 'depart' });
  check('receiving a trip still on the road -> 409', (await rec.call('POST', `/trips/${early.data.id}/receipt`, { result: 'ok', items: [{ species: 'Salmon', lot: 'L9', lb: 500 }] })).status === 409);
  check('receiving without fish lines -> 400', (await rec.call('POST', `/trips/${tid}/receipt`, { result: 'ok' })).status === 400);
  check('receiving in the future -> 400', (await rec.call('POST', `/trips/${tid}/receipt`, { result: 'ok', items: [{ species: 'Salmon', lot: 'L1', lb: 2000 }], received_at: new Date(Date.now() + 864e5).toISOString() })).status === 400);
  const recAt = new Date(Date.now() - 600000).toISOString();
  const L = require('../shared/logic');
  check('count from weight: 4,250 lb of cases -> 86 (49.5 lb avg)', L.countFromWeight(4250, 'case') === 86 && L.countFromWeight(9750, 'tote') === 10 && L.countFromWeight(400, 'tote') === 1 && L.countFromWeight(0, 'case') === null && L.countFromWeight(100, 'box') === null);
  check('bad unit -> 400', (await log.call('POST', `/trips/${tid}/receipt`, { result: 'ok', items: [{ species: 'Salmon', lot: 'L1', lb: 500, unit: 'box' }] })).status === 400);
  check('count of 0 -> 400', (await log.call('POST', `/trips/${tid}/receipt`, { result: 'ok', items: [{ species: 'Salmon', lot: 'L1', lb: 500, unit: 'case', count: 0 }] })).status === 400);
  check('logistics records fish + lot + time', (await log.call('POST', `/trips/${tid}/receipt`, { result: 'ok', items: [{ species: 'Black Cod', lot: 'LOT-1', lb: 9750, unit: 'tote' }, { species: 'Halibut', lot: 'LOT-2', lb: 2756, unit: 'case', count: 57 }], received_at: recAt })).status === 200);
  const tr = (await log.call('GET', `/trips/${tid}`)).data;
  const [i0, i1] = tr.receipt.items;
  check('receipt keeps lines, lb and entered time', tr.receipt.items.length === 2 && i0.lb === 9750 && tr.times.receipt === recAt, tr.receipt);
  const hl = (await log.call('GET', '/trips?scope=history')).data.find((t) => t.id === tid);
  check('Trip History data carries the lot numbers for the trip', hl && hl.receipt.items.map((x) => x.lot).join() === 'LOT-1,LOT-2', hl && hl.receipt);
  check('count is filled in from the weight when left blank (9,750 lb / 975 = 10 totes)', i0.unit === 'tote' && i0.count === 10, i0);
  check('a count changed by hand is kept', i1.unit === 'case' && i1.count === 57, i1);
  check('tonnes is still kept for reports', i0.tonnes === 4.423 && i1.tonnes === 1.25, tr.receipt.items);
  check('second receipt -> 409', (await rec.call('POST', `/trips/${tid}/receipt`, { result: 'ok', items: [{ species: 'x', lot: 'y', tonnes: 1 }] })).status === 409);
  // Jaskaran (demo account `logistics`) also has the Scheduler role; a Logistics-only person has no Dispatch
  check('Jaskaran: Logistics + Scheduler pages', JSON.stringify(log.me.pages.map((p) => p.id)) === '["today","dispatch","board","receipt","corrections","history","addresses"]', log.me.pages.map((p) => p.id));
  check('Jaskaran can assign trips (Scheduler role), still cannot approve pay', log.me.perms.includes('dispatch.edit') && (await log.call('POST', '/trips', {})).status === 400
    && (await log.call('POST', '/pay/1/approve', {})).status === 403);
  check('Logistics alone has no dispatch', !L.permsFor(['logistics']).has('dispatch.edit') && JSON.stringify(L.pagesFor(['logistics']).map((p) => p.id)) === '["today","receipt","history"]');
  const demoAcc = await fetch(BASE + '/demo-accounts');
  if (demoAcc.status === 200) {
    const labels = Object.fromEntries((await demoAcc.json()).users);
    check('demo sign-in labels read "Role - Name"', labels.logistics === 'Scheduler, Logistics Manager - Jaskaran' && labels.scheduler === 'Scheduler - Kaitlin' && labels.payer === 'Payroll - Simon', labels);
  }
  const found = (await log.call('GET', '/receipts?lot=lot-2')).data;
  check('search received fish by lot', found.length > 0 && found.every((x) => /LOT-2/i.test(x.lot)) && found.some((x) => x.lb === 2756 && x.count === 57 && x.unit === 'case'), found);
  check('search received fish by species', (await log.call('GET', '/receipts?fish=Halibut')).data.every((x) => x.species === 'Halibut'));
  check('driver searches received fish -> 403', (await d1.call('GET', '/receipts')).status === 403);
  check('driver menu is My Trips, History, Pay', JSON.stringify(d1.me.pages.map((p) => p.id)) === '["my","history","pay"]', d1.me.pages);
  const quick = await sch.call('POST', '/trips', { driver_id: d1.me.user.id, vehicle: 'TRK-97', pickup_location: 'Short Run', destination: 'Company Yard', planned_departure: new Date().toISOString(), confirm: true });
  const tap = new Date(Date.now() - 10000).toISOString();
  check('accept then finish without pickup', (await d1.call('POST', `/trips/${quick.data.id}/events`, { type: 'depart', at: tap })).status === 200
    && (await d1.call('POST', `/trips/${quick.data.id}/events`, { type: 'return', at: new Date(Date.now() - 3600000).toISOString() })).status === 200);
  const qt = (await d1.call('GET', `/trips/${quick.data.id}`)).data;
  check('undo delay: tap time kept (10 s ago), old time ignored', qt.times.depart === tap && Date.now() - new Date(qt.times.return).getTime() < 60000, qt.times);

  // two-step correction
  const t0 = (await d1.call('GET', `/trips/${tid}`)).data;
  const badOrder = await d1.call('POST', '/corrections', { trip_id: tid, event_type: 'return', requested_time: new Date(new Date(t0.times.depart).getTime() - 3600000).toISOString(), reason: 'out of order' });
  check('return corrected to before depart -> 409', badOrder.status === 409, badOrder.data);
  const reqTime = new Date(new Date(t0.times.depart).getTime() - 8 * 3600000).toISOString();
  const cr = await d1.call('POST', '/corrections', { trip_id: tid, event_type: 'depart', requested_time: reqTime, reason: 'test' });
  check('driver correction request -> 201', cr.status === 201, cr.data);
  check('scheduler is notified of the correction', (await sch.call('GET', '/notifications')).data.items.some((n) => n.link === '#corrections'));
  check('open correction blocks pay approval -> 409', (await pay.call('POST', `/pay/${tid}/approve`, {})).status === 409);
  check('payroll skips step 1 -> 409', (await pay.call('POST', `/corrections/${cr.data.id}/final`, { approve: true })).status === 409);
  check('driver approves own request -> 403', (await d1.call('POST', `/corrections/${cr.data.id}/first`, { approve: true })).status === 403);
  check('scheduler approves step 1', (await sch.call('POST', `/corrections/${cr.data.id}/first`, { approve: true })).status === 200);
  check('payroll is notified for final approval', (await pay.call('GET', '/notifications')).data.items.some((n) => n.title === 'Correction ready for final approval'));
  check('payroll final approval', (await pay.call('POST', `/corrections/${cr.data.id}/final`, { approve: true })).status === 200);
  check('driver hears the correction was approved', (await d1.call('GET', '/notifications')).data.items.some((n) => n.title === 'Your time correction was approved'));
  const t1 = (await d1.call('GET', `/trips/${tid}`)).data;
  check('correction applied + original kept', t1.times.depart === reqTime && t1.events.filter((e) => e.type === 'depart').length === 2, t1.times);
  check('8h trip -> 7h30m paid (meal deducted)', t1.pay.recorded >= 480 && t1.pay.recognized === t1.pay.recorded - 30, t1.pay);

  // pay approval -> lock -> payout
  const rules0 = (await pay.call('GET', '/pay/rules')).data;
  check('pay rules start at BC defaults', rules0.rules.min_wage === 18.25 && rules0.rules.stat_mult === 1.5 && rules0.rules.callin_h === 2 && rules0.holidays[0].list.length >= 10, rules0.rules);
  check('accounting changes pay rules -> 403', (await acc.call('PUT', '/pay/rules', {})).status === 403);
  check('driver reads pay rules -> 403', (await d1.call('GET', '/pay/rules')).status === 403);
  const putRules = (over) => pay.call('PUT', '/pay/rules', Object.assign({}, rules0.rules, { meal_min: 30 }, over));
  check('bad holiday date -> 400', (await putRules({ extra_holidays: [{ date: '2026-13-40', name: 'x' }] })).status === 400);
  check('payroll edits pay rules', (await putRules({ min_wage: 40, deductions: [{ name: 'CPP', pct: 5.95 }], extra_holidays: [{ date: '2026-12-26', name: 'Boxing Day' }] })).status === 200);
  const rules1 = (await pay.call('GET', '/pay/rules')).data.rules;
  check('pay rules saved', rules1.min_wage === 40 && rules1.deductions[0].pct === 5.95 && rules1.extra_holidays[0].name === 'Boxing Day', rules1);
  check('driver sets own rate -> 403', (await d1.call('POST', `/pay/profile/${d1.me.user.id}`, { hourly_rate: 99 })).status === 403);
  check('payroll sets driver pay settings', (await pay.call('POST', `/pay/profile/${d1.me.user.id}`, { hourly_rate: 32.5, ot_rule: 'short_haul', vacation_pct: 4 })).status === 200);
  const pdr = (await pay.call('GET', '/pay/drivers')).data.find((x) => x.id === d1.me.user.id);
  check('pay settings saved', pdr.hourly_rate === 32.5 && pdr.profile.ot_rule === 'short_haul' && pdr.profile.vacation_pct === 4, pdr);
  const otTrip = (await pay.call('GET', `/pay?driver_id=${d1.me.user.id}`)).data.trips.find((t) => !t.pay.approved && t.pay.recognized > 540);
  check('short haul: overtime after 9 h + 4% vacation pay', otTrip && otTrip.pay.ot >= otTrip.pay.recognized - 540 && otTrip.pay.vacation > 0
    && Math.abs(otTrip.pay.amount - (otTrip.pay.gross + otTrip.pay.vacation)) < 0.01, otTrip && otTrip.pay);
  const pr = (await pay.call('GET', `/pay?driver_id=${d1.me.user.id}`)).data;
  check('pay filter by driver + driver rate used', pr.trips.length > 0 && pr.trips.every((t) => t.driver_id === d1.me.user.id && (t.pay.approved || t.pay.rate === 32.5)), pr.trips.map((t) => [t.driver_id, t.pay.rate]));
  const low = await pay.call('POST', `/pay/${tid}/approve`, {});
  check('rate below minimum wage blocks approval -> 409', low.status === 409 && /minimum wage/.test(low.data.error), low.data);
  check('restore BC minimum wage', (await putRules({ min_wage: 18.25, deductions: [{ name: 'CPP', pct: 5.95 }] })).status === 200);
  check('holiday approve for a non-holiday -> 409', (await pay.call('POST', '/pay/holiday/approve', { driver_id: d1.me.user.id, date: '2026-03-03' })).status === 409);
  check('driver approves holiday pay -> 403', (await d1.call('POST', '/pay/holiday/approve', { driver_id: d1.me.user.id, date: '2026-11-11' })).status === 403);
  const pl = (await pay.call('GET', `/pay?driver_id=${d1.me.user.id}`)).data;
  check('pay lines carry automatic checks', Array.isArray(pl.holidays) && pl.trips.every((t) => Array.isArray(t.pay.checks)), pl.trips.map((t) => t.pay.checks));
  const ap = await pay.call('POST', `/pay/${tid}/approve`, { recognized_minutes: 999 });
  check('change paid minutes without reason -> 400', ap.status === 400);
  const ap2 = await pay.call('POST', `/pay/${tid}/approve`, {});
  check('pay approved', ap2.status === 200, ap2.data);
  const po = (await acc.call('GET', '/payout')).data;
  const poRow = po.rows.find((x) => x.trip_id === tid);
  check('payouts show estimated net from deductions', po.deductions.length === 1 && poRow && Math.abs(poRow.net - (poRow.amount - poRow.deductions)) < 0.01 && poRow.deductions > 0, poRow);
  check('no corrections after approval -> 409', (await d1.call('POST', '/corrections', { trip_id: tid, event_type: 'pickup_done', requested_time: reqTime, reason: 'x' })).status === 409);
  check('accounting marks paid', (await acc.call('POST', `/payout/${tid}/paid`, { payment_ref: 'ETF-1' })).status === 200);
  check('double payout -> 409', (await acc.call('POST', `/payout/${tid}/paid`, {})).status === 409);
  const csv = await acc.call('GET', '/payout/export.csv');
  check('CSV export', csv.status === 200 && String(csv.data).includes('Trip No'));

  // pay history + Excel, address book
  const ph = await acc.call('GET', '/payhist?sort=lot');
  check('accounting sees pay history (approved trips only)', ph.status === 200 && ph.data.length > 0 && ph.data.every((x) => ['approved', 'paid'].includes(x.status)), ph.data);
  const multi = ph.data.filter((x) => ph.data.filter((y) => y.trip_id === x.trip_id).length > 1);
  check('multi-lot trip: pay on one line, the others marked same trip', multi.length === 0 || [...new Set(multi.map((x) => x.trip_id))].every((id) => {
    const ls = multi.filter((x) => x.trip_id === id); return ls.filter((x) => !x.same_trip && x.amount != null).length === 1 && ls.filter((x) => x.same_trip && x.amount == null && x.pay_lot).length === ls.length - 1; }), multi);
  check('pay history lot filter', (await pay.call('GET', '/payhist?lot=LOT-2')).data.every((x) => x.lot.includes('LOT-2')));
  check('driver cannot see pay history -> 403', (await d1.call('GET', '/payhist')).status === 403);
  const xl = await fetch(BASE + '/api/payhist/export.xlsx?sort=driver', { headers: { Cookie: acc.cookie } });
  const xb = Buffer.from(await xl.arrayBuffer());
  check('pay history Excel download', xl.status === 200 && xb.slice(0, 2).toString() === 'PK' && /spreadsheetml/.test(xl.headers.get('content-type')));
  const addrs = (await sch.call('GET', '/addresses')).data;
  check('dispatch saved its addresses automatically', addrs.some((x) => x.address === 'Test Pickup'), addrs.map((x) => x.address));
  check('driver cannot edit addresses -> 403', (await d1.call('POST', '/addresses', { address: 'X' })).status === 403);
  const ta = addrs.find((x) => x.address === 'Test Pickup');
  check('rename address', (await sch.call('POST', `/addresses/${ta.id}`, { address: 'Test Pickup DC' })).status === 200);
  check('remove address', (await sch.call('POST', `/addresses/${ta.id}`, { remove: true })).status === 200);

  // audit log
  const audit = (await acc.call('GET', '/audit')).data;
  check('audit log has approval and payout', ['pay.approve', 'payout.paid', 'correction.final.approve'].every((a) => audit.some((x) => x.action === a)));

  // deactivation -> immediate sign-out
  const nu = await admin.call('POST', '/users', { username: 'temp.driver', name: 'Temp', password: PW + 'xyz', roles: ['driver'] });
  check('admin creates account', nu.status === 201, nu.data);
  check('admin renames a member', (await admin.call('POST', `/users/${pay.me.user.id}`, { name: 'Simon K' })).status === 200
    && (await pay.call('GET', '/me')).data.user.name === 'Simon K');
  check('non-admin renames -> 403', (await pay.call('POST', `/users/${pay.me.user.id}`, { name: 'x' })).status === 403);
  check('old Receiving role is gone', (await admin.call('POST', `/users/${nu.data.id}`, { roles: ['receiver'] })).status === 400);
  const tmp = await (async () => { const r = await fetch(BASE + '/api/login', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ username: 'temp.driver', password: PW + 'xyz' }) }); return (r.headers.get('set-cookie') || '').split(';')[0]; })();
  const tmpS = await session('temp.driver', PW + 'xyz');
  check('new account must change its temporary password', tmpS.me.must_change_pw === true && (await tmpS.call('GET', '/trips?scope=my')).status === 403);
  check('wrong current password -> 400', (await tmpS.call('POST', '/me/password', { current_password: 'nope', new_password: 'brand-new-pass-1' })).status === 400);
  check('change password', (await tmpS.call('POST', '/me/password', { current_password: PW + 'xyz', new_password: 'brand-new-pass-1' })).status === 200
    && (await tmpS.call('GET', '/trips?scope=my')).status === 200);
  check('admin reset -> must change again', (await admin.call('POST', `/users/${nu.data.id}`, { password: 'reset-pass-12345' })).status === 200
    && (await session('temp.driver', 'reset-pass-12345')).me.must_change_pw === true);
  const tmp2 = await (async () => { const r = await fetch(BASE + '/api/login', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ username: 'temp.driver', password: 'reset-pass-12345' }) }); return (r.headers.get('set-cookie') || '').split(';')[0]; })();
  await admin.call('POST', `/users/${nu.data.id}`, { active: false });
  check('deactivated (reset) account session ends', (await fetch(BASE + '/api/me', { headers: { Cookie: tmp2 } })).status === 401);
  check('deactivated account session ends immediately', (await fetch(BASE + '/api/me', { headers: { Cookie: tmp } })).status === 401);
  check('push key endpoint answers', (await (await fetch(BASE + '/api/push/key')).json()).key.length > 40);
  check('PWA files served', (await fetch(BASE + '/manifest.webmanifest')).status === 200 && (await fetch(BASE + '/sw.js')).status === 200);

  // ---------- team trips, vehicle types, Finish before pay ----------
  const d4 = await session('driver4');
  const vts = (await sch.call('GET', '/vehicle-types')).data;
  check('vehicle types: 10 ton and 5 ton are there from the start', vts.some((x) => x.name === '10 ton truck') && vts.some((x) => x.name === '5 ton truck'), vts);
  check('driver cannot read or add vehicle types -> 403', (await d1.call('GET', '/vehicle-types')).status === 403 && (await d1.call('POST', '/vehicle-types', { name: 'X' })).status === 403);
  check('add a vehicle type', (await sch.call('POST', '/vehicle-types', { name: '  15 ton   truck ' })).status === 201
    && (await sch.call('GET', '/vehicle-types')).data.some((x) => x.name === '15 ton truck'));
  check('same vehicle type twice (any case) -> 409, blank -> 400', (await sch.call('POST', '/vehicle-types', { name: '15 TON TRUCK' })).status === 409 && (await sch.call('POST', '/vehicle-types', { name: '  ' })).status === 400);
  const tm = { vehicle: 'TRK-T1', pickup_location: 'Team Pickup', destination: 'Company Yard', planned_departure: new Date().toISOString(), planned_hours: 8 };
  check('unknown vehicle type -> 400', (await sch.call('POST', '/trips', { ...tm, driver_id: d1.me.user.id, vehicle_type: 'Flying carpet' })).status === 400);
  check('team with the same driver twice -> 400', (await sch.call('POST', '/trips', { ...tm, driver_id: d1.me.user.id, second_driver_id: d1.me.user.id })).status === 400);
  check('team with a non-driver -> 400', (await sch.call('POST', '/trips', { ...tm, driver_id: d1.me.user.id, second_driver_id: sch.me.user.id })).status === 400);
  const team = await sch.call('POST', '/trips', { ...tm, driver_id: d1.me.user.id, second_driver_id: d4.me.user.id, vehicle_type: '15 ton truck', confirm: true });
  check('scheduler assigns a team trip (2 drivers)', team.status === 201, team.data);
  const my1 = (await d1.call('GET', '/trips?scope=my')).data.find((t) => t.team && t.team.mates.some((m) => m.name === d4.me.user.name));
  const my4 = (await d4.call('GET', '/trips?scope=my')).data.find((t) => t.team && t.team.mates.some((m) => m.name === d1.me.user.name));
  check('both drivers see the trip in My Trips with the teammate and vehicle type', my1 && my4 && my1.id !== my4.id && my1.vehicle_type === '15 ton truck' && my4.trip_no === my1.trip_no + '-B', { my1: my1 && my1.trip_no, my4: my4 && my4.trip_no });
  check('both drivers are notified', (await d4.call('GET', '/notifications')).data.items.some((n) => n.title === 'New team trip assigned'));
  check('a driver outside the team cannot open it', (await d2.call('GET', `/trips/${my1.id}`)).status === 404);
  // Each driver has their own times
  check('driver 1 accepts; driver 2 of the team is still assigned', (await d1.call('POST', `/trips/${my1.id}/events`, { type: 'depart', at: new Date(Date.now() - 100000).toISOString() })).status === 200
    && (await d4.call('GET', '/trips?scope=my')).data.find((t) => t.id === my4.id).status === 'dispatched');
  check('cannot cancel a team trip once one driver accepted -> 409', (await sch.call('POST', `/trips/${my1.id}/cancel`, { reason: 'x' })).status === 409);
  check('driver cannot press the teammate\'s trip', (await d1.call('POST', `/trips/${my4.id}/events`, { type: 'depart' })).status === 404);
  // Finish before pay
  const unfin = await pay.call('POST', `/pay/${my1.id}/approve`, {});
  check('pay on a trip still on the road -> 409 "Driver has not finished"', unfin.status === 409 && /Driver has not finished/.test(unfin.data.error), unfin.data);
  const unfin2 = await pay.call('POST', `/pay/${later.data.id}/approve`, {});
  check('pay on a trip not accepted yet -> 409 "Driver has not finished"', unfin2.status === 409 && /Driver has not finished/.test(unfin2.data.error), unfin2.data);
  const waiting = (await pay.call('GET', '/pay')).data.waiting || [];
  check('Payroll sees unfinished trips as waiting (not approvable)', waiting.some((t) => t.id === my1.id) && waiting.some((t) => t.id === early.data.id), waiting.map((t) => t.trip_no));
  check('unfinished trips never appear as payable lines', !(await pay.call('GET', '/pay')).data.trips.some((t) => [my1.id, early.data.id].includes(t.id)));
  check('Accounting cannot mark an unapproved trip paid', (await acc.call('POST', `/payout/${my1.id}/paid`, {})).status === 404);
  await d1.call('POST', `/trips/${my1.id}/events`, { type: 'return' });
  const half = await rec.call('POST', `/trips/${my1.id}/receipt`, { result: 'ok', items: [{ species: 'Black Cod', lot: 'LOT-TEAM', lb: 9750, unit: 'tote' }] });
  check('team trip cannot be received until BOTH drivers finished -> 409', half.status === 409 && /Both drivers/.test(half.data.error), half.data);
  const half2 = await pay.call('POST', `/pay/${my4.id}/approve`, {});
  check('team: the second driver has not finished -> his pay is blocked, even though the first finished', half2.status === 409 && /Driver has not finished/.test(half2.data.error), half2.data);
  await d4.call('POST', `/trips/${my4.id}/events`, { type: 'depart', at: new Date(Date.now() - 100000).toISOString() });
  await d4.call('POST', `/trips/${my4.id}/events`, { type: 'return' });
  check('team trip is received once', (await rec.call('POST', `/trips/${my1.id}/receipt`, { result: 'ok', items: [{ species: 'Black Cod', lot: 'LOT-TEAM', lb: 9750, unit: 'tote' }] })).status === 200);
  const both = await admin.call('GET', '/trips?scope=receipt');
  check('Receiving counts the team trip once (both names)', both.data.filter((t) => t.team && t.team.lead_id === my1.team.lead_id).length === 1
    && both.data.find((t) => t.team && t.team.lead_id === my1.team.lead_id).status === 'received');
  check('Trip History (office) lists the team trip once', (await admin.call('GET', '/trips?scope=history')).data.filter((t) => t.team && t.team.lead_id === my1.team.lead_id).length === 1);
  check('each driver\'s own Trip History still has their own row', (await d1.call('GET', '/trips?scope=history')).data.some((t) => t.id === my1.id) && (await d4.call('GET', '/trips?scope=history')).data.some((t) => t.id === my4.id));
  const lotRows = (await log.call('GET', '/receipts?lot=LOT-TEAM')).data;
  check('received fish search lists the team trip once', lotRows.length === 1 && lotRows[0].team === true && lotRows[0].driver_name.includes(' + '), lotRows);
  const a1 = await pay.call('POST', `/pay/${my1.id}/approve`, {});
  const a4 = await pay.call('POST', `/pay/${my4.id}/approve`, {});
  check('Payroll approves each team driver separately (own time, own amount)', a1.status === 200 && a4.status === 200 && Number(a1.data.amount) > 0 && Number(a4.data.amount) > 0, [a1.data, a4.data]);
  check('no double pay: approving the same driver twice -> 409', (await pay.call('POST', `/pay/${my1.id}/approve`, {})).status === 409);
  const phTeam = (await pay.call('GET', '/payhist?lot=LOT-TEAM')).data;
  check('Pay History: both drivers listed, weight counted once, "Team with" shown', phTeam.length === 2 && phTeam.filter((r) => r.tonnes != null).length === 1 && phTeam.every((r) => r.team_with) && new Set(phTeam.map((r) => r.team_key)).size === 1, phTeam);
  const poTeam = (await acc.call('GET', '/payout')).data.rows.filter((x) => x.trip_no.startsWith(my1.trip_no));
  check('Accounting pays each driver once (2 pay lines, team shown)', poTeam.length === 2 && poTeam.every((x) => x.team_with), poTeam);
  check('a driver sees only their own pay for the team trip', (await d4.call('GET', '/pay')).data.trips.filter((t) => t.id === my1.id).length === 0 && (await d4.call('GET', '/pay')).data.trips.some((t) => t.id === my4.id));
  // Team cancel: neither accepted -> both cancelled
  const t2 = await sch.call('POST', '/trips', { ...tm, planned_departure: new Date(Date.now() + 40 * 3600000).toISOString(), driver_id: d1.me.user.id, second_driver_id: d4.me.user.id, confirm: true });
  const t2rows = () => sch.call('GET', '/trips?scope=dispatch').then((r) => r.data.filter((t) => t.team && t.team.lead_id === t2.data.id));
  check('cancelling a team trip cancels both drivers\' trips', (await t2rows()).length === 2 && (await sch.call('POST', `/trips/${t2.data.id}/cancel`, { reason: 'test' })).status === 200
    && (await t2rows()).every((t) => t.status === 'cancelled'));

  // ---------- one trip at a time (v0.8.1) ----------
  // Two different schedulers: Kaitlin books 10:30 (no estimate = 8 h), then Jaskaran books 10:40 for the same driver
  const day10 = new Date(Date.now() + 10 * 864e5);
  const atLocal = (h, m) => { const d = new Date(day10); d.setHours(h, m, 0, 0); return d.toISOString(); };
  const base = { vehicle: 'TRK-OV', pickup_location: 'Overlap Pickup', destination: 'Company Yard' };
  const b1030 = await sch.call('POST', '/trips', { ...base, driver_id: d1.me.user.id, planned_departure: atLocal(10, 30) });
  check('10:30 trip booked by scheduler A', b1030.status === 201, b1030.data);
  const b1040 = await log.call('POST', '/trips', { ...base, driver_id: d1.me.user.id, planned_departure: atLocal(10, 40), planned_hours: 2 });
  check('10:40 booked by scheduler B for the same driver -> 409 warning naming the 10:30 trip', b1040.status === 409 && b1040.data.code === 'driver_busy'
    && b1040.data.conflicts.length === 1 && b1040.data.conflicts[0].trip_id === b1030.data.id && b1040.data.conflicts[0].planned_hours === null, b1040.data);
  check('the warned trip was not created', !(await d1.call('GET', '/trips?scope=my')).data.some((t) => t.planned_departure === atLocal(10, 40)));
  check('a trip after the 8 h default window (18:31) needs no warning', (await log.call('POST', '/trips', { ...base, driver_id: d1.me.user.id, planned_departure: atLocal(18, 31), planned_hours: 1 })).status === 201);
  check('an earlier trip that ends before 10:30 needs no warning', (await log.call('POST', '/trips', { ...base, driver_id: d1.me.user.id, planned_departure: atLocal(8, 0), planned_hours: 2 })).status === 201);
  const teamClash = await log.call('POST', '/trips', { ...base, driver_id: d2.me.user.id, second_driver_id: d1.me.user.id, planned_departure: atLocal(11, 0), planned_hours: 1 });
  check('team trip: the SECOND driver overlap is caught too', teamClash.status === 409 && teamClash.data.conflicts.some((c) => c.driver_id === d1.me.user.id && c.trip_id === b1030.data.id)
    && teamClash.data.conflicts.some((c) => c.driver_id === d2.me.user.id && c.status === 'in_progress'), teamClash.data);
  const d3 = await session('driver3');
  const onRoad = await sch.call('POST', '/trips', { ...base, driver_id: d3.me.user.id, planned_departure: new Date(Date.now() + 30 * 864e5).toISOString(), planned_hours: 1 });
  check('driver on the road now -> warning even for a trip next month', onRoad.status === 409 && onRoad.data.conflicts.some((c) => c.status === 'returning'), onRoad.data);
  const anyway = await log.call('POST', '/trips', { ...base, driver_id: d1.me.user.id, planned_departure: atLocal(10, 40), planned_hours: 2, confirm: true });
  check('Create anyway (confirm) -> 201', anyway.status === 201, anyway.data);
  check('Create anyway is recorded in the audit log', (await admin.call('GET', '/audit')).data.some((x) => x.action === 'trip.create' && String(x.entity_id) === String(anyway.data.id)
    && x.detail && (x.detail.created_despite || []).includes(b1030.data.trip_no)));
  check('confirm must be a real true (string "true" still warns)', (await log.call('POST', '/trips', { ...base, driver_id: d1.me.user.id, planned_departure: atLocal(10, 50), confirm: 'true' })).status === 409);
  // Only the current trip can be accepted: Driver 4 gets two trips today (the second one Create anyway)
  const nowIso = (minAgo) => new Date(Date.now() - minAgo * 60000).toISOString();
  const first = await sch.call('POST', '/trips', { ...base, driver_id: d4.me.user.id, planned_departure: nowIso(2), planned_hours: 1, confirm: true });
  const second = await sch.call('POST', '/trips', { ...base, driver_id: d4.me.user.id, planned_departure: nowIso(1), planned_hours: 1, confirm: true });
  const my4b = (await d4.call('GET', '/trips?scope=my')).data;
  check('My Trips: current trip = earliest not accepted, the other is upcoming', L.currentTrip(my4b).id === first.data.id && my4b.some((t) => t.id === second.data.id), my4b.map((t) => [t.id, t.trip_no, t.status]));
  const jump = await d4.call('POST', `/trips/${second.data.id}/events`, { type: 'depart' });
  check('Accept on a later trip while the current one is unfinished -> 409', jump.status === 409 && /Finish your current trip first/.test(jump.data.error), jump.data);
  check('Accept the current trip', (await d4.call('POST', `/trips/${first.data.id}/events`, { type: 'depart' })).status === 200);
  check('later trip still cannot be accepted, picked up or finished while one is running', (await d4.call('POST', `/trips/${second.data.id}/events`, { type: 'depart' })).status === 409
    && (await d4.call('POST', `/trips/${second.data.id}/events`, { type: 'pickup_done' })).status === 409 && (await d4.call('POST', `/trips/${second.data.id}/events`, { type: 'return' })).status === 409);
  check('Finish the current trip', (await d4.call('POST', `/trips/${first.data.id}/events`, { type: 'return' })).status === 200);
  check('the next trip becomes current and can be accepted', L.currentTrip((await d4.call('GET', '/trips?scope=my')).data).id === second.data.id
    && (await d4.call('POST', `/trips/${second.data.id}/events`, { type: 'depart' })).status === 200);
  await d4.call('POST', `/trips/${second.data.id}/events`, { type: 'return' });

  // ---------- early start (v0.8.2) ----------
  // Driver 4's current trip is the sample trip tomorrow morning, so Accept is not open yet
  check('accept window minutes sent to the app (one setting, 15 by default)', d4.me.accept_early_min === 15 && sch.me.accept_early_min === 15, d4.me.accept_early_min);
  const cur4 = L.currentTrip((await d4.call('GET', '/trips?scope=my')).data);
  const tooEarly = await d4.call('POST', `/trips/${cur4.id}/events`, { type: 'depart' });
  check('Accept before the window -> 409 that points to Early start', tooEarly.status === 409 && /Accept opens/.test(tooEarly.data.error) && /Early start/.test(tooEarly.data.error), tooEarly.data);
  const later4 = await sch.call('POST', '/trips', { ...base, driver_id: d4.me.user.id, planned_departure: new Date(Date.now() + 3 * 864e5).toISOString(), planned_hours: 1, confirm: true });
  check('early start on a later (not current) trip -> 409', (await d4.call('POST', `/trips/${later4.data.id}/early-start`, {})).status === 409);
  check('another driver cannot ask for it -> 404', (await d1.call('POST', `/trips/${cur4.id}/early-start`, {})).status === 404);
  check('office staff without a driver role cannot ask -> 403', (await sch.call('POST', `/trips/${cur4.id}/early-start`, {})).status === 403);
  const es1 = await d4.call('POST', `/trips/${cur4.id}/early-start`, { reason: 'Ferry leaves at 5' });
  check('driver asks for an early start -> 201', es1.status === 201 && es1.data.status === 'pending', es1.data);
  check('only one open request per trip -> 409', (await d4.call('POST', `/trips/${cur4.id}/early-start`, {})).status === 409);
  check('still cannot accept while it is pending', (await d4.call('POST', `/trips/${cur4.id}/events`, { type: 'depart' })).status === 409);
  check('scheduler is notified', (await sch.call('GET', '/notifications')).data.items.some((n) => n.title === 'Early start request' && n.link === '#dispatch'));
  check('Today lists the request for the scheduler', (await sch.call('GET', '/today')).data.some((x) => x.key === 'early' && x.list.some((y) => y.trip_id === cur4.id)));
  check('driver sees the request as waiting', (await d4.call('GET', `/trips/${cur4.id}`)).data.early_start.status === 'pending');
  const list1 = await sch.call('GET', '/early-starts');
  check('managers see it in the requests list with the reason', list1.status === 200 && list1.data.some((x) => x.id === es1.data.id && x.status === 'pending' && x.reason === 'Ferry leaves at 5' && x.driver_name === 'Driver 4'), list1.data);
  check('drivers and payroll cannot list or decide requests -> 403', (await d4.call('GET', '/early-starts')).status === 403 && (await d4.call('POST', `/early-starts/${es1.data.id}`, { approve: true })).status === 403
    && (await pay.call('POST', `/early-starts/${es1.data.id}`, { approve: true })).status === 403);
  check('Jaskaran (Scheduler) declines with a reason', (await log.call('POST', `/early-starts/${es1.data.id}`, { approve: false, reason: 'No dock crew before 6' })).status === 200);
  check('already handled -> 409', (await sch.call('POST', `/early-starts/${es1.data.id}`, { approve: true })).status === 409);
  const dec = (await d4.call('GET', `/trips/${cur4.id}`)).data.early_start;
  check('driver sees the decline and the reason, and is notified', dec.status === 'declined' && dec.decline_reason === 'No dock crew before 6'
    && (await d4.call('GET', '/notifications')).data.items.some((n) => n.title === 'Early start declined'), dec);
  check('declined: Accept still closed', (await d4.call('POST', `/trips/${cur4.id}/events`, { type: 'depart' })).status === 409);
  const es2 = await d4.call('POST', `/trips/${cur4.id}/early-start`, {});
  check('driver can ask again after a decline', es2.status === 201, es2.data);
  check('scheduler approves', (await sch.call('POST', `/early-starts/${es2.data.id}`, { approve: true })).status === 200);
  check('driver is told it was approved', (await d4.call('GET', '/notifications')).data.items.some((n) => n.title === 'Early start approved'));
  check('approved: the driver can accept now', (await d4.call('POST', `/trips/${cur4.id}/events`, { type: 'depart' })).status === 200);
  check('no early start on a trip already accepted -> 409', (await d4.call('POST', `/trips/${cur4.id}/early-start`, {})).status === 409);
  const aud = (await admin.call('GET', '/audit')).data;
  check('early start request, decline and approval are in the audit log', ['early_start.request', 'early_start.decline', 'early_start.approve'].every((x) => aud.some((y) => y.action === x)));
  await d4.call('POST', `/trips/${cur4.id}/events`, { type: 'return' });

  // Demo reset (last: it wipes everything above)
  check('non-admin demo reset -> 403', (await pay.call('POST', '/admin/demo-reset', { confirm: 'RESET' })).status === 403);
  check('demo reset without confirmation -> 400', (await admin.call('POST', '/admin/demo-reset', {})).status === 400);
  check('demo reset without CSRF token -> 403', (await admin.call('POST', '/admin/demo-reset', { confirm: 'RESET' }, { noCsrf: true })).status === 403);
  const rs = await admin.call('POST', '/admin/demo-reset', { confirm: 'RESET' });
  check('admin resets demo data', rs.status === 200, rs.data);
  check('everyone is signed out after reset', (await admin.call('GET', '/me')).status === 401 && (await acc.call('GET', '/me')).status === 401);
  const admin2 = await session('admin');
  const after = (await admin2.call('GET', '/trips?scope=history')).data;
  check('reset brings back only the sample trips', after.length === seeded.length && after.every((t) => /^T-DEMO-/.test(t.trip_no)), after.map((t) => t.trip_no));
  check('renamed account back to demo name', (await session('payer')).me.user.name === 'Simon');
  check('temporary account removed by reset', (await fetch(BASE + '/api/login', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ username: 'temp.driver', password: 'reset-pass-12345' }) })).status === 401);
  check('reset is in the audit log', (await admin2.call('GET', '/audit')).data.some((x) => x.action === 'demo.reset'));

  console.log(`\n${pass} passed, ${fail} failed`);
  process.exit(fail ? 1 : 0);
})().catch((e) => { console.error(e); process.exit(1); });
