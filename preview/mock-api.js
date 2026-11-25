/* Preview only: imitates the same API rules (permissions, own-data only, two-step corrections, approval lock) inside the browser with no server.
   The real service enforces these rules on the server (Node in src/ + PostgreSQL). */
(function () {
  'use strict';
  const L = window.Logic;
  const KEY = 'trucking-demo-v9-en';
  const H = 3600000;
  const iso = (ms) => new Date(ms).toISOString();
  class E extends Error { constructor(m) { super(m); } }

  function saveAddr(s, text) {
    const a = String(text || '').trim().replace(/\s+/g, ' ');
    if (!a) return;
    s.addresses = s.addresses || [];
    const x = s.addresses.find((y) => y.address.toLowerCase() === a.toLowerCase());
    if (x) { x.use_count += 1; x.last_used = new Date().toISOString(); }
    else s.addresses.push({ id: ++s.seq, address: a, use_count: 1, last_used: new Date().toISOString() });
  }
  function fresh() {
    const now = Date.now();
    const users = [
      [1, 'admin', 'Admin User', ['admin']], [2, 'driver1', 'Driver 1', ['driver']], [3, 'driver2', 'Driver 2', ['driver']],
      [4, 'driver3', 'Driver 3', ['driver']], [10, 'driver4', 'Driver 4', ['driver']], [5, 'scheduler', 'Kaitlin', ['scheduler']], [6, 'logistics', 'Jaskaran', ['logistics', 'scheduler']],
      [8, 'payer', 'Simon', ['payer']], [9, 'accounting', 'Rene', ['accounting']],
    ].map(([id, username, name, roles]) => ({ id, username, name, roles, active: true, created_at: iso(now) }));
    const s = { users, vehicleTypes: [{ id: 1, name: '10 ton truck' }, { id: 2, name: '5 ton truck' }], trips: [], events: [], memos: [], corrections: [], pay: [], audit: [], seq: 100,
      settings: Object.assign({}, L.DEFAULT_SETTINGS, { hourly_rate: 30 }) };
    const trip = (driver, vehicle, pickup, dest, planned, hours, cargo, evs, status) => {
      const t = { id: ++s.seq, trip_no: `T-DEMO-${String(s.trips.length + 1).padStart(3, '0')}`, driver_id: driver, vehicle, pickup_location: pickup,
        destination: dest, planned_departure: iso(planned), planned_hours: hours, cargo_ref: cargo, status, created_at: iso(planned - 12 * H) };
      s.trips.push(t);
      evs.forEach(([type, ms, by, data]) => s.events.push({ id: ++s.seq, trip_id: t.id, type, occurred_at: iso(ms), recorded_by: by || driver,
        method: type === 'receipt' ? 'receipt' : 'button', data: data || {}, created_at: iso(ms) }));
      return t;
    };
    const midnight = new Date(); midnight.setHours(0, 0, 0, 0);
    const day = (k, hh) => midnight.getTime() - k * 24 * H + hh * H;
    const fish = (species, lot, lb, unit) => ({ species, lot, lb, tonnes: Math.round(lb / L.LB_PER_TONNE * 1000) / 1000, unit, count: L.countFromWeight(lb, unit) });
    const done = (st, pickupH, finishH, receipt) => [['depart', st], ['pickup_done', st + pickupH * H], ['return', st + finishH * H]]
      .concat(receipt ? [['receipt', st + finishH * H + 0.3 * H, 6, receipt]] : []);
    // Same sample trips as src/seed.js: one group per stage of the flow, oldest first
    const p1 = trip(2, 'TRK-07', 'Steveston Harbour, Richmond', 'Company Yard', day(6, 6), 9, 'PO-88101', done(day(6, 6) + 0.1 * H, 3, 9.2, { result: 'ok', items: [fish('Halibut', 'LOT-24-1150', 5940, 'case')] }), 'received');
    const p2 = trip(3, 'TRK-03', 'Ucluelet Harbour', 'Company Yard', day(5, 5), 10, 'PO-88112', done(day(5, 5), 4.5, 10.4, { result: 'ok', items: [fish('Black Cod', 'LOT-24-1163', 8775, 'tote')] }), 'received');
    const p3 = trip(2, 'TRK-07', 'Campbell River Dock', 'Company Yard', day(4, 6), 9, 'PO-88123', done(day(4, 6) + 0.2 * H, 4, 9.1, { result: 'ok', items: [fish('Black Cod', 'LOT-24-1187', 9260, 'tote'), fish('Halibut', 'LOT-24-1190', 6063, 'case')] }), 'received');
    const a1 = trip(4, 'TRK-11', 'Port Hardy Dock', 'Company Yard', day(3, 5), 11, 'PO-88134', done(day(3, 5), 5.5, 11.3, { result: 'ok', items: [fish('Salmon', 'LOT-24-1196', 12675, 'tote')] }), 'received');
    trip(10, 'TRK-05', 'Prince Rupert Port', 'Company Yard', day(3, 6), 12, 'PO-88139', done(day(3, 6) + 0.1 * H, 5, 12.5, { result: 'ok', items: [fish('Halibut', 'LOT-24-1199', 4455, 'case')] }), 'received');
    trip(3, 'TRK-03', 'Nanaimo Ferry Terminal', 'Company Yard', day(2, 7), 8, 'PO-88140', done(day(2, 7), 3, 8.6, { result: 'issue', note: '1 tote damaged', items: [fish('Salmon', 'LOT-24-1202', 13448, 'tote')] }), 'received');
    const d2 = day(1, 6);
    const forgot = trip(2, 'TRK-07', 'Steveston Harbour, Richmond', 'Company Yard', d2, 8, 'PO-88177', done(d2 + 0.1 * H, 3, 11.5), 'returned');
    trip(10, 'TRK-05', 'YVR Cargo, Richmond', 'Company Yard', day(1, 8), 6, 'PO-88181', done(day(1, 8), 2, 6.2), 'returned');
    const a = now - 14.5 * H;
    const w = trip(4, 'TRK-11', 'Ucluelet Harbour', 'Company Yard', a, 12, 'PO-88201', [['depart', a], ['pickup_done', a + 7 * H]], 'returning');
    const bb = now - 3 * H;
    trip(3, 'TRK-03', 'Campbell River Dock', 'Company Yard', bb, 6, 'PO-88210', [['depart', bb]], 'in_progress');
    trip(2, 'TRK-07', 'Steveston Harbour, Richmond', 'Company Yard', now + 0.1 * H, 7, 'PO-88222', [], 'dispatched');
    trip(10, 'TRK-05', 'Nanaimo Ferry Terminal', 'Company Yard', day(-1, 6), 9, 'PO-88230', [], 'dispatched');
    trip(2, 'TRK-07', 'Port Hardy Dock', 'Company Yard', day(-2, 5), 11, 'PO-88241', [], 'dispatched');
    s.trips.forEach((t) => { t.vehicle_type = ['TRK-07', 'TRK-11'].includes(t.vehicle) ? '10 ton truck' : '5 ton truck'; });
    // Team trip: Driver 3 + Driver 4, one trip record each (own times and pay), one shared receiving record
    const ts = day(2, 5); const tf = fish('Black Cod', 'LOT-24-1210', 9750, 'tote');
    const tl = trip(4, 'TRK-11', 'Port Alberni Dock', 'Company Yard', ts, 10, 'PO-88250', done(ts, 4, 10.2, { result: 'ok', items: [tf] }), 'received');
    const tm = trip(10, 'TRK-11', 'Port Alberni Dock', 'Company Yard', ts, 10, 'PO-88250', done(ts + 0.1 * H, 4, 10.3, { result: 'ok', items: [tf] }), 'received');
    tl.team_id = tl.id; tm.team_id = tl.id; tm.trip_no = tl.trip_no + '-B'; tl.vehicle_type = tm.vehicle_type = '10 ton truck';
    s.corrections.push({ id: ++s.seq, trip_id: forgot.id, event_type: 'return', requested_time: iso(d2 + 10 * H), reason: 'Helped unload after arriving and pressed Finish 1.5 hours late.',
      requested_by: 2, status: 'pending', created_at: iso(d2 + 12 * H) });
    s.notes = [{ id: ++s.seq, user_id: 5, kind: 'correction', title: 'Time correction to check', body: `Driver 1 · trip ${forgot.trip_no}: Finished time`, link: '#corrections', key: 'corr1:seed', created_at: iso(d2 + 12 * H), read_at: null },
      { id: ++s.seq, user_id: 2, kind: 'trip', title: 'New trip assigned', body: 'Steveston Harbour, Richmond → Company Yard', link: '#my', key: 'trip:seed', created_at: iso(now - 0.5 * H), read_at: null }];
    s.memos.push({ id: ++s.seq, trip_id: w.id, author_id: 6, note: 'Waited 3 h for loading at Ucluelet (dock delay confirmed)', created_at: iso(a + 5 * H) });
    s.addresses = [];
    s.trips.forEach((t) => [t.pickup_location, t.destination].forEach((a) => saveAddr(s, a)));
    s.audit.push({ id: ++s.seq, at: iso(now), user_id: 1, action: 'seed', entity: 'system', entity_id: null, detail: { note: 'demo data created' } });
    // Pay approval and payment use the same code as the Pay page, so amounts match what Payroll would see
    const prev = S; S = s;
    try {
      [[p1, day(5, 10), 'EFT-24101', day(4, 15)], [p2, day(4, 10), 'EFT-24102', day(3, 15)], [p3, day(3, 10), 'EFT-24103', day(2, 15)], [a1, day(2, 10)]].forEach(([t, at, ref, paidAt]) => {
        const p = approveCore(t, {}, 8, iso(at));
        s.pay.push(p); t.status = 'approved';
        if (ref) { Object.assign(p, { paid_at: iso(paidAt), paid_by: 9, payment_ref: ref }); t.status = 'paid'; }
      });
    } finally { S = prev; }
    return s;
  }
  let S;
  const save = () => { try { localStorage.setItem(KEY, JSON.stringify(S)); } catch (e) { /* storage unavailable */ } };
  let me = null;

  const user = (id) => S.users.find((u) => u.id === id) || {};
  // Notifications (same rules as src/notify.js)
  function notify(ids, n) {
    S.notes = S.notes || [];
    [...new Set(ids)].forEach((uid) => {
      if (n.key && S.notes.some((x) => x.user_id === uid && x.key === n.key)) return;
      S.notes.push(Object.assign({ id: ++S.seq, user_id: uid, created_at: new Date().toISOString(), read_at: null, body: '', link: '' }, n));
    });
  }
  const usersWith = (ps, exclude) => S.users.filter((u) => u.active && !(exclude || []).includes(u.id) && ps.some((p) => L.permsFor(u.roles).has(p))).map((u) => u.id);
  function watchLongTrips() {
    const lim = Number(S.settings.long_trip_warn_hours || 13);
    S.trips.filter((t) => ['in_progress', 'returning'].includes(t.status)).forEach((t) => {
      const d = dto(t);
      if (d.elapsed_min > lim * 60) notify(usersWith(['users.manage', 'board.view']), { kind: 'long_trip', title: `Over ${lim} h on the road: ${d.driver_name}`, body: `Trip ${t.trip_no} was accepted ${Math.floor(d.elapsed_min / 60)} h ago and is not finished.`, link: '#board', key: `long:${t.id}` });
    });
  }
  const perms = () => L.permsFor(me.roles);
  const need = (...p) => { const ps = perms(); if (!p.some((x) => ps.has(x))) throw new E('You do not have permission.'); };
  const audit = (action, entity, id, detail) => S.audit.push({ id: ++S.seq, at: new Date().toISOString(), user_id: me.id, action, entity, entity_id: id == null ? null : String(id), detail: detail || {} });
  const nonEmpty = (v, n) => { if (!v || !String(v).trim()) throw new E(`Please enter ${n}.`); return String(v).trim().slice(0, 1000); };

  function payCfg(driverId) {
    const u = user(driverId); const pf = L.profileOf(u.pay_profile);
    return Object.assign({}, S.settings, u.hourly_rate == null ? {} : { hourly_rate: u.hourly_rate }, pf.meal_min == null ? {} : { meal_deduction_min: pf.meal_min });
  }
  // Overtime needs the driver's other trips in the same weeks, so use all of that driver's finished trips as context.
  function withDriverPay(list, override) {
    const ids = [...new Set(list.map((t) => t.driver_id))];
    ids.forEach((id) => {
      const ctx = S.trips.filter((t) => t.driver_id === id && ['returned', 'received', 'approved', 'paid'].includes(t.status)).map(dto);
      ctx.forEach((t) => { if (override && override[t.id] != null && !t.pay.approved) t.pay.recognized = override[t.id]; });
      const u = user(id);
      L.applyDriverPay(ctx, u.pay_profile, u.hourly_rate != null ? u.hourly_rate : S.settings.hourly_rate, S.settings);
      list.forEach((t) => { const c = ctx.find((x) => x.id === t.id); if (c) t.pay = c.pay; });
    });
    return list;
  }
  function dto(t) {
    const events = S.events.filter((e) => e.trip_id === t.id).sort((a, b) => a.id - b.id);
    const eff = L.effectiveTimes(events);
    const at = (k) => (eff[k] ? eff[k].occurred_at : null);
    const pr = S.pay.find((p) => p.trip_id === t.id);
    const { flags, elapsed } = L.flags(t, eff, S.settings);
    const mates = t.team_id ? S.trips.filter((x) => x.team_id === t.team_id && x.id !== t.id).map((x) => ({ trip_id: x.id, driver_id: x.driver_id, name: user(x.driver_id).name, status: x.status })) : [];
    return Object.assign({}, t, {
      vehicle_type: t.vehicle_type || null, team: t.team_id ? { lead_id: t.team_id, mates } : null,
      driver_name: user(t.driver_id).name, accept_opens_at: L.acceptOpensAt(t.planned_departure, S.settings),
      times: { depart: at('depart'), pickup_done: at('pickup_done'), return: at('return'), receipt: at('receipt') },
      receipt: eff.receipt ? eff.receipt.data : null,
      events: events.map((e) => Object.assign({}, e, { recorded_by_name: user(e.recorded_by).name })),
      memos: S.memos.filter((m) => m.trip_id === t.id).map((m) => Object.assign({}, m, { author_name: user(m.author_id).name })),
      pending_corrections: S.corrections.filter((c) => c.trip_id === t.id && ['pending', 'first_approved'].includes(c.status)).length,
      flags, elapsed_min: elapsed,
      driver_rate: user(t.driver_id).hourly_rate == null ? null : user(t.driver_id).hourly_rate,
      pay_profile: L.profileOf(user(t.driver_id).pay_profile),
      pay: pr ? Object.assign({ approved: true }, pr) : Object.assign({ approved: false }, L.computePay(at('depart'), at('return'), payCfg(t.driver_id), { mealPaid: L.profileOf(user(t.driver_id).pay_profile).meal_paid })),
    });
  }
  // Pay approval rules (same as POST /pay/:id/approve on the server). Returns the pay record; the caller stores it.
  function approveCore(t, b, by, approvedAt) {
    const d = dto(t);
    if (L.ACTIVE_STATUSES.includes(t.status) || !d.times.return) throw new E(L.NOT_FINISHED_MSG);
    if (!['returned', 'received'].includes(t.status)) throw new E('This trip is not waiting for pay approval.');
    if (d.pending_corrections) throw new E('This trip has an open correction request. Resolve it before approving.');
    const mealPaid = b.meal_paid == null ? d.pay_profile.meal_paid : bool(b.meal_paid, false);
    const calc = L.computePay(d.times.depart, d.times.return, payCfg(t.driver_id), { mealPaid }); let reason = null; const ov = { [t.id]: calc.recognized };
    if (b.recognized_minutes !== '' && b.recognized_minutes != null && Number(b.recognized_minutes) !== calc.recognized) { reason = nonEmpty(b.reason, 'an adjustment reason'); ov[t.id] = Number(b.recognized_minutes); }
    const x = withDriverPay([d], ov)[0].pay;
    if (x.rate == null || x.amount == null) throw new E('No hourly rate for this driver yet. Set it on the Drivers pay setting page.');
    if (x.rate < L.rulesOf(S.settings).min_wage) throw new E(`${d.driver_name}'s hourly rate is below the minimum wage in Pay rules. Fix it on the Drivers pay setting page first.`);
    const p = { trip_id: t.id, recorded: calc.recorded, recognized: x.recognized, ot: x.ot || 0, stat: x.stat || 0, dbl: x.dbl || 0, callin: x.callin || 0, meal_paid: !!calc.meal_paid,
      regular: x.recognized - (x.ot || 0) - (x.stat || 0) - (x.dbl || 0), rate: x.rate, vacation: x.vacation || 0, amount: x.amount,
      adjustment_reason: reason, approved_by: by, approved_at: approvedAt, paid_at: null };
    p.recorded_minutes = p.recorded; p.recognized_minutes = p.recognized; p.ot_minutes = p.ot; p.callin_minutes = p.callin; p.vacation_pay = p.vacation; p.hourly_rate = p.rate;
    return p;
  }
  const sorted = (list) => list.sort((a, b) => new Date(b.planned_departure) - new Date(a.planned_departure));
  function recompute(t) {
    if (['approved', 'paid', 'cancelled'].includes(t.status)) return;
    const eff = L.effectiveTimes(S.events.filter((e) => e.trip_id === t.id));
    t.status = eff.return ? (eff.receipt ? 'received' : 'returned') : eff.pickup_done ? 'returning' : eff.depart ? 'in_progress' : 'dispatched';
  }
  const canSeeAll = () => ['history.all', 'board.view', 'dispatch.view', 'dispatch.edit', 'receipt.view', 'receipt.edit', 'correction.view',
    'correction.first', 'correction.final', 'pay.view', 'pay.approve'].some((x) => perms().has(x));
  function tripOr404(id, own) {
    const t = S.trips.find((x) => x.id === id);
    if (!t || (own && t.driver_id !== me.id && !me.roles.includes('admin'))) throw new E('Not found.');
    return t;
  }
  function range(q, list) {
    const f = q.get('from'), to = q.get('to'), d = q.get('driver_id');
    return list.filter((t) => (!f || t.planned_departure >= f) && (!to || t.planned_departure < to) && (!d || t.driver_id === Number(d)));
  }
  function assertOrder(tripId, type, time) {
    const eff = L.effectiveTimes(S.events.filter((e) => e.trip_id === tripId));
    const times = {}; L.DRIVER_EVENTS.forEach((k) => { times[k] = eff[k] ? eff[k].occurred_at : null; }); times[type] = time;
    if (!L.orderOk(times)) throw new E('Times are out of order. They must go Accept -> Pickup Done -> Finish.');
  }
  function payoutRows() {
    return S.pay.map((p) => { const t = S.trips.find((x) => x.id === p.trip_id);
      const mates = t.team_id ? S.trips.filter((x) => x.team_id === t.team_id && x.id !== t.id).map((x) => user(x.driver_id).name).join(', ') : '';
      return Object.assign({}, p, { trip_no: t.trip_no, team_with: mates, vehicle_type: t.vehicle_type || null, driver_name: user(t.driver_id).name, approved_by_name: user(p.approved_by).name, paid_by_name: p.paid_by ? user(p.paid_by).name : null });
    }).sort((a, b) => (a.paid_at ? 1 : 0) - (b.paid_at ? 1 : 0));
  }

  const today = () => L.localDay(new Date().toISOString());
  function holidayDue(driverId) {
    const u = user(driverId);
    const ctx = S.trips.filter((t) => t.driver_id === driverId && ['returned', 'received', 'approved', 'paid'].includes(t.status)).map(dto);
    L.applyDriverPay(ctx, u.pay_profile, u.hourly_rate != null ? u.hourly_rate : S.settings.hourly_rate, S.settings);
    const done = new Set((S.holidayPay || []).filter((x) => x.driver_id === driverId).map((x) => x.date));
    return L.holidayPayDue(ctx, u.pay_profile, S.settings, today(), 45).filter((x) => !done.has(x.date))
      .map((x) => Object.assign({}, x, { driver_id: driverId, driver_name: u.name, approved: false }));
  }
  function holidayItems(q) {
    const d = q.get('driver_id') ? Number(q.get('driver_id')) : null; const f = q.get('from'), to = q.get('to');
    const out = (S.holidayPay || []).filter((x) => (!d || x.driver_id === d) && (!f || x.date >= f.slice(0, 10)) && (!to || x.date < to.slice(0, 10)))
      .map((x) => Object.assign({}, x, { driver_name: user(x.driver_id).name, approved: true, eligible: true }));
    (d ? [d] : S.users.filter((u) => u.active && u.roles.includes('driver')).map((u) => u.id)).forEach((id) => out.push(...holidayDue(id)));
    return out;
  }
  const bool = (v, def) => (v == null || v === '' ? def : v === true || v === 'true');

  const routes = [
    ['POST', /^\/login$/, (m, b) => {
      const u = S.users.find((x) => x.username === String(b.username || '').toLowerCase());
      if (!u || !u.active || b.password !== 'demo1234!!') throw new E('Incorrect username or password.');
      me = u; audit('login', 'user', u.id); return { ok: true };
    }],
    ['GET', /^\/me$/, () => { if (!me) throw new E('Please sign in.'); return { app_version: L.APP_VERSION, user: me, perms: [...perms()], pages: L.pagesFor(me.roles), csrf: 'demo', demo: true, demo_reset: me.roles.includes('admin'), must_change_pw: false }; }],
    ['POST', /^\/admin\/demo-reset$/, (m, b) => { need('users.manage'); if (b.confirm !== 'RESET') throw new E('Please confirm the reset.'); S = fresh(); save(); me = null; return { ok: true }; }],
    ['POST', /^\/me\/password$/, (m, b) => { if (b.current_password !== 'demo1234!!') throw new E('The current password is not correct.'); if (!b.new_password || b.new_password.length < 10) throw new E('Please enter a new password (10+ characters).'); return { ok: true, note: 'demo' }; }],
    ['GET', /^\/notifications$/, () => {
      watchLongTrips();
      const mine = (S.notes || []).filter((n) => n.user_id === me.id).sort((a, b) => b.id - a.id);
      return { unread: mine.filter((n) => !n.read_at).length, items: mine.slice(0, 30) };
    }],
    ['POST', /^\/notifications\/read$/, () => { (S.notes || []).forEach((n) => { if (n.user_id === me.id && !n.read_at) n.read_at = new Date().toISOString(); }); return { ok: true }; }],
    ['POST', /^\/push\/(subscribe|unsubscribe)$/, () => ({ ok: true })],
    ['GET', /^\/today$/, () => {
      const corrections = S.corrections.filter((c) => ['pending', 'first_approved'].includes(c.status)).map((c) => {
        const t = S.trips.find((x) => x.id === c.trip_id); return Object.assign({}, c, { trip_no: t.trip_no, driver_name: user(t.driver_id).name });
      });
      const trips = S.trips.filter((t) => !['paid', 'cancelled'].includes(t.status)).map(dto);
      return L.todayItems({ perms: perms(), userId: me.id, trips, corrections, settings: S.settings, now: Date.now() });
    }],
    ['POST', /^\/logout$/, () => { me = null; return { ok: true }; }],
    ['GET', /^\/drivers$/, () => S.users.filter((u) => u.active && u.roles.includes('driver')).map((u) => ({ id: u.id, name: u.name }))],
    ['GET', /^\/trips\?(.*)$/, (m) => {
      const q = new URLSearchParams(m[1]); const sc = q.get('scope'); const p = perms();
      let list;
      if (sc === 'my') { need('trip.own'); list = S.trips.filter((t) => t.driver_id === me.id && L.ACTIVE_STATUSES.includes(t.status)); }
      else if (sc === 'board') { need('board.view'); list = S.trips.filter((t) => ['dispatched', 'in_progress', 'returning', 'returned'].includes(t.status)); }
      else if (sc === 'dispatch') { need('dispatch.view', 'dispatch.edit'); list = S.trips.slice(); }
      else if (sc === 'receipt') { need('receipt.view', 'receipt.edit'); list = S.trips.filter((t) => ['in_progress', 'returning', 'returned', 'received'].includes(t.status)); }
      else if (sc === 'history') {
        need('history.all', 'history.own');
        list = range(q, S.trips);
        if (!p.has('history.all')) list = S.trips.filter((t) => t.driver_id === me.id && list.includes(t));
      } else throw new E('Invalid request.');
      const out = sorted(list).map(dto);
      const once = sc === 'board' || sc === 'receipt' || (sc === 'history' && p.has('history.all') && !q.get('driver_id'));
      if (!once) return out;
      const seen = new Set();
      return out.filter((t) => { if (!t.team) return true; if (seen.has(t.team.lead_id)) return false; seen.add(t.team.lead_id); return true; });
    }],
    ['GET', /^\/trips\/(\d+)$/, (m) => dto(tripOr404(Number(m[1]), !canSeeAll()))],
    ['POST', /^\/trips$/, (m, b) => {
      need('dispatch.edit');
      const d = S.users.find((u) => u.id === Number(b.driver_id) && u.roles.includes('driver'));
      if (!d) throw new E('Select a driver.');
      const d2 = b.second_driver_id ? S.users.find((u) => u.id === Number(b.second_driver_id) && u.roles.includes('driver')) : null;
      if (b.second_driver_id && !d2) throw new E('Driver not found.');
      if (d2 && d2.id === d.id) throw new E('Pick two different drivers for a team trip.');
      const vt = b.vehicle_type ? S.vehicleTypes.find((x) => x.name.toLowerCase() === String(b.vehicle_type).toLowerCase()) : null;
      if (b.vehicle_type && !vt) throw new E('Pick a vehicle type from the list, or add it with the Add button.');
      const t = { id: ++S.seq, vehicle_type: vt ? vt.name : null, trip_no: `T${new Date().toISOString().slice(2, 10).replace(/-/g, '')}-${String(S.trips.length + 1).padStart(3, '0')}`, driver_id: d.id,
        vehicle: nonEmpty(b.vehicle, 'vehicle'), pickup_location: nonEmpty(b.pickup_location, 'pickup location'), destination: nonEmpty(b.destination, 'destination'),
        planned_departure: nonEmpty(b.planned_departure, 'planned departure'), planned_hours: b.planned_hours ? Number(b.planned_hours) : null,
        cargo_ref: b.cargo_ref || null, status: 'dispatched', created_at: new Date().toISOString() };
      S.trips.push(t); saveAddr(S, t.pickup_location); saveAddr(S, t.destination); audit('trip.create', 'trip', t.id, { trip_no: t.trip_no });
      if (d2) {
        const t2 = Object.assign({}, t, { id: ++S.seq, trip_no: `${t.trip_no}-B`, driver_id: d2.id, team_id: t.id });
        t.team_id = t.id; S.trips.push(t2); audit('trip.create', 'trip', t2.id, { trip_no: t2.trip_no, team_with: t.id });
        notify([d2.id], { kind: 'trip', title: 'New team trip assigned', body: `${t.pickup_location} → ${t.destination}`, link: '#my', key: `trip:${t2.id}` });
      }
      notify([d.id], { kind: 'trip', title: d2 ? 'New team trip assigned' : 'New trip assigned', body: `${new Date(t.planned_departure).toLocaleString('en-CA', { weekday: 'short', month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit', hour12: false })} · ${t.pickup_location} → ${t.destination}`, link: '#my', key: `trip:${t.id}` });
      return t;
    }],
    ['POST', /^\/trips\/(\d+)\/cancel$/, (m, b) => {
      need('dispatch.edit'); const t = tripOr404(Number(m[1]));
      const grp = t.team_id ? S.trips.filter((x) => x.team_id === t.team_id) : [t];
      if (grp.some((x) => x.status !== 'dispatched')) throw new E(t.team_id ? 'Only team trips that neither driver has accepted can be cancelled.' : 'Only trips that have not departed can be cancelled.');
      grp.forEach((x) => { x.status = 'cancelled'; audit('trip.cancel', 'trip', x.id, { reason: b.reason }); }); return { ok: true };
    }],
    ['POST', /^\/trips\/(\d+)\/events$/, (m, b) => {
      need('trip.own'); const t = tripOr404(Number(m[1]), true);
      if (!(L.ALLOWED_EVENTS[t.status] || []).includes(b.type)) throw new E(`You can't press '${L.BUTTON_LABELS[b.type] || b.type}' now.`);
      if (b.type === 'depart' && Date.now() < new Date(L.acceptOpensAt(t.planned_departure, S.settings)).getTime()) throw new E(`Accept opens ${S.settings.accept_early_min} min before the planned departure.`);
      if (b.type === 'depart' && S.trips.some((x) => x.driver_id === t.driver_id && x.id !== t.id && ['in_progress', 'returning'].includes(x.status))) throw new E('You already have a trip in progress.');
      const tapped = b.at ? new Date(b.at).getTime() : NaN; // tap time from the 10-second undo window, accepted only if under 2 minutes old
      const at = Number.isFinite(tapped) && tapped <= Date.now() + 5000 && tapped >= Date.now() - 120000 ? new Date(Math.min(tapped, Date.now())).toISOString() : new Date().toISOString();
      S.events.push({ id: ++S.seq, trip_id: t.id, type: b.type, occurred_at: at, recorded_by: me.id, method: 'button', data: {}, created_at: new Date().toISOString() });
      recompute(t); audit('trip.event', 'trip', t.id, { type: b.type }); return { status: t.status };
    }],
    ['POST', /^\/trips\/(\d+)\/receipt$/, (m, b) => {
      need('receipt.edit'); const t = tripOr404(Number(m[1]));
      const grp = t.team_id ? S.trips.filter((x) => x.team_id === t.team_id) : [t];
      if (grp.some((x) => x.status !== 'returned')) throw new E(t.team_id ? 'Both drivers of this team trip must tap Finish before it can be received.' : 'Only trips the driver has finished can be received.');
      if (b.result === 'issue') nonEmpty(b.note, 'issue details');
      const items = (b.items || []).map((x) => {
        const species = nonEmpty(x.species, 'the fish species'), lot = nonEmpty(x.lot, 'the lot number');
        const lb = Number(x.lb); if (!(lb >= 1 && lb <= 220000)) throw new E('Please enter the weight in lb.');
        const unit = L.PACK_UNITS[x.unit] ? x.unit : null;
        const c = Number(x.count); const count = unit ? (x.count != null && x.count !== '' ? (Number.isInteger(c) && c >= 1 ? c : (() => { throw new E('The count is not a valid value.'); })()) : L.countFromWeight(lb, unit)) : null;
        return { species, lot, lb, tonnes: Math.round(lb / L.LB_PER_TONNE * 1000) / 1000, unit, count };
      });
      if (!items.length) throw new E('Please enter at least one fish species and lot number.');
      const at = b.received_at || new Date().toISOString();
      if (new Date(at) > Date.now() + 5 * 60000 || new Date(at) < Date.now() - 7 * 864e5) throw new E('Received time must be within the last 7 days.');
      grp.forEach((x) => {
        S.events.push({ id: ++S.seq, trip_id: x.id, type: 'receipt', occurred_at: at, recorded_by: me.id, method: 'receipt', data: { result: b.result, note: b.note || null, items }, created_at: new Date().toISOString() });
        recompute(x); audit('trip.receipt', 'trip', x.id, { result: b.result });
      });
      return { status: t.status };
    }],
    ['POST', /^\/trips\/(\d+)\/memos$/, (m, b) => {
      need('board.memo'); const t = tripOr404(Number(m[1]));
      S.memos.push({ id: ++S.seq, trip_id: t.id, author_id: me.id, note: nonEmpty(b.note, 'a note'), created_at: new Date().toISOString() });
      audit('trip.memo', 'trip', t.id, { note: b.note }); return { ok: true };
    }],
    ['GET', /^\/corrections$/, () => {
      need('correction.own', 'correction.view', 'correction.first', 'correction.final');
      const all = ['correction.view', 'correction.first', 'correction.final'].some((x) => perms().has(x));
      return S.corrections.filter((c) => all || tripOr404(c.trip_id).driver_id === me.id).map((c) => {
        const t = S.trips.find((x) => x.id === c.trip_id);
        const prev = S.events.filter((e) => e.trip_id === c.trip_id && e.type === c.event_type && e.id < (c.result_event_id || Infinity)).pop();
        return Object.assign({}, c, { trip_no: t.trip_no, driver_id: t.driver_id, driver_name: user(t.driver_id).name, original_time: prev ? prev.occurred_at : null,
          first_by_name: c.first_by ? user(c.first_by).name : null, final_by_name: c.final_by ? user(c.final_by).name : null });
      }).sort((a, b) => (['pending', 'first_approved'].includes(b.status) - ['pending', 'first_approved'].includes(a.status)) || b.id - a.id);
    }],
    ['POST', /^\/corrections$/, (m, b) => {
      need('correction.own'); const t = tripOr404(Number(b.trip_id), true);
      if (['approved', 'paid', 'cancelled'].includes(t.status)) throw new E('This trip is pay-approved and can no longer be corrected.');
      if (!b.requested_time || isNaN(new Date(b.requested_time))) throw new E('Please enter the correct time.');
      if (new Date(b.requested_time) > Date.now() + 300000) throw new E('A correction cannot be set in the future.');
      if (S.corrections.some((c) => c.trip_id === t.id && c.event_type === b.event_type && ['pending', 'first_approved'].includes(c.status))) throw new E('There is already an open correction for this item.');
      assertOrder(t.id, b.event_type, b.requested_time);
      const c = { id: ++S.seq, trip_id: t.id, event_type: b.event_type, requested_time: b.requested_time, reason: nonEmpty(b.reason, 'a reason'), requested_by: me.id, status: 'pending', created_at: new Date().toISOString() };
      S.corrections.push(c); audit('correction.request', 'correction', c.id, { trip_id: t.id });
      notify(usersWith(['correction.first'], [me.id]), { kind: 'correction', title: 'Time correction to check', body: `${me.name} · trip ${t.trip_no}: ${L.EVENT_LABELS[c.event_type]} time`, link: '#corrections', key: `corr1:${c.id}` });
      return c;
    }],
    ['POST', /^\/corrections\/(\d+)\/(first|final)$/, (m, b) => {
      const stage = m[2]; need(stage === 'first' ? 'correction.first' : 'correction.final');
      const c = S.corrections.find((x) => x.id === Number(m[1])); if (!c) throw new E('Not found.');
      if (c.status !== (stage === 'first' ? 'pending' : 'first_approved')) throw new E('Already handled, or the previous approval step is still pending.');
      if (c.requested_by === me.id) throw new E('You cannot approve your own correction request.');
      if (stage === 'final' && c.first_by === me.id) throw new E('The first approver cannot also give final approval.');
      const now = new Date().toISOString();
      const tn = S.trips.find((x) => x.id === c.trip_id).trip_no;
      const tell = (ok) => notify([c.requested_by], { kind: 'correction', title: ok ? 'Your time correction was approved' : 'Your time correction was not approved', body: `Trip ${tn}: ${L.EVENT_LABELS[c.event_type]}${c.reject_reason ? ' · ' + c.reject_reason : ''}`, link: '#history', key: `corr3:${c.id}` });
      if (!b.approve) { Object.assign(c, { status: 'rejected', reject_reason: nonEmpty(b.reason, 'a rejection reason'), [stage + '_by']: me.id, [stage + '_at']: now }); audit(`correction.${stage}.reject`, 'correction', c.id); tell(false); return c; }
      if (stage === 'first') { Object.assign(c, { status: 'first_approved', first_by: me.id, first_at: now }); audit('correction.first.approve', 'correction', c.id);
        notify(usersWith(['correction.final'], [c.requested_by, me.id]), { kind: 'correction', title: 'Correction ready for final approval', body: `Trip ${tn}: ${L.EVENT_LABELS[c.event_type]} time`, link: '#corrections', key: `corr2:${c.id}` }); return c; }
      assertOrder(c.trip_id, c.event_type, c.requested_time);
      const e = { id: ++S.seq, trip_id: c.trip_id, type: c.event_type, occurred_at: c.requested_time, recorded_by: me.id, method: 'correction', data: { correction_id: c.id }, created_at: now };
      S.events.push(e); Object.assign(c, { status: 'approved', final_by: me.id, final_at: now, result_event_id: e.id }); tell(true);
      recompute(S.trips.find((t) => t.id === c.trip_id)); audit('correction.final.approve', 'correction', c.id, { event_id: e.id }); return c;
    }],
    ['GET', /^\/pay\?(.*)$/, (m) => {
      need('pay.own', 'pay.view', 'pay.approve'); const all = perms().has('pay.view') || perms().has('pay.approve');
      let list = range(new URLSearchParams(m[1]), S.trips).filter((t) => ['returned', 'received', 'approved', 'paid'].includes(t.status));
      const q = new URLSearchParams(m[1]);
      if (!all) { list = S.trips.filter((t) => t.driver_id === me.id && list.includes(t)); q.set('driver_id', me.id); }
      const waiting = perms().has('pay.approve') ? range(new URLSearchParams(m[1]), S.trips).filter((t) => L.ACTIVE_STATUSES.includes(t.status)).map(dto)
        .map((t) => ({ id: t.id, trip_no: t.trip_no, driver_name: t.driver_name, status: t.status, planned_departure: t.planned_departure, team: t.team, pickup_location: t.pickup_location, destination: t.destination })) : [];
      return { trips: withDriverPay(sorted(list).map(dto)), waiting, holidays: holidayItems(q), rules: L.rulesOf(S.settings), settings: S.settings };
    }],
    ['GET', /^\/pay\/drivers$/, () => {
      need('pay.view', 'pay.approve');
      return S.users.filter((u) => u.active && u.roles.includes('driver')).sort((a, b) => a.name.localeCompare(b.name))
        .map((u) => ({ id: u.id, name: u.name, hourly_rate: u.hourly_rate == null ? null : u.hourly_rate, profile: L.profileOf(u.pay_profile) }));
    }],
    ['POST', /^\/pay\/profile\/(\d+)$/, (m, b) => {
      need('pay.approve', 'settings.edit'); const u = S.users.find((x) => x.id === Number(m[1]) && x.roles.includes('driver')); if (!u) throw new E('Not found.');
      const rate = b.hourly_rate === '' || b.hourly_rate == null ? null : Number(b.hourly_rate);
      if (rate != null && !(rate >= 0 && rate <= 1000)) throw new E('hourly rate must be between 0 and 1000.');
      if (!L.OT_RULES[b.ot_rule || 'none']) throw new E('Unknown overtime rule.');
      const vac = b.vacation_pct === '' || b.vacation_pct == null ? 0 : Number(b.vacation_pct);
      if (!(vac >= 0 && vac <= 20)) throw new E('vacation pay % must be between 0 and 20.');
      const meal = b.meal_min === '' || b.meal_min == null ? null : Number(b.meal_min);
      if (meal != null && !(Number.isInteger(meal) && meal >= 0 && meal <= 240)) throw new E('meal break minutes must be between 0 and 240.');
      const before = Object.assign({ hourly_rate: u.hourly_rate == null ? null : u.hourly_rate }, L.profileOf(u.pay_profile));
      u.hourly_rate = rate; u.pay_profile = { ot_rule: b.ot_rule || 'none', vacation_pct: vac, meal_min: meal, stat_pay: bool(b.stat_pay, true), callin: bool(b.callin, true), meal_paid: bool(b.meal_paid, false) };
      audit('pay.profile', 'user', u.id, { before, after: Object.assign({ hourly_rate: rate }, u.pay_profile) }); return { ok: true };
    }],
    ['GET', /^\/pay\/rules$/, () => {
      need('pay.view', 'pay.approve', 'settings.view', 'settings.edit');
      const y = Number(today().slice(0, 4));
      return { rules: L.rulesOf(S.settings), bc_defaults: L.BC_RULES, holidays: [y, y + 1].map((yy) => ({ year: yy, list: [...L.holidayMap(S.settings, [yy]).entries()].filter(([d]) => d.startsWith(String(yy))).sort().map(([date, name]) => ({ date, name })) })) };
    }],
    ['PUT', /^\/pay\/rules$/, (m, b) => {
      need('pay.approve', 'settings.edit');
      const rules = {};
      Object.keys(L.BC_RULES).forEach((k) => { if (typeof L.BC_RULES[k] === 'number') { const v = Number(b[k]); if (b[k] === '' || b[k] == null || !Number.isFinite(v) || v < 0) throw new E(`Please enter a valid number for ${k.replace(/_/g, ' ')}.`); rules[k] = v; } });
      rules.bc_holidays = bool(b.bc_holidays, true);
      rules.extra_holidays = (b.extra_holidays || []).map((x) => { if (!/^\d{4}-\d{2}-\d{2}$/.test(x.date || '') || isNaN(new Date(x.date))) throw new E(`${x.date} is not a valid date (use YYYY-MM-DD).`); return { date: x.date, name: x.name || 'Company holiday' }; });
      rules.deductions = (b.deductions || []).map((x) => { const v = Number(x.pct); if (!x.name || !(v >= 0 && v <= 60)) throw new E(`Deduction "${x.name}" needs a % between 0 and 60.`); return { name: x.name, pct: v }; });
      const before = L.rulesOf(S.settings);
      S.settings = Object.assign({}, S.settings, { pay_rules: rules, hourly_rate: b.hourly_rate === '' || b.hourly_rate == null ? null : Number(b.hourly_rate), meal_deduction_min: Number(b.meal_min) || 0 });
      audit('pay.rules', 'settings', null, { before, after: rules }); return { ok: true };
    }],
    ['POST', /^\/pay\/holiday\/approve$/, (m, b) => {
      need('pay.approve'); const id = Number(b.driver_id);
      const item = holidayDue(id).find((x) => x.date === b.date);
      if (!item) throw new E('Nothing to approve for this holiday. It may be approved already, or the driver worked that day.');
      const u = user(id); const rate = u.hourly_rate != null ? u.hourly_rate : S.settings.hourly_rate;
      if (rate != null && rate < L.rulesOf(S.settings).min_wage) throw new E('This driver\'s hourly rate is below the minimum wage in Pay rules. Fix it on the Drivers pay setting page first.');
      S.holidayPay = S.holidayPay || [];
      const x = { id: ++S.seq, driver_id: id, date: item.date, name: item.name, days_worked: item.days_worked, avg: item.avg, vacation: item.vacation, amount: item.amount,
        approved_by: me.id, approved_at: new Date().toISOString(), paid_at: null, payment_ref: null };
      S.holidayPay.push(x); audit('pay.holiday', 'user', id, { date: x.date, amount: x.amount }); return { id: x.id, amount: x.amount };
    }],
    ['POST', /^\/pay\/(\d+)\/approve$/, (m, b) => {
      need('pay.approve'); const t = tripOr404(Number(m[1]));
      const p = approveCore(t, b, me.id, new Date().toISOString());
      S.pay.push(p); t.status = 'approved'; audit('pay.approve', 'trip', t.id, { amount: p.amount, reason: p.adjustment_reason }); return p;
    }],
    ['GET', /^\/payhist(?:\?(.*))?$/, (m) => {
      need('payhist.view');
      const q = new URLSearchParams(m[1] || '');
      const list = range(q, S.trips).filter((t) => ['approved', 'paid'].includes(t.status));
      return L.payHistoryRows(sorted(list).map(dto), { fish: q.get('fish') || '', lot: q.get('lot') || '', sort: q.get('sort') || 'date' });
    }],
    ['GET', /^\/vehicle-types$/, () => { need('dispatch.view', 'dispatch.edit'); return S.vehicleTypes; }],
    ['POST', /^\/vehicle-types$/, (m, b) => {
      need('dispatch.edit'); const name = nonEmpty(b.name, 'a vehicle type').replace(/\s+/g, ' ').slice(0, 40);
      if (S.vehicleTypes.some((x) => x.name.toLowerCase() === name.toLowerCase())) throw new E('That vehicle type is already in the list.');
      const x = { id: ++S.seq, name }; S.vehicleTypes.push(x); audit('vehicle_type.add', 'vehicle_type', x.id, { name }); return x;
    }],
    ['GET', /^\/addresses$/, () => { need('dispatch.view', 'dispatch.edit'); return (S.addresses || []).slice().sort((a, b) => b.use_count - a.use_count || a.address.localeCompare(b.address)); }],
    ['POST', /^\/addresses$/, (m, b) => { need('dispatch.edit'); saveAddr(S, nonEmpty(b.address, 'an address')); return { ok: true }; }],
    ['POST', /^\/addresses\/(\d+)$/, (m, b) => {
      need('dispatch.edit'); const x = (S.addresses || []).find((y) => y.id === Number(m[1])); if (!x) throw new E('Not found.');
      if (b.remove === true) { S.addresses = S.addresses.filter((y) => y !== x); audit('address.remove', 'address', x.id, { address: x.address }); return { ok: true }; }
      const a = nonEmpty(b.address, 'an address');
      if (S.addresses.some((y) => y !== x && y.address.toLowerCase() === a.toLowerCase())) throw new E('That address is already saved.');
      x.address = a; audit('address.edit', 'address', x.id, { address: a }); return { ok: true };
    }],
    ['GET', /^\/payout$/, () => {
      need('payout.view', 'payout.edit');
      const rows = payoutRows().map((x) => Object.assign({ kind: 'trip' }, x)).concat((S.holidayPay || []).map((x) => ({ kind: 'holiday', holiday_id: x.id, trip_id: null,
        trip_no: `Stat holiday · ${x.name}`, driver_name: user(x.driver_id).name, amount: x.amount, approved_by_name: user(x.approved_by).name, approved_at: x.approved_at,
        paid_at: x.paid_at, payment_ref: x.payment_ref })));
      rows.forEach((x) => { const dd = L.deductionsFor(x.amount, S.settings); x.deductions = dd.total; x.net = dd.net; });
      rows.sort((a, b) => (a.paid_at ? 1 : 0) - (b.paid_at ? 1 : 0));
      return { rows, deductions: L.rulesOf(S.settings).deductions };
    }],
    ['POST', /^\/payout\/holiday\/(\d+)\/paid$/, (m, b) => {
      need('payout.edit'); const x = (S.holidayPay || []).find((y) => y.id === Number(m[1])); if (!x) throw new E('Not found.');
      if (x.paid_at) throw new E('Already marked as paid.');
      Object.assign(x, { paid_at: new Date().toISOString(), paid_by: me.id, payment_ref: b.payment_ref || null }); audit('payout.paid', 'holiday_pay', x.id, { payment_ref: b.payment_ref }); return { ok: true };
    }],
    ['POST', /^\/payout\/(\d+)\/paid$/, (m, b) => {
      need('payout.edit'); const p = S.pay.find((x) => x.trip_id === Number(m[1])); if (!p) throw new E('Not found.');
      if (p.paid_at) throw new E('Already marked as paid.');
      Object.assign(p, { paid_at: new Date().toISOString(), paid_by: me.id, payment_ref: b.payment_ref || null });
      S.trips.find((t) => t.id === p.trip_id).status = 'paid'; audit('payout.paid', 'trip', p.trip_id, { payment_ref: b.payment_ref }); return { ok: true };
    }],
    ['GET', /^\/settings$/, () => { need('settings.view', 'settings.edit'); return S.settings; }],
    ['PUT', /^\/settings$/, (m, b) => {
      need('settings.edit'); const before = Object.assign({}, S.settings);
      S.settings = Object.assign({}, S.settings, { rounding_unit_min: Number(b.rounding_unit_min),
        rounding_mode: b.rounding_mode, long_trip_warn_hours: Number(b.long_trip_warn_hours), mismatch_warn_min: Number(b.mismatch_warn_min), accept_early_min: Number(b.accept_early_min) });
      audit('settings.update', 'settings', null, { before, after: S.settings }); return S.settings;
    }],
    ['GET', /^\/users$/, () => { need('users.manage'); return S.users; }],
    ['POST', /^\/users$/, (m, b) => {
      need('users.manage'); const username = nonEmpty(b.username, 'username').toLowerCase();
      if (S.users.some((u) => u.username === username)) throw new E('That username is already taken.');
      if (!b.password || b.password.length < 10) throw new E('Password must be at least 10 characters.');
      if (!b.roles || !b.roles.length) throw new E('Select at least one role.');
      const u = { id: ++S.seq, username, name: nonEmpty(b.name, 'name'), roles: b.roles, active: true, created_at: new Date().toISOString() };
      S.users.push(u); audit('user.create', 'user', u.id, { username, roles: b.roles }); return u;
    }],
    ['POST', /^\/users\/(\d+)$/, (m, b) => {
      need('users.manage'); const u = S.users.find((x) => x.id === Number(m[1])); if (!u) throw new E('Not found.');
      if (u.id === me.id && (b.active === false || (b.roles && !b.roles.includes('admin')))) throw new E('You cannot remove your own admin role or deactivate yourself.');
      if (b.roles) { if (!b.roles.length) throw new E('Select at least one role.'); u.roles = b.roles; }
      if (b.active !== undefined) u.active = b.active;
      if (b.name !== undefined) { u.name = nonEmpty(b.name, 'name').slice(0, 80); if (me.id === u.id) me.name = u.name; }
      audit('user.update', 'user', u.id, { roles: b.roles, active: b.active, name: b.name, password_reset: !!b.password }); return { ok: true };
    }],
    ['GET', /^\/receipts\?(.*)$/, (m) => {
      need('receipt.view', 'receipt.edit', 'history.all');
      const q = new URLSearchParams(m[1]); const lot = (q.get('lot') || '').toLowerCase(); const fish = q.get('fish') || ''; const f = q.get('from'), to = q.get('to');
      const rows = [];
      const seenT = new Set();
      S.trips.map(dto).filter((t) => { if (!t.team) return true; if (seenT.has(t.team.lead_id)) return false; seenT.add(t.team.lead_id); return true; })
        .filter((t) => t.receipt && (!f || t.times.receipt >= f) && (!to || t.times.receipt < to)).forEach((t) => (t.receipt.items || []).forEach((x) => {
        if (lot && !String(x.lot || '').toLowerCase().includes(lot)) return;
        if (fish && (fish === 'Other' ? L.MAIN_SPECIES.includes(x.species) : x.species !== fish)) return;
        rows.push({ trip_id: t.id, trip_no: t.trip_no, driver_name: L.teamNames(t), team: !!t.team, vehicle: t.vehicle, vehicle_type: t.vehicle_type, received_at: t.times.receipt, species: x.species, lot: x.lot, tonnes: x.tonnes, lb: L.lbOf(x), unit: x.unit || null, count: x.count == null ? null : x.count, result: t.receipt.result });
      }));
      return rows.sort((a, b) => (a.received_at < b.received_at ? 1 : -1));
    }],
    ['GET', /^\/audit$/, () => { need('audit.view'); return S.audit.slice().reverse().map((a) => Object.assign({}, a, { user_name: user(a.user_id).name })); }],
  ];

  // Load saved data only after every helper above exists (seeding uses them)
  try { S = JSON.parse(localStorage.getItem(KEY)) || fresh(); } catch (e) { S = fresh(); }
  window.MockAPI = {
    async call(method, path, body) {
      await new Promise((r) => setTimeout(r, 60));
      for (const [mm, re, fn] of routes) {
        const m = path.match(re);
        if (mm === method && m) {
          if (!me && path !== '/login') throw new Error('Please sign in.');
          const out = fn(m, body || {});
          if (method !== 'GET') save();
          return JSON.parse(JSON.stringify(out));
        }
      }
      throw new Error('Not found.');
    },
    reset() { S = fresh(); save(); me = null; location.hash = ''; location.reload(); },
  };
  window.DEMO_ACCOUNTS = { password: 'demo1234!!', users: [
    ['driver1', 'Driver - Driver 1'], ['scheduler', 'Scheduler - Kaitlin'], ['logistics', 'Scheduler, Logistics Manager - Jaskaran'],
    ['payer', 'Payroll - Simon'], ['accounting', 'Accounting - Rene'], ['admin', 'Admin - all pages'], ['driver2', 'Driver - Driver 2'], ['driver3', 'Driver - Driver 3']] };
})();
