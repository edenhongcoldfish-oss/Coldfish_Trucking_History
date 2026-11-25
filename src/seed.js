'use strict';
// Demo data: one account per role + sample trips. In production set SEED_DEMO=false and create only an admin.
const db = require('./db');
const { hashPassword } = require('./auth');
const L = require('../shared/logic');

const DEMO_PASSWORD = process.env.DEMO_PASSWORD || 'demo1234!!';
const USERS = [
  ['admin', 'Admin User', ['admin']],
  ['driver1', 'Driver 1', ['driver']],
  ['driver2', 'Driver 2', ['driver']],
  ['driver3', 'Driver 3', ['driver']],
  ['driver4', 'Driver 4', ['driver']],
  ['scheduler', 'Kaitlin', ['scheduler']],
  ['logistics', 'Jaskaran', ['logistics', 'scheduler']], // Jaskaran also assigns trips
  ['payer', 'Simon', ['payer']],
  ['accounting', 'Rene', ['accounting']],
];

const iso = (ms) => new Date(ms).toISOString();

async function seed() {
  const hash = await hashPassword(DEMO_PASSWORD);
  const toApprove = [];
  let payerId; let accountingId;
  await db.tx(async (q) => {
    const ids = {};
    for (const [u, name, roles] of USERS) {
      const { rows: [x] } = await q.query('insert into users(username, name, password_hash) values ($1,$2,$3) returning id', [u, name, hash]);
      ids[u] = x.id;
      for (const r of roles) await q.query('insert into user_roles(user_id, role) values ($1,$2)', [x.id, r]);
    }
    // Hourly rate is not decided yet; this is a placeholder for the demo
    const settings = { hourly_rate: 30, rounding_unit_min: 15, rounding_mode: 'none', meal_deduction_min: 30,
      long_trip_warn_hours: 13, mismatch_warn_min: 30, accept_early_min: 15, currency: 'CAD' };
    for (const [k, v] of Object.entries(settings)) await q.query('insert into settings(key, value) values ($1,$2)', [k, JSON.stringify(v)]);

    const H = 3600000;
    const now = Date.now();
    // Past trips start at a normal hour: k days ago at hh:00 (server local time)
    const midnight = new Date(); midnight.setHours(0, 0, 0, 0);
    const day = (k, hh) => midnight.getTime() - k * 24 * H + hh * H;
    const fish = (species, lot, lb, unit) => ({ species, lot, lb, tonnes: Math.round(lb / L.LB_PER_TONNE * 1000) / 1000, unit, count: L.countFromWeight(lb, unit) });
    let n = 0;
    const trip = async (driver, vehicle, pickup, dest, plannedMs, hours, cargo, events, status) => {
      n += 1;
      const { rows: [t] } = await q.query(
        `insert into trips(trip_no, driver_id, vehicle, pickup_location, destination, planned_departure, planned_hours, cargo_ref, status, created_by, created_at)
         values ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11) returning id`,
        [`T-DEMO-${String(n).padStart(3, '0')}`, ids[driver], vehicle, pickup, dest, iso(plannedMs), hours, cargo, status, ids.scheduler, iso(Math.min(plannedMs, now) - 12 * H)]);
      for (const [type, ms, by, data] of events) {
        await q.query(`insert into trip_events(trip_id, type, occurred_at, recorded_by, method, data, created_at) values ($1,$2,$3,$4,$5,$6,$3)`,
          [t.id, type, iso(ms), ids[by || driver], type === 'receipt' ? 'receipt' : 'button', JSON.stringify(data || {})]);
      }
      return t.id;
    };
    // A finished trip: Accept -> Pickup done -> Finish (+ optional receiving by Logistics)
    const done = (start, pickupH, finishH, receipt) => [['depart', start], ['pickup_done', start + pickupH * H], ['return', start + finishH * H]]
      .concat(receipt ? [['receipt', start + finishH * H + 0.3 * H, 'logistics', receipt]] : []);

    // The whole flow, one stage per group (oldest first):
    // 1) Paid: Dispatch -> Accept/Finish -> Receiving -> Pay approved -> Marked paid (Accounting sees them per driver)
    const p1 = await trip('driver1', 'TRK-07', 'Steveston Harbour, Richmond', 'Company Yard', day(6, 6), 9, 'PO-88101',
      done(day(6, 6) + 0.1 * H, 3, 9.2, { result: 'ok', items: [fish('Halibut', 'LOT-24-1150', 5940, 'case')] }), 'received');
    const p2 = await trip('driver2', 'TRK-03', 'Ucluelet Harbour', 'Company Yard', day(5, 5), 10, 'PO-88112',
      done(day(5, 5), 4.5, 10.4, { result: 'ok', items: [fish('Black Cod', 'LOT-24-1163', 8775, 'tote')] }), 'received');
    const p3 = await trip('driver1', 'TRK-07', 'Campbell River Dock', 'Company Yard', day(4, 6), 9, 'PO-88123',
      done(day(4, 6) + 0.2 * H, 4, 9.1, { result: 'ok', items: [fish('Black Cod', 'LOT-24-1187', 9260, 'tote'), fish('Halibut', 'LOT-24-1190', 6063, 'case')] }), 'received');
    // 2) Pay approved by Payroll, waiting for Accounting to mark it paid
    const a1 = await trip('driver3', 'TRK-11', 'Port Hardy Dock', 'Company Yard', day(3, 5), 11, 'PO-88134',
      done(day(3, 5), 5.5, 11.3, { result: 'ok', items: [fish('Salmon', 'LOT-24-1196', 12675, 'tote')] }), 'received');
    // 3) Received by Logistics, waiting for Payroll to approve pay
    await trip('driver4', 'TRK-05', 'Prince Rupert Port', 'Company Yard', day(3, 6), 12, 'PO-88139',
      done(day(3, 6) + 0.1 * H, 5, 12.5, { result: 'ok', items: [fish('Halibut', 'LOT-24-1199', 4455, 'case')] }), 'received');
    await trip('driver2', 'TRK-03', 'Nanaimo Ferry Terminal', 'Company Yard', day(2, 7), 8, 'PO-88140',
      done(day(2, 7), 3, 8.6, { result: 'issue', note: '1 tote damaged', items: [fish('Salmon', 'LOT-24-1202', 13448, 'tote')] }), 'received');
    // 4) Finished, waiting for Logistics to receive (one also has a time correction waiting)
    const forgot = await trip('driver1', 'TRK-07', 'Steveston Harbour, Richmond', 'Company Yard', day(1, 6), 8, 'PO-88177',
      done(day(1, 6) + 0.1 * H, 3, 11.5), 'returned');
    await trip('driver4', 'TRK-05', 'YVR Cargo, Richmond', 'Company Yard', day(1, 8), 6, 'PO-88181', done(day(1, 8), 2, 6.2), 'returned');
    // 5) On the road now
    const a = now - 14.5 * H;
    await trip('driver3', 'TRK-11', 'Ucluelet Harbour', 'Company Yard', a, 12, 'PO-88201', [['depart', a], ['pickup_done', a + 7 * H]], 'returning');
    const b = now - 3 * H;
    await trip('driver2', 'TRK-03', 'Campbell River Dock', 'Company Yard', b, 6, 'PO-88210', [['depart', b]], 'in_progress');
    // 6) Assigned by Dispatch, not accepted yet (the first one can be accepted right away)
    await trip('driver1', 'TRK-07', 'Steveston Harbour, Richmond', 'Company Yard', now + 0.1 * H, 7, 'PO-88222', [], 'dispatched');
    await trip('driver4', 'TRK-05', 'Nanaimo Ferry Terminal', 'Company Yard', day(-1, 6), 9, 'PO-88230', [], 'dispatched');
    await trip('driver1', 'TRK-07', 'Port Hardy Dock', 'Company Yard', day(-2, 5), 11, 'PO-88241', [], 'dispatched');

    // Vehicle types: the big units are 10 ton, the others 5 ton
    await q.query(`update trips set vehicle_type = '10 ton truck' where vehicle in ('TRK-07', 'TRK-11')`);
    await q.query(`update trips set vehicle_type = '5 ton truck' where vehicle in ('TRK-03', 'TRK-05')`);
    // Team trip: Driver 3 + Driver 4 on one truck. Each has their own trip record (own Accept/Finish, own pay); receiving is shared.
    const teamStart = day(2, 5);
    const lead = await trip('driver3', 'TRK-11', 'Port Alberni Dock', 'Company Yard', teamStart, 10, 'PO-88250',
      done(teamStart, 4, 10.2, { result: 'ok', items: [fish('Black Cod', 'LOT-24-1210', 9750, 'tote')] }), 'received');
    const mate = await trip('driver4', 'TRK-11', 'Port Alberni Dock', 'Company Yard', teamStart, 10, 'PO-88250',
      done(teamStart + 0.1 * H, 4, 10.3, { result: 'ok', items: [fish('Black Cod', 'LOT-24-1210', 9750, 'tote')] }), 'received');
    await q.query(`update trips set team_id = $1, vehicle_type = '10 ton truck' where id in ($1, $2)`, [lead, mate]);
    await q.query(`update trips set trip_no = (select trip_no from trips where id = $1) || '-B' where id = $2`, [lead, mate]);

    // Sample correction: driver pressed Finish late
    await q.query(`insert into correction_requests(trip_id, event_type, requested_time, reason, requested_by)
                   values ($1,'return',$2,$3,$4)`,
      [forgot, iso(day(1, 6) + 10 * H), 'Helped unload after arriving and pressed Finish 1.5 hours late.', ids.driver1]);
    await q.query(`insert into trip_memos(trip_id, author_id, note) select id, $1, $2 from trips where trip_no = 'T-DEMO-009'`,
      [ids.logistics, 'Waited 3 h for loading at Ucluelet (dock delay confirmed)']);
    await q.query(require('./db').BACKFILL_ADDRESSES);
    await q.query(`insert into audit_log(user_id, action, entity, detail) values ($1,'seed','system','{"note":"demo data created"}')`, [ids.admin]);
    toApprove.push([p1, day(5, 10), 'EFT-24101', day(4, 15)], [p2, day(4, 10), 'EFT-24102', day(3, 15)],
      [p3, day(3, 10), 'EFT-24103', day(2, 15)], [a1, day(2, 10)]);
    payerId = ids.payer; accountingId = ids.accounting;
  });
  // Pay approval goes through the same code as the Pay page, so amounts match what Payroll would see
  const { approveTrip } = require('./routes');
  for (const [tripId, approvedAt, ref, paidAt] of toApprove) {
    await db.tx(async (q) => {
      await approveTrip(q, { user: { id: payerId }, ip: null }, tripId, {}, iso(approvedAt));
      if (!ref) return;
      await q.query('update pay_records set paid_by = $2, paid_at = $3, payment_ref = $4 where trip_id = $1', [tripId, accountingId, iso(paidAt), ref]);
      await q.query(`update trips set status = 'paid' where id = $1`, [tripId]);
      await q.query(`insert into audit_log(user_id, action, entity, entity_id, detail) values ($1,'payout.paid','trip',$2,$3)`,
        [accountingId, String(tripId), JSON.stringify({ payment_ref: ref })]);
    });
  }
  console.log(`Demo accounts created (password: ${DEMO_PASSWORD})`);
}

module.exports = { seed, DEMO_PASSWORD, USERS };
