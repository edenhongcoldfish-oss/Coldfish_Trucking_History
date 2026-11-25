/* Pure logic shared by the server and the browser (preview): permissions, pages, time and pay math */
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory();
  else root.Logic = factory();
})(typeof self !== 'undefined' ? self : this, function () {
  'use strict';

  // Bump on every release. The browser compares it with the server's copy to spot a server that was not restarted.
  const APP_VERSION = '0.8.0';
  // Main species shown as quick picks in Receiving (anything else goes under Other)
  const MAIN_SPECIES = ['Black Cod', 'Halibut', 'Salmon'];
  // Receiving: average weight of one packing unit, used to count cases/totes from the total weight.
  // Change the numbers here only; the screen, the hint text and the server all read them from this table.
  const PACK_UNITS = {
    case: { label: 'Case', plural: 'cases', avg_lb: 49.5, basis: 'fresh case' },
    tote: { label: 'Tote', plural: 'totes', avg_lb: 975, basis: 'full tote' },
  };
  const LB_PER_TONNE = 2204.62262;
  // Suggested count = weight ÷ average weight per unit, rounded to the nearest whole unit
  function countFromWeight(lb, unit) {
    const u = PACK_UNITS[unit]; const w = Number(lb);
    if (!u || !(w > 0)) return null;
    return Math.max(1, Math.round(w / u.avg_lb));
  }
  // Weight of a fish line in lb (older lines were saved in tonnes only)
  function lbOf(x) {
    if (!x) return null;
    if (x.lb != null && x.lb !== '') return Number(x.lb);
    return x.tonnes == null ? null : Math.round(Number(x.tonnes) * LB_PER_TONNE);
  }
  // "86 cases", "1 tote", or '' when no count was recorded
  function countText(x) {
    const u = x && PACK_UNITS[x.unit];
    if (!u || x.count == null) return '';
    return `${x.count} ${x.count === 1 ? u.label.toLowerCase() : u.plural}`;
  }

  const ROLES = {
    admin: 'Admin',
    driver: 'Driver',
    scheduler: 'Scheduler',
    logistics: 'Logistics Manager',
    payer: 'Payroll',
    accounting: 'Accounting',
  };

  // Each role gets only the pages it needs (keep menus short for field staff). Admin gets everything.
  //   Driver: My Trips, Trip History, My Pay (time corrections are requested from My Trips)
  //   Scheduler: Dispatch, Trip Board, Corrections (step 1), Trip History
  //   Logistics Manager: Receiving (record fish, lot no., received time; search received fish by lot), Trip History
  //   Payroll: Corrections (final step), Pay (approve, see paid/unpaid), Drivers (pay options + pay rules)
  //   Accounting: Payouts (mark paid), Audit Log
  const ROLE_PERMS = {
    driver: ['trip.own', 'history.own', 'correction.own', 'pay.own'],
    scheduler: ['dispatch.edit', 'board.view', 'history.all', 'correction.first'],
    logistics: ['history.all', 'receipt.edit'],
    payer: ['correction.final', 'pay.approve', 'payhist.view'],
    accounting: ['payout.edit', 'payhist.view', 'audit.view'],
  };
  const ALL_PERMS = [
    'trip.own', 'trip.all', 'history.own', 'history.all', 'dispatch.view', 'dispatch.edit',
    'board.view', 'board.memo', 'receipt.view', 'receipt.edit', 'correction.own', 'correction.view',
    'correction.first', 'correction.final', 'pay.own', 'pay.view', 'pay.approve', 'payout.view',
    'payout.edit', 'payhist.view', 'settings.view', 'settings.edit', 'users.manage', 'audit.view',
  ];

  function permsFor(roles) {
    if (roles.includes('admin')) return new Set(ALL_PERMS);
    const s = new Set();
    roles.forEach((r) => (ROLE_PERMS[r] || []).forEach((p) => s.add(p)));
    return s;
  }
  function can(roles, perm) { return permsFor(roles).has(perm); }

  // Pages: shown in the menu when the user has any one of the listed permissions
  const PAGES = [
    { id: 'today', label: 'Today', any: ['dispatch.edit', 'board.view', 'receipt.edit', 'correction.first', 'correction.final', 'pay.approve', 'payout.edit'] },
    { id: 'my', label: 'My Trips', any: ['trip.own'] },
    { id: 'dispatch', label: 'Assign trips', any: ['dispatch.view', 'dispatch.edit'] },
    { id: 'board', label: 'Live trips', any: ['board.view'] },
    { id: 'receipt', label: 'Receiving', any: ['receipt.view', 'receipt.edit'] },
    { id: 'corrections', label: 'Time corrections', any: ['correction.view', 'correction.first', 'correction.final'] },
    { id: 'history', label: 'Trip History', any: ['history.own', 'history.all'] },
    { id: 'pay', label: 'Pay', any: ['pay.own', 'pay.view', 'pay.approve'] },
    { id: 'drivers', label: 'Drivers pay setting', any: ['pay.approve'] },
    { id: 'payout', label: 'Pay drivers', any: ['payout.view', 'payout.edit'] },
    { id: 'settings', label: 'Settings', any: ['settings.view', 'settings.edit'] },
    { id: 'users', label: 'Users & roles', any: ['users.manage'] },
    { id: 'payhist', label: 'Pay History', any: ['payhist.view'] },
    { id: 'addresses', label: 'Saved addresses', any: ['dispatch.edit'] },
    { id: 'audit', label: 'Activity log', any: ['audit.view'] },
  ];
  function pagesFor(roles) {
    const p = permsFor(roles);
    const list = PAGES.filter((pg) => pg.any.some((x) => p.has(x)));
    // Today only helps people with several work pages; a one-page role (e.g. Receiving) goes straight to its page
    return list.filter((pg) => pg.id !== 'today' || list.filter((x) => x.id !== 'today' && x.id !== 'my').length > 1);
  }

  // Driver flow: Accept (starts the trip and the pay clock) -> optional Pickup Done -> Finish (ends the trip).
  // Internal event keys stay 'depart' and 'return' so existing records and pay math keep working.
  const EVENT_LABELS = { depart: 'Accepted', pickup_done: 'Pickup Done', return: 'Finished', receipt: 'Received' };
  const BUTTON_LABELS = { depart: 'Accept trip', pickup_done: 'Pickup done', return: 'Finish trip' };
  const DRIVER_EVENTS = ['depart', 'pickup_done', 'return'];
  const STATUS_LABELS = {
    dispatched: 'Assigned', in_progress: 'On Trip', returning: 'Picked Up', returned: 'Finished',
    received: 'Received', approved: 'Pay Approved', paid: 'Paid', cancelled: 'Cancelled',
  };
  // Statuses shown on the driver's My Trips page; finished trips move to Trip History
  const ACTIVE_STATUSES = ['dispatched', 'in_progress', 'returning'];
  // Shown to Payroll when pay is tried before the driver pressed Finish
  const NOT_FINISHED_MSG = 'Driver has not finished this trip yet. Pay can be approved after the driver taps Finish.';

  // ---------- team trips (two drivers on one trip) ----------
  // Each driver has their own trip record, so each one's pay comes from their own Accept -> Finish time.
  // This single rule decides what a team member is paid; change it here if the company decides differently.
  //   'own_time' = every team member is paid for their own recognized time (nothing is split or halved).
  const TEAM_PAY_RULE = 'own_time';
  // "Name" or "Name + Name" for lists and exports
  const teamNames = (t) => (t.team && t.team.mates.length ? [t.driver_name || t.driver].concat(t.team.mates.map((m) => m.name)).join(' + ') : (t.driver_name || t.driver || ''));
  // Main button for each status, and every button allowed from it (Pickup Done is optional)
  const NEXT_EVENT = { dispatched: 'depart', in_progress: 'return', returning: 'return' };
  const ALLOWED_EVENTS = { dispatched: ['depart'], in_progress: ['pickup_done', 'return'], returning: ['return'] };
  // Accept opens this many minutes before the planned departure (never the day before)
  function acceptOpensAt(plannedDeparture, settings) {
    const s = Object.assign({}, DEFAULT_SETTINGS, settings || {});
    return new Date(new Date(plannedDeparture).getTime() - (Number(s.accept_early_min) || 0) * 60000).toISOString();
  }
  const STATUS_AFTER = { depart: 'in_progress', pickup_done: 'returning', return: 'returned' };

  const DEFAULT_SETTINGS = {
    hourly_rate: null,          // TBD. Enter once decided
    rounding_unit_min: 15,      // rounding unit (minutes)
    rounding_mode: 'none',      // none | nearest | down | up
    meal_deduction_min: 30,     // meal deduction
    long_trip_warn_hours: 13,   // warn near Canadian driving-hour limits
    mismatch_warn_min: 30,      // warn when Finish vs received differ
    accept_early_min: 15,       // drivers can press Accept this many minutes before the planned departure
    currency: 'CAD',
    pay_rules: null,            // BC defaults (see BC_RULES); payroll edits them on the Drivers pay setting page
  };

  function minutesBetween(a, b) {
    if (!a || !b) return null;
    return Math.round((new Date(b) - new Date(a)) / 60000);
  }

  function roundMinutes(min, unit, mode) {
    if (min == null) return null;
    if (!unit || mode === 'none') return min;
    const f = mode === 'down' ? Math.floor : mode === 'up' ? Math.ceil : Math.round;
    return f(min / unit) * unit;
  }

  // recorded time (button values) -> paid time (used for pay) -> amount.
  // The meal break is deducted only when the trip is longer than the pay rules' "meal after" hours (BC: 5 h),
  // and never when the driver had to stay on call during the break (opts.mealPaid).
  function computePay(departAt, returnAt, settings, opts) {
    const s = Object.assign({}, DEFAULT_SETTINGS, settings || {});
    const R = rulesOf(s);
    const recorded = minutesBetween(departAt, returnAt);
    if (recorded == null || recorded < 0) return { recorded, recognized: null, amount: null };
    const mealPaid = !!(opts && opts.mealPaid);
    const meal = !mealPaid && recorded > R.meal_after_h * 60 ? (Number(s.meal_deduction_min) || 0) : 0;
    const afterMeal = Math.max(0, recorded - meal);
    const recognized = roundMinutes(afterMeal, Number(s.rounding_unit_min), s.rounding_mode);
    const rate = s.hourly_rate == null || s.hourly_rate === '' ? null : Number(s.hourly_rate);
    const amount = rate == null ? null : Math.round((recognized / 60) * rate * 100) / 100;
    const mealDue = recorded > R.meal_after_h * 60 ? (Number(s.meal_deduction_min) || 0) : 0;
    return { recorded, recognized, amount, rate, meal, meal_due: mealDue, meal_paid: mealPaid && mealDue > 0 };
  }

  // From a trip's events, the currently effective time per type (latest correction wins)
  function effectiveTimes(events) {
    const out = {};
    events
      .slice()
      .sort((a, b) => a.id - b.id)
      .forEach((e) => { out[e.type] = e; });
    return out;
  }

  function flags(trip, eff, settings, now) {
    const s = Object.assign({}, DEFAULT_SETTINGS, settings || {});
    const f = [];
    const dep = eff.depart && eff.depart.occurred_at;
    const ret = eff.return && eff.return.occurred_at;
    const end = ret || (['in_progress', 'returning'].includes(trip.status) ? now || new Date().toISOString() : null);
    const elapsed = minutesBetween(dep, end);
    if (elapsed != null && elapsed > s.long_trip_warn_hours * 60) f.push('long');
    if (ret && eff.receipt) {
      const diff = Math.abs(minutesBetween(ret, eff.receipt.occurred_at));
      if (diff > s.mismatch_warn_min) f.push('mismatch');
    }
    return { flags: f, elapsed };
  }

  // Accept <= Pickup Done <= Finish (compares only values that exist)
  function orderOk(times) {
    const seq = DRIVER_EVENTS.map((k) => times[k]).filter(Boolean).map((v) => new Date(v).getTime());
    return seq.every((v, i) => i === 0 || seq[i - 1] <= v);
  }

  // Pay History: one row per fish line (lot) of each pay-approved trip. The trip's paid time and amount sit on
  // one row per trip only, so column totals never double count. The page and the Excel export both use this.
  function payHistoryRows(trips, f) {
    f = f || {};
    const fish = String(f.fish || '').trim();
    const lot = String(f.lot || '').trim().toLowerCase();
    const rows = [];
    trips.forEach((t) => {
      const items = (t.receipt && t.receipt.items && t.receipt.items.length) ? t.receipt.items : [{ species: '', lot: '', tonnes: null }];
      items.filter((x) => (!fish || (fish === 'Other' ? x.species && !MAIN_SPECIES.includes(x.species) : x.species === fish))
        && (!lot || String(x.lot || '').toLowerCase().includes(lot)))
        .forEach((x) => rows.push({
          trip_id: t.id, date: t.planned_departure, trip_no: t.trip_no, driver: t.driver_name || '', species: x.species || '',
          team_with: t.team ? t.team.mates.map((m) => m.name).join(' + ') : '', team_key: t.team ? t.team.lead_id : t.id, vehicle_type: t.vehicle_type || '',
          // A team trip's fish is shown on both drivers' lines, but its weight counts once (on the first driver's line)
          lot: x.lot || '', tonnes: x.tonnes == null || (t.team && t.team.lead_id !== t.id) ? null : Number(x.tonnes), status: t.status,
          paid_min: null, rate: null, amount: null, approved_at: t.pay.approved_at || null, paid_at: t.pay.paid_at || null,
        }));
    });
    const keys = { driver: (r) => r.driver.toLowerCase(), fish: (r) => r.species.toLowerCase(), lot: (r) => r.lot.toLowerCase() };
    const key = keys[f.sort];
    rows.sort((a, b) => {
      if (key) { const x = key(a), y = key(b); if (x !== y) return x < y ? -1 : 1; }
      if (a.date !== b.date) return a.date < b.date ? 1 : -1; // newest first
      return a.trip_id - b.trip_id;
    });
    // Pay belongs to the trip, not the lot: it goes on the trip's first line only; the other lines say "same trip"
    const seen = new Map();
    rows.forEach((r) => {
      if (seen.has(r.trip_id)) { r.same_trip = true; r.pay_lot = seen.get(r.trip_id); return; }
      seen.set(r.trip_id, r.lot || r.species || '');
      const t = trips.find((x) => x.id === r.trip_id);
      r.paid_min = t.pay.recognized; r.rate = t.pay.rate; r.amount = t.pay.amount;
    });
    return rows;
  }

  // ---------- pay rules (British Columbia defaults) ----------
  // Default values follow BC employment standards (Employment Standards Act and Regulation, incl. s.37.3 for truck
  // drivers). Payroll can change every value on the Drivers pay setting page (stored in settings.pay_rules). Confirm with your
  // payroll provider. Short haul = usually within 160 km of the home terminal; long haul = usually beyond.
  const TIMEZONE = 'America/Vancouver';
  const BC_RULES = {
    min_wage: 18.25,              // BC general minimum wage per hour, from June 1, 2026
    ot_mult: 1.5,                 // overtime multiplier
    short_day_h: 9, short_week_h: 45, // short haul: overtime after 9 h a day / 45 h a week
    long_week_h: 60,              // long haul: overtime after 60 h a week
    stat_mult: 1.5,               // worked on a stat holiday: 1.5x ...
    stat_double_after_h: 12, stat_double_mult: 2, // ... and 2x after 12 h that day
    stat_eligible_days: 15,       // eligible after working 15 of the 30 days before the holiday
    callin_h: 2,                  // minimum daily pay when the driver reports for work
    callin_long_h: 4, callin_long_after_h: 8, // 4 h minimum when the day was scheduled for more than 8 h
    meal_after_h: 5,              // a 30-min meal break is due after 5 h; deducted only on trips longer than this
    bc_holidays: true,            // use the BC statutory holiday list
    extra_holidays: [],           // [{ date: 'YYYY-MM-DD', name }] company paid holidays
    deductions: [],               // [{ name, pct }] estimate only; payroll provider does the real tax, CPP, EI
  };
  const BC_MIN_WAGE = BC_RULES.min_wage;
  function rulesOf(settings) {
    const s = settings || {};
    const R = Object.assign({}, BC_RULES, s.pay_rules || {});
    Object.keys(BC_RULES).forEach((k) => { if (typeof BC_RULES[k] === 'number') { const v = Number(R[k]); R[k] = Number.isFinite(v) ? v : BC_RULES[k]; } });
    R.bc_holidays = R.bc_holidays !== false;
    R.extra_holidays = Array.isArray(R.extra_holidays) ? R.extra_holidays : [];
    R.deductions = Array.isArray(R.deductions) ? R.deductions : [];
    R.meal_min = Number(s.meal_deduction_min != null ? s.meal_deduction_min : DEFAULT_SETTINGS.meal_deduction_min) || 0;
    R.hourly_rate = s.hourly_rate == null || s.hourly_rate === '' ? null : Number(s.hourly_rate);
    return R;
  }
  const hrs = (v) => `${Number(v)} h`;
  function otRules(R) {
    R = R || BC_RULES;
    return {
      none: { label: 'No overtime', hint: 'All hours at the regular rate.' },
      short_haul: { label: 'BC short haul', hint: `${R.ot_mult}× after ${hrs(R.short_day_h)} a day and after ${hrs(R.short_week_h)} a week (only the first ${hrs(R.short_day_h)} of each day count toward the week).`, day: R.short_day_h * 60, week: R.short_week_h * 60 },
      long_haul: { label: 'BC long haul', hint: `${R.ot_mult}× after ${hrs(R.long_week_h)} a week.`, week: R.long_week_h * 60 },
    };
  }
  const OT_RULES = otRules(BC_RULES);
  // Per-driver options. Defaults: BC rules on, break deducted.
  const DEFAULT_PROFILE = { ot_rule: 'none', vacation_pct: 4, meal_min: null, stat_pay: true, callin: true, meal_paid: false };
  function profileOf(p) {
    const x = Object.assign({}, DEFAULT_PROFILE, p || {});
    if (!OT_RULES[x.ot_rule]) x.ot_rule = 'none';
    x.vacation_pct = Number(x.vacation_pct) || 0;
    x.meal_min = x.meal_min == null || x.meal_min === '' ? null : Number(x.meal_min);
    x.stat_pay = x.stat_pay !== false; x.callin = x.callin !== false; x.meal_paid = x.meal_paid === true;
    return x;
  }
  const localDay = (iso) => new Intl.DateTimeFormat('en-CA', { timeZone: TIMEZONE, year: 'numeric', month: '2-digit', day: '2-digit' }).format(new Date(iso));
  function weekOf(day) { const d = new Date(day + 'T12:00:00Z'); d.setUTCDate(d.getUTCDate() - ((d.getUTCDay() + 6) % 7)); return d.toISOString().slice(0, 10); }
  const addDays = (day, n) => { const d = new Date(day + 'T12:00:00Z'); d.setUTCDate(d.getUTCDate() + n); return d.toISOString().slice(0, 10); };

  // BC statutory holidays for a year
  function bcHolidays(year) {
    const ymd = (m, d) => `${year}-${String(m).padStart(2, '0')}-${String(d).padStart(2, '0')}`;
    const nthMonday = (m, n) => { const first = new Date(Date.UTC(year, m - 1, 1)).getUTCDay(); return 1 + ((8 - first) % 7) + (n - 1) * 7; };
    // Easter (Anonymous Gregorian algorithm) -> Good Friday
    const a = year % 19, b = Math.floor(year / 100), c = year % 100, d = Math.floor(b / 4), e = b % 4, f = Math.floor((b + 8) / 25);
    const g = Math.floor((b - f + 1) / 3), hh = (19 * a + b - d - g + 15) % 30, i = Math.floor(c / 4), k = c % 4;
    const l = (32 + 2 * e + 2 * i - hh - k) % 7, m = Math.floor((a + 11 * hh + 22 * l) / 451);
    const em = Math.floor((hh + l - 7 * m + 114) / 31), ed = ((hh + l - 7 * m + 114) % 31) + 1;
    const gf = new Date(Date.UTC(year, em - 1, ed - 2));
    const may25 = new Date(Date.UTC(year, 4, 25)).getUTCDay();
    const victoria = 25 - (((may25 + 6) % 7) || 7);
    return [
      { date: ymd(1, 1), name: "New Year's Day" }, { date: ymd(2, nthMonday(2, 3)), name: 'Family Day' },
      { date: gf.toISOString().slice(0, 10), name: 'Good Friday' }, { date: ymd(5, victoria), name: 'Victoria Day' },
      { date: ymd(7, 1), name: 'Canada Day' }, { date: ymd(8, nthMonday(8, 1)), name: 'B.C. Day' },
      { date: ymd(9, 30), name: 'National Day for Truth and Reconciliation' }, { date: ymd(10, nthMonday(10, 2)), name: 'Thanksgiving Day' },
      { date: ymd(11, 11), name: 'Remembrance Day' }, { date: ymd(12, 25), name: 'Christmas Day' },
    ];
  }
  // date -> name for the given years (BC list if on, plus company extras)
  function holidayMap(settings, years) {
    const R = rulesOf(settings);
    const map = new Map();
    if (R.bc_holidays) years.forEach((y) => bcHolidays(y).forEach((x) => map.set(x.date, x.name)));
    R.extra_holidays.forEach((x) => { if (x && /^\d{4}-\d{2}-\d{2}$/.test(x.date)) map.set(x.date, x.name || 'Company holiday'); });
    return map;
  }
  function yearsAround(days) {
    const ys = new Set(); days.forEach((d) => { const y = Number(String(d).slice(0, 4)); if (y) { ys.add(y); ys.add(y - 1); } });
    if (!ys.size) ys.add(new Date().getUTCFullYear());
    return [...ys];
  }

  // items: [{ id, start, minutes }] in any order -> { id: { regular, ot } }. A trip counts on the day it was accepted.
  function splitOvertime(items, rule, rules) {
    const r = otRules(rules)[rule] || OT_RULES.none;
    const out = {};
    const day = {}; const week = {};
    items.slice().sort((a, b) => new Date(a.start) - new Date(b.start) || a.id - b.id).forEach((it) => {
      const m = Math.max(0, Number(it.minutes) || 0);
      const d = localDay(it.start); const w = weekOf(d);
      let ot = 0; let countsForWeek = m;
      if (r.day) {
        const before = day[d] || 0; day[d] = before + m;
        const dailyOt = Math.max(0, before + m - r.day) - Math.max(0, before - r.day);
        ot += dailyOt; countsForWeek = m - dailyOt;
      }
      if (r.week) {
        const before = week[w] || 0; week[w] = before + countsForWeek;
        ot += Math.max(0, before + countsForWeek - r.week) - Math.max(0, before - r.week);
      }
      out[it.id] = { regular: m - ot, ot };
    });
    return out;
  }
  const round2 = (v) => Math.round(v * 100) / 100;
  const money2 = (v) => `$${Number(v).toFixed(2)}`;
  const grossOf = (t) => (t.pay.gross != null ? t.pay.gross : t.pay.amount == null ? 0 : t.pay.amount - (t.pay.vacation || 0));

  // trips: one driver's trips (as the API returns them). Fills in regular / overtime / stat holiday / call-in minutes,
  // gross, vacation pay and amount (= what the driver is paid) for trips not yet approved, plus automatic checks
  // (pay.checks: [{ tone, text }]). Approved trips keep their stored numbers but still count toward overtime and
  // minimum pay.
  function applyDriverPay(trips, profile, rate, settings) {
    const p = profileOf(profile);
    const R = rulesOf(settings);
    const r = rate == null || rate === '' ? null : Number(rate);
    const worked = trips.filter((t) => t.times && t.times.depart && t.pay && t.pay.recognized != null)
      .sort((a, b) => new Date(a.times.depart) - new Date(b.times.depart) || a.id - b.id);
    const dayOf = (t) => localDay(t.times.depart);
    const hol = holidayMap(settings, yearsAround(worked.map(dayOf)));
    const statName = (t) => (p.stat_pay ? hol.get(dayOf(t)) : null);
    // Overtime on normal days. Hours on a stat holiday already get the holiday rate.
    const split = splitOvertime(worked.filter((t) => !statName(t)).map((t) => ({ id: t.id, start: t.times.depart, minutes: t.pay.recognized })), p.ot_rule, R);
    const stat = {}; const statDay = {};
    worked.filter(statName).forEach((t) => {
      const d = dayOf(t); const before = statDay[d] || 0; const m = t.pay.recognized; statDay[d] = before + m;
      const lim = R.stat_double_after_h * 60;
      const dbl = Math.max(0, before + m - lim) - Math.max(0, before - lim);
      stat[t.id] = { stat: m - dbl, dbl };
    });
    // Minimum daily pay (call-in): 2 h, or 4 h when the day was scheduled for more than 8 h
    const callin = {};
    if (p.callin) {
      const byDay = new Map();
      worked.forEach((t) => { const d = dayOf(t); if (!byDay.has(d)) byDay.set(d, []); byDay.get(d).push(t); });
      byDay.forEach((list) => {
        const total = list.reduce((x, t) => x + t.pay.recognized, 0);
        const planned = list.reduce((x, t) => x + (Number(t.planned_hours) || 0), 0);
        const min = (planned > R.callin_long_after_h ? R.callin_long_h : R.callin_h) * 60;
        const already = list.filter((t) => t.pay.approved).reduce((x, t) => x + (Number(t.pay.callin) || 0), 0);
        const top = Math.max(0, min - total - already);
        const open = list.filter((t) => !t.pay.approved);
        if (top > 0 && open.length) callin[open[open.length - 1].id] = { top, min };
      });
    }
    // Days worked in the 30 days before a date (for stat holiday eligibility)
    const workedDays = new Set(worked.map(dayOf));
    const daysBefore = (day) => { let n = 0; for (let i = 1; i <= 30; i++) if (workedDays.has(addDays(day, -i))) n++; return n; };
    trips.forEach((t) => {
      if (!t.pay) return;
      const checks = [];
      const rr = t.pay.approved ? t.pay.rate : r;
      if (rr != null && rr < R.min_wage) checks.push({ tone: 'bad', text: `Rate below minimum wage (${money2(R.min_wage)}/h)` });
      if (t.pay.approved) {
        if (t.pay.callin) checks.push({ tone: 'info', text: `Minimum pay +${t.pay.callin} min` });
        if (t.pay.stat || t.pay.dbl) checks.push({ tone: 'info', text: 'Stat holiday' });
        if (t.pay.meal_paid) checks.push({ tone: 'info', text: 'Break paid (on call)' });
        t.pay.checks = checks;
        return;
      }
      if (r == null) checks.push({ tone: 'bad', text: 'No hourly rate' });
      const sp = split[t.id]; const st = stat[t.id];
      if (!sp && !st) { t.pay.checks = checks; return; }
      const regular = sp ? sp.regular : 0; const ot = sp ? sp.ot : 0;
      const sMin = st ? st.stat : 0; const dbl = st ? st.dbl : 0;
      const ci = callin[t.id] ? callin[t.id].top : 0;
      if (st) {
        checks.push({ tone: 'info', text: `${statName(t)}: ${R.stat_mult}×` });
        const n = daysBefore(dayOf(t));
        if (n < R.stat_eligible_days) checks.push({ tone: 'warn', text: `Check holiday eligibility (worked ${n} of 30 days before)` });
      }
      if (ci) checks.push({ tone: 'info', text: `Minimum ${callin[t.id].min / 60} h pay: +${ci} min` });
      if (t.pay.meal_paid) checks.push({ tone: 'info', text: 'Break paid (on call)' });
      const units = regular + ot * R.ot_mult + sMin * R.stat_mult + dbl * R.stat_double_mult + ci;
      const gross = r == null ? null : round2((units / 60) * r);
      const vacation = gross == null ? null : round2((gross * p.vacation_pct) / 100);
      Object.assign(t.pay, { regular, ot, stat: sMin, dbl, callin: ci, rate: r, gross, vacation, vacation_pct: p.vacation_pct, ot_rule: p.ot_rule,
        amount: gross == null ? null : round2(gross + vacation), checks });
    });
    return trips;
  }

  // Stat holiday the driver did not work: average day's pay = wages in the 30 days before / days worked.
  // trips: the driver's trips with pay filled in by applyDriverPay. today: 'YYYY-MM-DD'. Lists holidays in the last
  // `lookbackDays` days (before today) that the driver did not work.
  function holidayPayDue(trips, profile, settings, today, lookbackDays) {
    const p = profileOf(profile);
    if (!p.stat_pay) return [];
    const R = rulesOf(settings);
    const worked = trips.filter((t) => t.times && t.times.depart && t.pay && t.pay.recognized != null);
    const byDay = new Map();
    worked.forEach((t) => { const d = localDay(t.times.depart); if (!byDay.has(d)) byDay.set(d, []); byDay.get(d).push(t); });
    const from = addDays(today, -(lookbackDays || 45));
    const hol = holidayMap(settings, yearsAround([today, from]));
    const out = [];
    [...hol.entries()].filter(([d]) => d >= from && d < today).sort().forEach(([date, name]) => {
      if (byDay.has(date)) return; // worked that day: paid through the trip at the holiday rate
      let days = 0; let wages = 0;
      for (let i = 1; i <= 30; i++) { const list = byDay.get(addDays(date, -i)); if (list) { days++; wages += list.reduce((x, t) => x + grossOf(t), 0); } }
      const avg = days ? round2(wages / days) : 0;
      const vacation = round2((avg * p.vacation_pct) / 100);
      if (!days) return; // nothing earned in the 30 days before: no holiday pay to show
      out.push({ date, name, days_worked: days, wages: round2(wages), avg, vacation, amount: round2(avg + vacation), eligible: days >= R.stat_eligible_days });
    });
    return out;
  }

  // Estimated deductions from the pay rules (the payroll provider does the real tax, CPP and EI)
  function deductionsFor(amount, settings) {
    const R = rulesOf(settings);
    const lines = R.deductions.filter((d) => d && d.name && Number(d.pct) > 0).map((d) => ({ name: d.name, pct: Number(d.pct), amount: round2((Number(amount) || 0) * Number(d.pct) / 100) }));
    const total = round2(lines.reduce((x, d) => x + d.amount, 0));
    return { lines, total, net: round2((Number(amount) || 0) - total) };
  }

  // ---------- Today: what needs someone's action right now ----------
  // ctx: { perms: Set, userId, trips (API trips, not paid/cancelled), corrections (pending/first_approved), settings, now }
  function todayItems(ctx) {
    const has = (x) => ctx.perms.has(x);
    const now = ctx.now || Date.now();
    const items = [];
    const add = (key, title, hint, tone, page, list) => { if (list.length) items.push({ key, title, hint, tone, page, count: list.length, list: list.slice(0, 5) }); };
    const tripLine = (t, extra) => ({ trip_id: t.id, trip_no: t.trip_no, driver: t.driver_name, text: extra });
    const limitMin = Number(ctx.settings.long_trip_warn_hours || 13) * 60;
    if (has('board.view') || has('users.manage')) {
      add('long', `Over ${ctx.settings.long_trip_warn_hours || 13} h on the road`, 'Call the driver and check they are safe.', 'bad', 'board',
        ctx.trips.filter((t) => ACTIVE_STATUSES.includes(t.status) && t.status !== 'dispatched' && t.elapsed_min > limitMin)
          .map((t) => tripLine(t, `${Math.floor(t.elapsed_min / 60)} h since Accept`)));
    }
    if (has('dispatch.edit')) {
      add('late', 'Not accepted yet', 'Planned start was over 30 minutes ago.', 'warn', 'dispatch',
        ctx.trips.filter((t) => t.status === 'dispatched' && new Date(t.planned_departure).getTime() < now - 30 * 60000)
          .map((t) => tripLine(t, `planned ${new Date(t.planned_departure).toLocaleTimeString('en-CA', { timeZone: TIMEZONE, hour: '2-digit', minute: '2-digit', hour12: false })}`)));
    }
    if (has('receipt.edit')) {
      add('receive', 'Waiting for receiving', 'Finished trips with no fish record yet.', 'warn', 'receipt',
        ctx.trips.filter((t) => t.status === 'returned' && (!t.team || t.team.lead_id === t.id)).map((t) => tripLine({ ...t, driver_name: teamNames(t) }, t.pickup_location)));
    }
    if (has('correction.first')) {
      add('corr1', 'Corrections to check', 'First approval.', 'info', 'corrections',
        ctx.corrections.filter((c) => c.status === 'pending' && c.requested_by !== ctx.userId)
          .map((c) => ({ trip_id: c.trip_id, trip_no: c.trip_no, driver: c.driver_name, text: 'time correction' })));
    }
    if (has('correction.final')) {
      add('corr2', 'Corrections for final approval', 'Already checked by the scheduler.', 'info', 'corrections',
        ctx.corrections.filter((c) => c.status === 'first_approved' && c.requested_by !== ctx.userId && c.first_by !== ctx.userId)
          .map((c) => ({ trip_id: c.trip_id, trip_no: c.trip_no, driver: c.driver_name, text: 'time correction' })));
    }
    if (has('pay.approve')) {
      add('pay', 'Ready for pay approval', 'Finished trips with no open correction.', 'ok', 'pay',
        ctx.trips.filter((t) => ['returned', 'received'].includes(t.status) && !t.pending_corrections && t.pay && !t.pay.approved)
          .map((t) => tripLine(t, `${Math.floor((t.pay.recognized || 0) / 60)} h ${String((t.pay.recognized || 0) % 60).padStart(2, '0')} m`)));
    }
    if (has('payout.edit')) {
      const list = ctx.trips.filter((t) => t.status === 'approved');
      add('payout', 'Approved, not paid yet', 'Mark each one paid once the payment is sent.', 'ok', 'payout',
        list.map((t) => tripLine(t, t.pay && t.pay.amount != null ? `$${Number(t.pay.amount).toFixed(2)}` : '')));
      if (items.length && items[items.length - 1].key === 'payout') items[items.length - 1].amount = list.reduce((x, t) => x + Number((t.pay && t.pay.amount) || 0), 0);
    }
    return items;
  }

  return {
    NOT_FINISHED_MSG, TEAM_PAY_RULE, teamNames,
    todayItems,
    TIMEZONE, BC_MIN_WAGE, BC_RULES, rulesOf, otRules, OT_RULES, DEFAULT_PROFILE, profileOf, localDay, weekOf, addDays, splitOvertime, applyDriverPay,
    bcHolidays, holidayMap, holidayPayDue, deductionsFor,
    payHistoryRows,
    APP_VERSION, MAIN_SPECIES, PACK_UNITS, LB_PER_TONNE, countFromWeight, lbOf, countText, orderOk, ROLES, ROLE_PERMS, ALL_PERMS, PAGES, EVENT_LABELS, BUTTON_LABELS, DRIVER_EVENTS, STATUS_LABELS, NEXT_EVENT,
    ALLOWED_EVENTS, ACTIVE_STATUSES, acceptOpensAt,
    STATUS_AFTER, DEFAULT_SETTINGS, permsFor, can, pagesFor, minutesBetween, roundMinutes,
    computePay, effectiveTimes, flags,
  };
});
