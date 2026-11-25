/* Trip Log web app UI. The server enforces permissions; the UI only splits menus for convenience.
   All data is rendered with textContent only (no innerHTML, prevents XSS). */
(function () {
  'use strict';
  const L = window.Logic;
  let me = null;
  let csrf = '';

  // ---------- API ----------
  async function api(method, path, body) {
    if (window.MockAPI) return window.MockAPI.call(method, path, body); // preview only
    const res = await fetch('/api' + path, {
      method,
      credentials: 'same-origin',
      headers: Object.assign({ 'Content-Type': 'application/json' }, method !== 'GET' ? { 'X-CSRF-Token': csrf } : {}),
      body: body ? JSON.stringify(body) : undefined,
    });
    const data = await res.json().catch(() => ({}));
    if (res.status === 401 && path !== '/login') { me = null; render(); throw new Error(data.error || 'Please sign in.'); }
    if (!res.ok) throw Object.assign(new Error(data.error || 'Request failed.'), { status: res.status, data });
    return data;
  }

  // ---------- DOM helpers ----------
  function h(tag, attrs, ...kids) {
    const el = document.createElement(tag);
    if (attrs) for (const [k, v] of Object.entries(attrs)) {
      if (v == null || v === false) continue;
      if (k.startsWith('on')) el.addEventListener(k.slice(2), v);
      else if (k === 'class') el.className = v;
      else if (k === 'value') el.value = v;
      else el.setAttribute(k, v === true ? '' : v);
    }
    for (const k of kids.flat(Infinity)) {
      if (k == null || k === false) continue;
      el.append(k instanceof Node ? k : document.createTextNode(String(k)));
    }
    return el;
  }
  // Simple line icons (SVG built with DOM calls, no innerHTML)
  const ICONS = {
    truck: ['M3 6h11v10H3z', 'M14 9h4l3 3.5V16h-7', 'c7 17.5 1.8', 'c17 17.5 1.8'],
    route: ['c6 19 2', 'c18 5 2', 'M8 19h7.5a3.5 3.5 0 0 0 0-7h-7a3.5 3.5 0 0 1 0-7H16'],
    plus: ['M4 6a2 2 0 0 1 2-2h12a2 2 0 0 1 2 2v12a2 2 0 0 1-2 2H6a2 2 0 0 1-2-2z', 'M12 8v8', 'M8 12h8'],
    board: ['M4 4h7v7H4z', 'M13 4h7v7h-7z', 'M4 13h7v7H4z', 'M13 13h7v7h-7z'],
    box: ['M3 7.5 12 3l9 4.5v9L12 21l-9-4.5z', 'M3 7.5 12 12l9-4.5', 'M12 12v9'],
    edit: ['M4 20h4L19 9a2.8 2.8 0 0 0-4-4L4 16z', 'M13.5 6.5l4 4'],
    clock: ['c12 12 9', 'M12 7v5l3 2'],
    dollar: ['M12 3v18', 'M16.5 7.5C16.5 5.6 14.5 4.5 12 4.5S7.5 5.6 7.5 7.5 9.5 10.3 12 11s4.5 1.9 4.5 4-2 3.5-4.5 3.5-4.5-1.3-4.5-3.3'],
    cash: ['M3 6h18v12H3z', 'c12 12 2.5', 'M6 9v.01', 'M18 15v.01'],
    sliders: ['M4 6h9', 'M17 6h3', 'c15 6 2', 'M4 12h3', 'M11 12h9', 'c9 12 2', 'M4 18h11', 'M19 18h1', 'c17 18 2'],
    users: ['c9 8 3.5', 'M2.5 20c.8-3.6 3.3-5.5 6.5-5.5s5.7 1.9 6.5 5.5', 'M16 4.6a3.5 3.5 0 0 1 0 6.8', 'M18 14.8c1.9.8 3 2.6 3.5 5.2'],
    shield: ['M12 3l8 3v6c0 4.6-3.4 8-8 9-4.6-1-8-4.4-8-9V6z', 'M9 12l2 2 4-4'],
    logout: ['M15 4h3a2 2 0 0 1 2 2v12a2 2 0 0 1-2 2h-3', 'M10 8l-4 4 4 4', 'M6 12h10'],
    more: ['c5 12 1.2', 'c12 12 1.2', 'c19 12 1.2'],
    pin: ['M12 21s-7-6.2-7-11.5a7 7 0 0 1 14 0C19 14.8 12 21 12 21z', 'c12 9.5 2.5'],
    check: ['M5 12.5l4.5 4.5L19 7.5'],
    flag: ['M5 21V4', 'M5 4h12l-2 4 2 4H5'],
    x: ['M6 6l12 12', 'M18 6 6 18'],
    alert: ['M12 3 2 20h20z', 'M12 10v4', 'M12 17v.01'],
    ext: ['M14 4h6v6', 'M20 4l-9 9', 'M18 14v5a1 1 0 0 1-1 1H5a1 1 0 0 1-1-1V7a1 1 0 0 1 1-1h5'],
    inbox: ['M3 13l3-8h12l3 8v6H3z', 'M3 13h5l1 2h6l1-2h5'],
    play: ['M7 4.5v15l12-7.5z'],
    lock: ['M5 11h14v10H5z', 'M8 11V7a4 4 0 0 1 8 0v4'],
    list: ['M8 6h12', 'M8 12h12', 'M8 18h12', 'M4 6h.01', 'M4 12h.01', 'M4 18h.01'],
    download: ['M12 4v11', 'M7 10l5 5 5-5', 'M5 20h14'],
    search: ['c11 11 6.5', 'M16 16l4.5 4.5'],
    bell: ['M6 16v-5a6 6 0 0 1 12 0v5l1.5 2h-15z', 'M10 20.5a2 2 0 0 0 4 0'],
    help: ['c12 12 9', 'M9.6 9.5a2.5 2.5 0 1 1 3.4 2.3c-.6.3-1 .9-1 1.6v.4', 'M12 17v.01'],
    home: ['M4 11 12 4l8 7', 'M6 9.5V20h12V9.5', 'M10 20v-5h4v5'],
    phone: ['M7 3h10v18H7z', 'M11 18h2'],
    key: ['c8 15 4', 'M11 12l8-8', 'M16 7l2 2', 'M14 9l2 2'],
    undo: ['M9 14 4 9l5-5', 'M4 9h10a6 6 0 0 1 0 12h-3'],
  };
  const SVGNS = 'http://www.w3.org/2000/svg';
  function icon(name, cls) {
    const svg = document.createElementNS(SVGNS, 'svg');
    svg.setAttribute('viewBox', '0 0 24 24'); svg.setAttribute('class', 'i' + (cls ? ' ' + cls : '')); svg.setAttribute('aria-hidden', 'true');
    (ICONS[name] || []).forEach((d) => {
      let el;
      if (d[0] === 'c') { const [cx, cy, r] = d.slice(1).split(' '); el = document.createElementNS(SVGNS, 'circle'); el.setAttribute('cx', cx); el.setAttribute('cy', cy); el.setAttribute('r', r); }
      else { el = document.createElementNS(SVGNS, 'path'); el.setAttribute('d', d); }
      svg.append(el);
    });
    return svg;
  }
  const PAGE_ICON = { today: 'home', guide: 'help', my: 'route', dispatch: 'plus', board: 'board', receipt: 'box', corrections: 'edit', history: 'clock', pay: 'dollar', drivers: 'users', payout: 'cash', payhist: 'list', addresses: 'pin', settings: 'sliders', users: 'users', audit: 'shield' };
  const pageHead = (title, sub, ...actions) => h('div', { class: 'page-head' }, h('div', null, h('h1', null, title), sub ? h('p', { class: 'sub' }, sub) : null), actions.length ? h('div', { class: 'row' }, actions) : null);
  const emptyBox = (text, ic) => h('div', { class: 'card empty' }, icon(ic || 'inbox'), h('span', null, text));
  const statCard = (label, value, ic, tone, foot) => h('div', { class: 'card stat-card' }, h('div', { class: 'stat-ico ' + (tone || '') }, icon(ic)),
    h('div', null, h('div', { class: 'muted small' }, label), h('div', { class: 'stat' }, value), foot ? h('div', { class: 'small muted' }, foot) : null));
  const $app = () => document.getElementById('app');
  function toast(msg, err) {
    const t = h('div', { class: 'toast' + (err ? ' err' : ''), role: err ? 'alert' : 'status' }, icon(err ? 'alert' : 'check', 'sm'), msg);
    document.body.append(t);
    setTimeout(() => t.remove(), err ? 4500 : 2500);
  }
  let busy = false;
  async function act(fn, okMsg) {
    if (busy) return; // ignore double taps while a request is running
    busy = true;
    try { const r = await fn(); if (okMsg) toast(okMsg); await route(); return r; }
    catch (e) { toast(e.message, true); route(); } // refresh so the screen matches the server
    finally { busy = false; }
  }
  function modal(title, body, onClose) {
    const bg = h('div', { class: 'modal-bg', onclick: (e) => { if (e.target === bg) close(); } });
    const close = () => { bg.remove(); onClose && onClose(); };
    bg.append(h('div', { class: 'modal', role: 'dialog', 'aria-label': title },
      h('div', { class: 'modal-head' }, h('h1', null, title), h('button', { class: 'icon-btn', 'aria-label': 'Close', onclick: close }, icon('x'))), body));
    document.body.append(bg);
    return close;
  }

  // In-page dialog instead of browser confirm/prompt (works on phones and in sandboxed frames)
  function ask(title, { input = false, optional = false, ok = 'OK', type = 'text', text = '', danger = false } = {}) {
    return new Promise((resolve) => {
      let done = false;
      const field = input ? h('input', { type, maxlength: 500 }) : null;
      const finish = (v) => { if (done) return; done = true; close(); resolve(v); };
      const close = modal(title, h('div', null,
        text ? h('p', { class: 'sub mt0' }, text) : null,
        field ? h('div', { class: 'my10' }, field) : null,
        h('div', { class: 'actions' },
          h('button', { class: 'btn', onclick: () => finish(input ? null : false) }, 'Cancel'),
          h('button', { class: danger ? 'btn danger' : 'btn primary', onclick: () => {
            if (!field) return finish(true);
            if (!field.value.trim() && !optional) { field.focus(); return; }
            finish(field.value.trim());
          } }, ok))), () => finish(input ? null : false));
      if (field) setTimeout(() => field.focus(), 50);
    });
  }

  // ---------- formatting ----------
  const fmtTime = (v) => v ? new Date(v).toLocaleString('en-CA', { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit', hour12: false }) : '–';
  const fmtDate = (v) => v ? new Date(v).toLocaleDateString('en-CA', { weekday: 'short', month: 'short', day: 'numeric' }) : '–';
  const fmtMin = (m) => m == null ? '–' : `${Math.floor(m / 60)}h ${String(Math.abs(m % 60)).padStart(2, '0')}m`;
  const money = (v) => v == null ? 'Rate TBD' : '$' + Number(v).toLocaleString('en-CA', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
  const toLocalInput = (v) => { const d = new Date(v); d.setMinutes(d.getMinutes() - d.getTimezoneOffset()); return d.toISOString().slice(0, 16); };
  const can = (p) => me && me.perms.includes(p);
  // Google Maps search link (no API, free). Only the address text is stored in the app.
  const mapsUrl = (q) => 'https://www.google.com/maps/search/?api=1&query=' + encodeURIComponent(q || '');
  const place = (text) => text ? h('a', { href: mapsUrl(text), target: '_blank', rel: 'noopener noreferrer', class: 'maplink', title: 'Open in Google Maps' }, text) : '–';
  const routeOf = (t) => [place(t.pickup_location), ' → ', place(t.destination)];
  // Dispatch helper: button opens Google Maps with what is typed; user confirms there and copies the address back.
  function mapButton(input) {
    const a = h('a', { class: 'btn', target: '_blank', rel: 'noopener noreferrer', href: 'https://www.google.com/maps', title: 'Check this address on Google Maps' }, icon('pin', 'sm'), 'Map');
    const sync = () => { a.href = input.value.trim() ? mapsUrl(input.value.trim()) : 'https://www.google.com/maps'; };
    input.addEventListener('input', sync); sync();
    return a;
  }
  const STATUS_CHIP = { dispatched: 'info', in_progress: '', returning: '', returned: 'warn', received: 'ok', approved: 'ok', paid: 'ok', cancelled: 'gray' };
  const statusChip = (s) => h('span', { class: 'chip ' + (STATUS_CHIP[s] || '') }, L.STATUS_LABELS[s] || s);
  // Team trip (two drivers): a small badge and the other driver's name
  const teamChip = (t) => (t.team ? h('span', { class: 'chip info', title: 'Team trip: two drivers, each paid for their own time' }, 'Team') : null);
  const withText = (t) => (t.team && t.team.mates.length ? `with ${t.team.mates.map((m) => m.name).join(' + ')}` : '');
  const vehicleText = (t) => [t.vehicle_type, t.vehicle].filter(Boolean).join(' · ');
  const whoCell = (t) => h('span', null, t.driver_name, ' ', teamChip(t), t.team ? h('div', { class: 'small muted' }, withText(t)) : null);
  function flagChips(t) {
    return [
      t.flags.includes('long') ? h('span', { class: 'chip bad' }, 'Long trip') : null,
      t.flags.includes('mismatch') ? h('span', { class: 'chip warn' }, 'Finish/receiving mismatch') : null,
      t.pending_corrections ? h('span', { class: 'chip warn' }, `${t.pending_corrections} open correction${t.pending_corrections > 1 ? 's' : ''}`) : null,
    ];
  }
  const fmtClock = (v) => v ? new Date(v).toLocaleTimeString('en-CA', { hour: '2-digit', minute: '2-digit', hour12: false }) : '';
  // Progress: Assigned -> Accepted -> Pickup (optional) -> Finished
  function stepper(t) {
    const steps = [['Assigned', t.planned_departure, true], ['Accepted', t.times.depart, !!t.times.depart],
      ['Pickup', t.times.pickup_done, !!t.times.pickup_done], ['Finished', t.times.return, !!t.times.return]];
    const nowIdx = steps.findIndex((x) => !x[2]);
    return h('ol', { class: 'stepper', 'aria-label': 'Trip progress' }, steps.map(([label, at, done], i) => {
      const skipped = i === 2 && !done && t.times.return;
      const cls = done ? 'done' : i === nowIdx ? 'now' : '';
      return h('li', { class: cls }, h('span', { class: 'b' }, done ? icon('check') : skipped ? '–' : String(i + 1)), h('span', null, label),
        h('span', { class: 't' }, done && i > 0 ? fmtClock(at) : skipped ? 'skipped' : ''));
    }));
  }
  function routeBlock(t) {
    return h('div', { class: 'route' },
      h('span', { class: 'dot' }), h('div', null, h('div', { class: 'lbl' }, 'Pickup'), h('div', { class: 'addr' }, place(t.pickup_location))),
      h('span', { class: 'line' }), h('span'),
      h('span', { class: 'dot end' }), h('div', null, h('div', { class: 'lbl' }, 'Destination'), h('div', { class: 'addr' }, place(t.destination))));
  }
  function timeline(t) {
    return h('ul', { class: 'timeline' }, L.DRIVER_EVENTS.concat('receipt').map((k) =>
      h('li', null, h('span', { class: 't' }, fmtTime(t.times[k])), h('span', null, L.EVENT_LABELS[k]),
        k === 'receipt' && t.receipt ? h('span', { class: 'chip ' + (t.receipt.result === 'ok' ? 'ok' : 'bad') }, t.receipt.result === 'ok' ? 'OK' : 'Problem') : null)));
  }
  function payLine(t) {
    const p = t.pay;
    const row = (label, val) => [h('dt', null, label), h('dd', { class: 'mono' }, val)];
    return h('dl', { class: 'kv' },
      row('Recorded time', fmtMin(p.recorded)),
      h('dt', null, 'Paid time'), h('dd', { class: 'mono' }, fmtMin(p.recognized), p.adjustment_reason ? h('span', { class: 'small muted' }, ` (adjusted: ${p.adjustment_reason})`) : null,
        p.meal ? h('span', { class: 'small muted' }, ` (${p.meal} min meal break deducted)`) : null),
      p.ot ? row('Overtime', fmtMin(p.ot)) : null,
      p.stat || p.dbl ? row('Stat holiday hours', fmtMin((p.stat || 0) + (p.dbl || 0))) : null,
      p.callin ? row('Minimum pay top-up', fmtMin(p.callin)) : null,
      p.vacation ? row('Vacation pay', money(p.vacation)) : null,
      row(p.approved ? 'Approved amount' : 'Estimated amount', money(p.amount)));
  }

  // ---------- trip detail ----------
  async function showTrip(id) {
    const t = await api('GET', `/trips/${id}`).catch((e) => { toast(e.message, true); });
    if (!t) return;
    const body = h('div', null,
      h('div', { class: 'row' }, statusChip(t.status), teamChip(t), flagChips(t)),
      t.status !== 'cancelled' ? stepper(t) : null,
      routeBlock(t),
      h('dl', { class: 'kv' },
        h('dt', null, t.team ? 'Drivers (team)' : 'Driver'), h('dd', null, L.teamNames(t)),
        h('dt', null, 'Vehicle'), h('dd', null, vehicleText(t)),
        h('dt', null, 'Planned start'), h('dd', null, fmtTime(t.planned_departure), t.planned_hours ? ` · est. ${t.planned_hours} h` : ''),
        h('dt', null, 'PO / note'), h('dd', null, t.cargo_ref || '–')),
      h('h2', null, 'Current times'), timeline(t),
      t.status !== 'dispatched' ? [h('h2', null, 'Time and pay'), payLine(t)] : null,
      h('h2', null, 'Full record (never deleted)'),
      h('ul', { class: 'timeline' }, t.events.map((e) => h('li', null,
        h('span', { class: 't' }, fmtTime(e.occurred_at)),
        h('span', null, L.EVENT_LABELS[e.type], ' · ',
          h('span', { class: 'muted small' }, e.method === 'correction' ? `Correction applied (${e.recorded_by_name})` : e.method === 'receipt' ? `Inspected by ${e.recorded_by_name}${e.data && e.data.note ? ' · ' + e.data.note : ''}` : `Button (${e.recorded_by_name})`))))),
      t.receipt && t.receipt.items ? [h('h2', null, 'Fish received'), fishList(t.receipt.items)] : null,
      can('correction.own') && t.times.depart && !['approved', 'paid'].includes(t.status) ? h('div', { class: 'mt12' }, h('button', { class: 'btn', onclick: () => correctionForm(t) }, icon('edit', 'sm'), 'Fix a time')) : null,
      t.memos.length ? [h('h2', null, 'Exception notes'), t.memos.map((m) => h('p', { class: 'small' }, h('b', null, m.author_name), ` · ${fmtTime(m.created_at)} — `, m.note))] : null);
    modal(`Trip ${t.trip_no}`, body);
  }

  // ---------- page: My Trips (driver) ----------
  // Only open trips are shown here. Finished trips move to Trip History.
  // One trip at a time: the Current trip card is the running trip, or the earliest one not accepted yet.
  // Only that card has buttons; Upcoming trips are view-only until the current one is finished.
  async function pageMy(main) {
    const trips = await api('GET', '/trips?scope=my');
    const current = L.currentTrip(trips);
    const running = current && current.status !== 'dispatched' ? current : null;
    const upcoming = trips.filter((t) => t !== current).sort((a, b) => (new Date(a.planned_departure) - new Date(b.planned_departure)) || (a.id - b.id));
    main.append(pageHead('My Trips', running ? null : 'Press Accept when your trip starts and Finish when you are done. The server records the time.'));
    const press = async (t, type) => {
      const label = L.BUTTON_LABELS[type];
      const text = type === 'depart' ? `Trip #${t.trip_no}: your paid time starts now. You can undo for ${UNDO_SEC} seconds.`
        : type === 'return' ? `Trip #${t.trip_no} ends now (${fmtMin(t.elapsed_min)} so far) and moves to Trip History. You can undo for ${UNDO_SEC} seconds.`
        : 'Records that the load was picked up.';
      if (!(await ask(`${label}?`, { ok: label, text }))) return;
      if (type === 'pickup_done') return act(() => api('POST', `/trips/${t.id}/events`, { type }), `${L.EVENT_LABELS[type]} at ${fmtClock(new Date())}`);
      main.querySelectorAll('button').forEach((b) => { b.disabled = true; });
      startUndo(t, type);
    };
    const metaRow = (t) => h('div', { class: 'meta' }, h('span', null, icon('truck', 'sm'), vehicleText(t)), h('span', null, '#', t.trip_no), t.team ? h('span', null, icon('users', 'sm'), withText(t)) : null,
      t.planned_hours ? h('span', null, icon('clock', 'sm'), `about ${t.planned_hours} h`) : null, t.cargo_ref ? h('span', null, icon('box', 'sm'), t.cargo_ref) : null);
    if (running) {
      const t = running;
      main.append(h('div', { class: 'card hero current-trip' },
        h('div', { class: 'spread' }, h('span', { class: 'eyebrow' }, 'Current trip'), h('span', { class: 'row gap4' }, teamChip(t), statusChip(t.status), flagChips(t))),
        h('div', { class: 'elapsed' }, h('b', null, fmtMin(t.elapsed_min)), h('span', { class: 'muted' }, `since you accepted at ${fmtClock(t.times.depart)}`)),
        metaRow(t), routeBlock(t), stepper(t),
        h('button', { class: 'btn primary big go-finish', onclick: () => press(t, 'return') }, icon('flag', 'lg'), 'Finish trip'),
        h('div', { class: 'row mt12' },
          t.status === 'in_progress' ? h('button', { class: 'btn grow', onclick: () => press(t, 'pickup_done') }, icon('box', 'sm'), 'Pickup done') : null,
          h('button', { class: 'btn ghost', onclick: () => correctionForm(t) }, icon('edit', 'sm'), 'Fix a time'))));
    } else if (current) {
      const t = current;
      const opens = new Date(t.accept_opens_at);
      const early = Date.now() < opens.getTime();
      const sameDay = opens.toDateString() === new Date().toDateString();
      const es = t.early_start;
      const approvedEarly = early && es && es.status === 'approved';
      main.append(h('div', { class: 'card hero current-trip' },
        h('div', { class: 'spread' }, h('span', { class: 'eyebrow' }, 'Current trip'), h('span', { class: 'row gap4' }, teamChip(t), statusChip(t.status))),
        h('div', { class: 'trip-no' }, fmtDate(t.planned_departure), ' · ', fmtClock(t.planned_departure)),
        metaRow(t), routeBlock(t),
        early && !approvedEarly ? [
          h('button', { class: 'btn block', disabled: true }, icon('clock', 'sm'), `Accept opens ${sameDay ? 'at ' + fmtClock(opens) : fmtTime(opens)}`),
          earlyStartBox(t, es)]
          : [approvedEarly ? h('p', { class: 'small early-note ok' }, icon('check', 'sm'), `Early start approved${es.decided_by_name ? ' by ' + es.decided_by_name : ''}. You can accept now.`) : null,
            h('button', { class: 'btn primary big', onclick: () => press(t, 'depart') }, icon('play', 'lg'), 'Accept trip')]));
    } else {
      main.append(emptyBox('No trips assigned to you right now.', 'route'));
    }
    main.append(h('h2', null, 'Upcoming', h('span', { class: 'count' }, upcoming.length)));
    if (!upcoming.length) main.append(h('p', { class: 'sub' }, 'Nothing else assigned yet.'));
    upcoming.forEach((t) => {
      main.append(h('div', { class: 'card next-card upcoming-trip' },
        h('div', { class: 'spread' }, h('div', null, h('div', { class: 'trip-no' }, fmtDate(t.planned_departure), ' · ', fmtClock(t.planned_departure))), h('span', { class: 'row gap4' }, teamChip(t), statusChip(t.status))),
        routeBlock(t), metaRow(t),
        h('button', { class: 'btn block', disabled: true }, icon('lock', 'sm'), L.FINISH_FIRST_MSG)));
    });
    main.append(h('div', { class: 'linkrow' }, h('a', { class: 'btn ghost', href: '#history' }, icon('clock', 'sm'), 'Finished trips are in Trip History')));
  }

  // Early start: Accept opens a few minutes before the planned start. To leave earlier the driver asks a manager.
  function earlyStartBox(t, es) {
    const min = me.accept_early_min != null ? me.accept_early_min : L.DEFAULT_SETTINGS.accept_early_min;
    const request = async () => {
      const reason = await ask('Ask to start early', { input: true, optional: true, ok: 'Send request',
        text: 'Your manager (Scheduler) gets the request. Once approved you can accept right away. Reason (optional):' });
      if (reason === null) return;
      act(() => api('POST', `/trips/${t.id}/early-start`, { reason: reason || null }), 'Early start request sent');
    };
    let state;
    if (es && es.status === 'pending') state = h('button', { class: 'btn block', disabled: true }, icon('clock', 'sm'), 'Early start requested · waiting for manager');
    else if (es && es.status === 'declined') state = [h('p', { class: 'small early-note bad' }, icon('x', 'sm'), `Early start declined${es.decline_reason ? ': ' + es.decline_reason : '.'}`),
      h('button', { class: 'btn block', onclick: request }, icon('play', 'sm'), 'Ask again (Early start)')];
    else state = h('button', { class: 'btn block', onclick: request }, icon('play', 'sm'), 'Early start');
    return h('div', { class: 'early-box' },
      h('p', { class: 'small muted' }, `You can accept ${min} minutes before the start time. To leave early, ask your manager.`), state);
  }

  // Accept and Finish wait 10 seconds before they are saved, so a mistaken tap can be undone.
  // The tap time is what gets recorded. Leaving the app during the 10 seconds saves it right away.
  const UNDO_SEC = 10;
  let pending = null;
  function startUndo(t, type) {
    flushPending();
    const at = new Date().toISOString();
    let left = UNDO_SEC;
    const count = h('b', null, String(left));
    const bar = h('div', { class: 'undo-bar', role: 'status' },
      h('span', { class: 'undo-ico' }, icon(type === 'return' ? 'flag' : 'play')),
      h('div', { class: 'grow' }, h('b', null, `${type === 'return' ? 'Trip finished' : 'Trip accepted'} at ${fmtClock(at)}`), h('div', { class: 'small' }, 'Saving in ', count, ' s')),
      h('button', { class: 'btn', type: 'button', onclick: undoPending }, icon('undo', 'sm'), 'Undo'));
    document.body.append(bar);
    pending = { t, type, at, bar, tick: setInterval(() => { left -= 1; count.textContent = String(Math.max(left, 0)); if (left <= 0) flushPending(); }, 1000) };
  }
  function undoPending() {
    const p = pending; if (!p) return;
    pending = null; clearInterval(p.tick); p.bar.remove();
    toast('Undone. Nothing was saved.'); route();
  }
  async function flushPending(leaving) {
    const p = pending; if (!p) return;
    pending = null; clearInterval(p.tick); p.bar.remove();
    const body = { type: p.type, at: p.at };
    if (leaving && !window.MockAPI) {
      fetch(`/api/trips/${p.t.id}/events`, { method: 'POST', keepalive: true, credentials: 'same-origin', headers: { 'Content-Type': 'application/json', 'X-CSRF-Token': csrf }, body: JSON.stringify(body) }).catch(() => {});
      return;
    }
    try { await api('POST', `/trips/${p.t.id}/events`, body); toast(`${L.EVENT_LABELS[p.type]} at ${fmtClock(p.at)}`); }
    catch (e) { toast(e.message, true); }
    route();
  }
  document.addEventListener('visibilitychange', () => { if (document.visibilityState === 'hidden') flushPending(true); });
  window.addEventListener('pagehide', () => flushPending(true));

  function correctionForm(t) {
    const type = h('select', null, L.DRIVER_EVENTS.map((k) => h('option', { value: k }, `${k === 'depart' ? 'Accept' : k === 'return' ? 'Finish' : 'Pickup Done'} (now ${fmtTime(t.times[k])})`)));
    const time = h('input', { type: 'datetime-local', required: true });
    const setDefault = () => { const v = t.times[type.value] || new Date().toISOString(); time.value = toLocalInput(v); };
    type.addEventListener('change', setDefault);
    type.value = t.times.return ? 'return' : t.times.pickup_done ? 'pickup_done' : 'depart';
    setDefault();
    const reason = h('textarea', { maxlength: 1000, placeholder: 'e.g. Helped unload and pressed Finish late.' });
    const close = modal('Request time correction', h('div', null,
      h('p', { class: 'sub' }, 'The Scheduler approves first, then Payroll gives final approval. The original record is kept.'),
      h('div', { class: 'form one-col' },
        h('label', { class: 'f' }, 'Item to correct', type),
        h('label', { class: 'f' }, 'Correct time', time),
        h('label', { class: 'f' }, 'Reason', reason),
        h('button', {
          class: 'btn primary', onclick: async () => {
            const ok = await act(() => api('POST', '/corrections', { trip_id: t.id, event_type: type.value, requested_time: new Date(time.value).toISOString(), reason: reason.value }), 'Correction request sent');
            if (ok) close();
          },
        }, 'Send request'))));
  }

  // Status tabs shared by role screens: first tab = what the role must act on, then workflow order. Counts on every tab.
  const TAB_STATE = {};
  function statusTabs(id, tabs, first) {
    if (!tabs[TAB_STATE[id]]) TAB_STATE[id] = first;
    const cur = TAB_STATE[id];
    return h('div', { class: 'seg tabs3', role: 'tablist' }, Object.entries(tabs).map(([k, [label, list]]) => h('button', {
      type: 'button', role: 'tab', class: cur === k ? 'on' : '', 'aria-selected': cur === k ? 'true' : 'false',
      onclick: () => { TAB_STATE[id] = k; route(); } }, `${label} (${list.length})`)));
  }

  // ---------- page: Dispatch ----------
  async function pageDispatch(main) {
    main.append(pageHead('Assign trips', 'New trips show up right away on the driver\'s My Trips page. The driver can press Accept from shortly before the planned departure.'));
    // Early start requests from drivers: shown here only while there is something to handle (or just handled)
    const early = await api('GET', '/early-starts').catch(() => []);
    if (early.length) {
      const open = early.filter((x) => x.status === 'pending');
      main.append(h('div', { class: 'card early-requests' },
        h('h2', null, icon('clock', 'sm'), 'Early start requests', h('span', { class: 'count' }, open.length)),
        h('p', { class: 'sub mt0' }, 'Drivers asking to accept before the accept window opens. Approve lets the driver accept right away.'),
        tripTable(early.map((x) => Object.assign({}, x, { id: x.trip_id, req_id: x.id })), [
          ['Driver', (x) => x.driver_name], ['Trip', (x) => x.trip_no], ['Planned', (x) => fmtTime(x.planned_departure)],
          ['Reason', (x) => x.reason || '–'],
          ['', (x) => x.status !== 'pending' ? h('span', { class: 'chip ' + (x.status === 'approved' ? 'ok' : 'gray') }, `${x.status === 'approved' ? 'Approved' : 'Declined'}${x.decided_by_name ? ' · ' + x.decided_by_name : ''}`)
            : can('dispatch.edit') ? h('span', { class: 'row gap4' },
              h('button', { class: 'btn small primary', onclick: (e) => { e.stopPropagation(); act(() => api('POST', `/early-starts/${x.req_id}`, { approve: true }), 'Early start approved'); } }, 'Approve'),
              h('button', { class: 'btn small', onclick: async (e) => {
                e.stopPropagation();
                const reason = await ask('Decline early start', { input: true, optional: true, ok: 'Decline', danger: true, text: 'The driver is told. Reason (optional):' });
                if (reason !== null) act(() => api('POST', `/early-starts/${x.req_id}`, { approve: false, reason: reason || null }), 'Early start declined');
              } }, 'Decline')) : h('span', { class: 'chip warn' }, 'Waiting')],
        ])));
    }
    if (can('dispatch.edit')) {
      const [drivers, saved, types] = await Promise.all([api('GET', '/drivers'), api('GET', '/addresses').catch(() => []), api('GET', '/vehicle-types').catch(() => [])]);
      const f = {
        driver_id: h('select', null, h('option', { value: '' }, 'Select'), drivers.map((d) => h('option', { value: d.id }, d.name))),
        vehicle: h('input', { placeholder: 'TRK-07', maxlength: 40 }),
        second_driver_id: h('select', null, h('option', { value: '' }, 'None (one driver)'), drivers.map((d) => h('option', { value: d.id }, d.name))),
        vehicle_type: h('select', null, h('option', { value: '' }, 'Select'), types.map((x) => h('option', { value: x.name }, x.name))),
        pickup_location: h('input', { list: 'saved-addresses', placeholder: 'Start typing, saved addresses appear', maxlength: 200, autocomplete: 'off' }),
        destination: h('input', { list: 'saved-addresses', value: 'Company Yard', maxlength: 200, autocomplete: 'off' }),
        planned_departure: h('input', { type: 'datetime-local', value: toLocalInput(Date.now() + 3600000) }),
        planned_hours: h('input', { type: 'number', min: 0, max: 48, step: 0.5, placeholder: `${L.DEFAULT_TRIP_HOURS} if blank` }),
        cargo_ref: h('input', { placeholder: 'PO-…', maxlength: 100 }),
      };
      // One button: add a new vehicle type to the list (Scheduler / Admin)
      async function addVehicleType() {
        const name = await ask('New vehicle type', { input: true, ok: 'Add', text: 'For example: 15 ton truck, Van. It is added to the list for everyone who assigns trips.' });
        if (!name) return;
        try {
          const x = await api('POST', '/vehicle-types', { name });
          f.vehicle_type.append(h('option', { value: x.name }, x.name)); f.vehicle_type.value = x.name;
          toast('Vehicle type added');
        } catch (e) { toast(e.message, true); }
      }
      // Create the trip. If a driver is already on a trip, or has another trip at an overlapping time (any scheduler's),
      // the server answers 409 and we ask before creating it anyway.
      async function createTrip() {
        const body = {
          driver_id: f.driver_id.value, second_driver_id: f.second_driver_id.value || null, vehicle_type: f.vehicle_type.value || null, vehicle: f.vehicle.value, pickup_location: f.pickup_location.value, destination: f.destination.value,
          planned_departure: f.planned_departure.value ? new Date(f.planned_departure.value).toISOString() : '',
          planned_hours: f.planned_hours.value || null, cargo_ref: f.cargo_ref.value,
        };
        if (busy) return; // ignore double taps
        let clash = null;
        busy = true;
        try { await api('POST', '/trips', body); }
        catch (e) {
          if (e.status === 409 && e.data && e.data.code === 'driver_busy') clash = e.data;
          else { toast(e.message, true); return; } // keep what was typed so it can be fixed
        } finally { busy = false; }
        if (!clash) { toast('Trip dispatched'); return route(); }
        const busyData = clash;
        const lines = busyData.conflicts.map((c) => `${c.driver_name}: trip ${c.trip_no}, ${c.status === 'dispatched' ? `assigned for ${fmtTime(c.planned_departure)} (about ${c.planned_hours == null ? L.DEFAULT_TRIP_HOURS : c.planned_hours} h)` : 'on the road now'}`);
        const ok = await ask(L.BUSY_MSG, { ok: 'Create anyway', danger: true, text: `${lines.join('. ')}. A driver can only drive one trip at a time.` });
        if (ok) act(() => api('POST', '/trips', Object.assign({}, body, { confirm: true })), 'Trip dispatched');
      }
      main.append(h('datalist', { id: 'saved-addresses' }, saved.map((a) => h('option', { value: a.address }))));
      main.append(h('div', { class: 'card form-card' }, h('h2', null, icon('plus', 'sm'), 'New trip'),
        h('p', { class: 'sub mt0 mb12' }, 'Saved addresses appear as you type. New addresses are saved automatically when you create the trip. Press Map to check one on Google Maps.'), h('div', { class: 'form two' },
        h('label', { class: 'f' }, 'Driver', f.driver_id), h('label', { class: 'f' }, 'Second driver (team, optional)', f.second_driver_id),
        h('div', { class: 'f' }, h('span', { class: 'flabel' }, 'Vehicle type'), h('div', { class: 'input-row' }, f.vehicle_type,
          h('button', { class: 'btn', type: 'button', onclick: addVehicleType }, icon('plus', 'sm'), 'Add'))),
        h('label', { class: 'f' }, 'Truck no.', f.vehicle),
        h('label', { class: 'f span2' }, 'Pickup address', h('div', { class: 'input-row' }, f.pickup_location, mapButton(f.pickup_location))),
        h('label', { class: 'f span2' }, 'Destination address', h('div', { class: 'input-row' }, f.destination, mapButton(f.destination))),
        h('label', { class: 'f' }, 'Planned start', f.planned_departure,
          h('span', { class: 'small muted hint' }, `Drivers can accept ${me.accept_early_min != null ? me.accept_early_min : L.DEFAULT_SETTINGS.accept_early_min} minutes before this time.`)),
        h('label', { class: 'f' }, 'Estimated hours (optional)', f.planned_hours),
        h('label', { class: 'f span2' }, 'PO / note (optional)', f.cargo_ref),
        h('button', { class: 'btn primary', onclick: createTrip },
          'Create trip'))));
      main.lastChild.querySelector('.form.two > button').classList.add('span2');
    }
    const trips = await api('GET', '/trips?scope=dispatch');
    const live = trips.filter((t) => t.status !== 'cancelled');
    const dtabs = {
      assigned: ['Not accepted', live.filter((t) => t.status === 'dispatched'), ''],
      road: ['On the road', live.filter((t) => ['in_progress', 'returning'].includes(t.status)), ''],
      done: ['Finished', trips.filter((t) => !['dispatched', 'in_progress', 'returning'].includes(t.status)), ''],
    };
    main.append(statusTabs('dispatch', dtabs, 'assigned'));
    main.append(tripTable(dtabs[TAB_STATE.dispatch][1], [
      ['Planned', (t) => fmtTime(t.planned_departure)], ['Trip', (t) => t.trip_no], ['Driver', whoCell],
      ['Vehicle', vehicleText], ['Route', (t) => routeOf(t)], ['Status', (t) => statusChip(t.status)],
      can('dispatch.edit') ? ['', (t) => t.status === 'dispatched' ? h('button', {
        class: 'btn small danger', onclick: async (e) => {
          e.stopPropagation();
          const reason = await ask('Reason for cancelling', { input: true, ok: 'Cancel trip' });
          if (reason) act(() => api('POST', `/trips/${t.id}/cancel`, { reason }), 'Trip cancelled');
        },
      }, 'Cancel') : null] : null,
    ]));
  }

  function tripTable(trips, cols) {
    cols = cols.filter(Boolean);
    if (!trips.length) return emptyBox('No matching trips.');
    return h('div', { class: 'table-wrap' }, h('table', null,
      h('thead', null, h('tr', null, cols.map(([k]) => h('th', null, k)))),
      h('tbody', null, trips.map((t) => h('tr', { class: 'click', onclick: (e) => { if (!e.target.closest('a')) showTrip(t.id); } }, cols.map(([, f]) => h('td', null, f(t))))))));
  }

  // ---------- page: Trip Board ----------
  async function pageBoard(main) {
    const trips = await api('GET', '/trips?scope=board');
    const by = (s) => trips.filter((t) => s.includes(t.status));
    main.append(pageHead('Live trips', 'Trucks out right now and how long they have been gone. Refreshes every minute.'),
      h('div', { class: 'grid stats' },
        statCard('On trip', by(['in_progress', 'returning']).length, 'truck'),
        statCard('Awaiting receiving', by(['returned']).length, 'box', 'warn'),
        statCard('Not accepted yet', by(['dispatched']).length, 'clock', 'gray'),
        statCard('Long trip warnings', trips.filter((t) => t.flags.includes('long')).length, 'alert', 'bad')));
    const sec = (title, list) => {
      if (!list.length) return main.append(h('p', { class: 'muted small' }, 'None right now.'));
      main.append(h('div', { class: 'grid' }, list.map((t) => {
        const memo = can('board.memo') ? h('input', { placeholder: 'Exception note (delay reason, etc.)', maxlength: 1000 }) : null;
        return h('div', { class: 'card tap', role: 'button', tabindex: '0', onclick: (e) => { if (!e.target.closest('a,input,button')) showTrip(t.id); },
          onkeydown: (e) => { if (e.key === 'Enter' && e.target === e.currentTarget) showTrip(t.id); } },
          h('div', { class: 'spread' }, h('div', null, h('div', { class: 'trip-no' }, L.teamNames(t), ' ', teamChip(t)), h('div', { class: 'muted small' }, `${vehicleText(t)} · #${t.trip_no}`)), statusChip(t.status)),
          h('p', { class: 'small' }, routeOf(t)),
          t.elapsed_min != null ? h('p', { class: 'mono' }, `Elapsed ${fmtMin(t.elapsed_min)}`, t.planned_hours ? h('span', { class: 'muted small' }, ` / planned ${t.planned_hours} h`) : null)
            : h('p', { class: 'small muted' }, `Planned start ${fmtTime(t.planned_departure)}`),
          h('div', { class: 'row' }, flagChips(t)),
          t.memos.map((m) => h('p', { class: 'small' }, h('b', null, m.author_name), ': ', m.note)),
          memo ? h('div', { class: 'row mt8' }, h('div', { class: 'grow' }, memo), h('button', { class: 'btn small', onclick: () => act(() => api('POST', `/trips/${t.id}/memos`, { note: memo.value }), 'Note saved') }, 'Save')) : null);
      })));
    };
    const btabs = {
      wait: ['Not accepted', by(['dispatched'])],
      road: ['On trip', by(['in_progress', 'returning'])],
      done: ['Awaiting receiving', by(['returned'])],
    };
    main.append(statusTabs('board', btabs, 'road'));
    sec(null, btabs[TAB_STATE.board][1]);
  }

  // ---------- page: Receiving ----------
  const fmtT = (v) => v == null ? '–' : `${Number(v).toLocaleString('en-CA', { maximumFractionDigits: 3 })} t`;
  const fmtLb = (v) => v == null ? '–' : `${Math.round(Number(v)).toLocaleString('en-CA')} lb`;
  function fishList(items) {
    if (!items || !items.length) return null;
    const total = items.reduce((a, x) => a + (L.lbOf(x) || 0), 0);
    return h('table', { class: 'fish' }, h('thead', null, h('tr', null, h('th', null, 'Fish'), h('th', null, 'Lot no.'), h('th', { class: 'num' }, 'Count'), h('th', { class: 'num' }, 'Weight'))),
      h('tbody', null, items.map((x) => h('tr', null, h('td', null, x.species), h('td', { class: 'mono' }, x.lot), h('td', { class: 'num' }, L.countText(x) || '–'), h('td', { class: 'num' }, fmtLb(L.lbOf(x))))),
        items.length > 1 ? h('tr', { class: 'total' }, h('td', null, 'Total'), h('td'), h('td'), h('td', { class: 'num' }, fmtLb(total))) : null));
  }
  function receiveForm(t) {
    const lines = h('div', { class: 'fish-lines' });
    // One line per species: quick pick of the main species (or Other), lot number, weight in lb,
    // then Case or Tote -> the count is filled in from the average weight (L.PACK_UNITS) and can be changed by hand
    const addLine = () => {
      let species = '';
      const other = h('input', { class: 'hidden', placeholder: 'Type the fish name', maxlength: 80, 'aria-label': 'Other fish name' });
      const picks = h('div', { class: 'seg seg4', role: 'radiogroup', 'aria-label': 'Fish' });
      L.MAIN_SPECIES.concat('Other').forEach((name) => picks.append(h('button', { type: 'button', role: 'radio', 'aria-checked': 'false', onclick: (e) => {
        species = name;
        picks.querySelectorAll('button').forEach((b) => { const on = b === e.currentTarget; b.classList.toggle('on', on); b.setAttribute('aria-checked', on ? 'true' : 'false'); });
        other.classList.toggle('hidden', name !== 'Other'); if (name === 'Other') other.focus();
      } }, name)));
      const lot = h('input', { placeholder: 'Lot number', maxlength: 60, 'aria-label': 'Lot number' });
      const lb = h('input', { type: 'number', inputmode: 'decimal', min: 0, max: 220000, step: 1, placeholder: '0', 'aria-label': 'Weight in lb' });
      let unit = '', byHand = false;
      const count = h('input', { type: 'number', inputmode: 'numeric', min: 1, step: 1, placeholder: 'Count', disabled: true, 'aria-label': 'Count' });
      const countUnit = h('span');
      const hint = h('p', { class: 'fish-hint small muted m0' });
      const update = () => {
        const u = L.PACK_UNITS[unit];
        const auto = L.countFromWeight(lb.value, unit);
        count.disabled = !u;
        countUnit.textContent = u ? u.plural : '';
        if (!u) { count.value = ''; byHand = false; hint.textContent = 'Pick Case or Tote to count from the weight.'; return; }
        if (!byHand) count.value = auto == null ? '' : auto;
        const basis = `weight ÷ ${u.avg_lb} lb, average ${u.basis}`;
        hint.textContent = auto == null ? `Average ${u.avg_lb} lb per ${u.basis}. Enter the weight to count.`
          : byHand && Number(count.value) !== auto ? `Changed by hand. Auto would be ${auto} (${basis}).`
          : `Auto: ${basis}, rounded. You can change it.`;
      };
      const units = h('div', { class: 'seg', role: 'radiogroup', 'aria-label': 'Case or tote' });
      Object.entries(L.PACK_UNITS).forEach(([k, u]) => units.append(h('button', { type: 'button', role: 'radio', 'aria-checked': 'false', onclick: (e) => {
        unit = unit === k ? '' : k; byHand = false;
        units.querySelectorAll('button').forEach((b) => { const on = b === e.currentTarget && unit === k; b.classList.toggle('on', on); b.setAttribute('aria-checked', on ? 'true' : 'false'); });
        update();
      } }, u.label)));
      lb.addEventListener('input', update);
      count.addEventListener('input', () => { byHand = count.value !== ''; update(); });
      const row = h('div', { class: 'fish-line' }, picks, other,
        h('div', { class: 'fish-row2' }, lot, h('div', { class: 'unit' }, lb, h('span', null, 'lb')),
          h('button', { class: 'icon-btn', type: 'button', 'aria-label': 'Remove line', onclick: () => { if (lines.children.length > 1) row.remove(); } }, icon('x'))),
        h('div', { class: 'fish-row2' }, units, h('div', { class: 'unit wide' }, count, countUnit), h('span')),
        hint);
      update();
      row.read = () => ({ species: species === 'Other' ? other.value.trim() : species, lot: lot.value.trim(), lb: lb.value, unit: unit || null, count: unit ? count.value : null });
      lines.append(row);
    };
    const at = h('input', { type: 'datetime-local', value: toLocalInput(Date.now()) });
    const note = h('input', { placeholder: 'What was wrong? (damage, shortage, temperature)', maxlength: 1000 });
    const issueWrap = h('label', { class: 'f hidden' }, 'Issue details', note);
    let result = 'ok';
    const seg = h('div', { class: 'seg', role: 'radiogroup', 'aria-label': 'Condition' });
    [['ok', 'All good'], ['issue', 'Problem']].forEach(([v, l]) => seg.append(h('button', {
      type: 'button', role: 'radio', 'aria-checked': v === 'ok' ? 'true' : 'false', class: v === 'ok' ? 'on' : '',
      onclick: (e) => { result = v; seg.querySelectorAll('button').forEach((b) => { b.classList.toggle('on', b === e.currentTarget); b.setAttribute('aria-checked', b === e.currentTarget ? 'true' : 'false'); }); issueWrap.classList.toggle('hidden', v !== 'issue'); },
    }, l)));
    const close = modal(`Receive · ${L.teamNames(t)}`, h('div', null,
      h('div', { class: 'meta' }, h('span', null, icon('truck', 'sm'), vehicleText(t)), h('span', null, '#', t.trip_no), t.cargo_ref ? h('span', null, icon('box', 'sm'), t.cargo_ref) : null),
      routeBlock(t),
      h('div', { class: 'form one-col' },
        h('div', { class: 'f' }, h('span', { class: 'flabel' }, 'Fish, lot number and weight'), lines,
          h('button', { class: 'btn ghost small', type: 'button', onclick: addLine }, icon('plus', 'sm'), 'Add another fish')),
        h('label', { class: 'f' }, 'Received at', at),
        h('div', { class: 'f' }, h('span', { class: 'flabel' }, 'Condition'), seg),
        issueWrap,
        h('button', { class: 'btn primary big', onclick: async () => {
          const items = [...lines.querySelectorAll('.fish-line')].map((r) => r.read()).filter((x) => x.species || x.lot || x.lb);
          const ok = await act(() => api('POST', `/trips/${t.id}/receipt`, { result, note: note.value, items, received_at: at.value ? new Date(at.value).toISOString() : '' }), 'Receipt saved');
          if (ok) close();
        } }, icon('check', 'lg'), 'Confirm receipt'))));
    addLine();
  }
  async function pageReceipt(main) {
    const trips = await api('GET', '/trips?scope=receipt');
    const edit = can('receipt.edit');
    main.append(pageHead('Receiving', edit ? 'Tap a finished truck to record the fish, lot numbers, weight, cases or totes and the time you received it.' : 'Trucks on the road and recently received. Receiving opens after the driver taps Finish.'));
    // A truck can be received only after the driver finished it. Trucks still on the road are view-only.
    const card = (t, tab) => {
      const done = tab === 'done', ready = tab === 'ready' && edit;
      return h('div', { class: 'card recv' + (ready ? ' tap' : ''), role: ready ? 'button' : null, tabindex: ready ? '0' : null,
        onclick: (e) => { if (ready && !e.target.closest('a')) receiveForm(t); },
        onkeydown: (e) => { if (ready && (e.key === 'Enter' || e.key === ' ')) { e.preventDefault(); receiveForm(t); } } },
        h('div', { class: 'spread' }, h('div', null, h('div', { class: 'trip-no' }, L.teamNames(t), ' ', teamChip(t)), h('div', { class: 'muted small' }, `${vehicleText(t)} · #${t.trip_no}`)), done ? h('span', { class: 'chip ok' }, 'Received') : statusChip(t.status)),
        h('p', { class: 'small' }, routeOf(t)),
        done ? [h('div', { class: 'small muted' }, `Received ${fmtTime(t.times.receipt)}`, t.receipt && t.receipt.result === 'issue' ? h('span', { class: 'chip bad' }, 'Problem') : null), fishList(t.receipt && t.receipt.items),
          t.receipt && t.receipt.note ? h('p', { class: 'small' }, t.receipt.note) : null]
          : h('div', { class: 'spread mt8' }, h('span', { class: 'small muted' }, tab === 'ready' ? `Driver finished ${fmtTime(t.times.return)}` : `On the road ${fmtMin(t.elapsed_min)}`),
            ready ? h('span', { class: 'btn small primary' }, 'Receive') : null));
    };
    const isDone = (t) => t.status === 'received' || !!t.receipt;
    const tabs = {
      ready: ['Ready to receive', trips.filter((t) => !isDone(t) && t.status === 'returned'), 'No finished trucks waiting.'],
      road: ['On the road', trips.filter((t) => !isDone(t) && t.status !== 'returned'), 'No trucks on the road.'],
      done: ['Received', trips.filter(isDone), 'Nothing received in the last 3 days.'],
    };
    main.append(statusTabs('receipt', tabs, 'ready'));
    const cur = TAB_STATE.receipt;
    const [, list, emptyText] = tabs[cur];
    if (cur === 'road') main.append(h('p', { class: 'muted small' }, 'These trucks are still driving. You can receive them once the driver taps Finish.'));
    main.append(list.length ? h('div', { class: 'grid' }, list.map((t) => card(t, cur))) : h('p', { class: 'muted small' }, emptyText));
    main.append(receiptSearch());
  }

  // Find received fish by lot number (also by fish and received date)
  const RS = { lot: '', fish: '', from: '', to: '' };
  function receiptSearch() {
    const lot = h('input', { placeholder: 'Lot number, e.g. LOT-24-1187', value: RS.lot, 'aria-label': 'Lot number' });
    const fish = h('select', { 'aria-label': 'Fish' }, [['', 'All fish']].concat(L.MAIN_SPECIES.map((x) => [x, x]), [['Other', 'Other']]).map(([v, l]) => h('option', { value: v }, l)));
    fish.value = RS.fish;
    const from = h('input', { type: 'date', value: RS.from, 'aria-label': 'Received from' });
    const to = h('input', { type: 'date', value: RS.to, 'aria-label': 'Received to' });
    const out = h('div');
    let seq = 0;
    const run = async () => {
      Object.assign(RS, { lot: lot.value.trim(), fish: fish.value, from: from.value, to: to.value });
      const qs = new URLSearchParams();
      if (RS.lot) qs.set('lot', RS.lot); if (RS.fish) qs.set('fish', RS.fish);
      if (RS.from) qs.set('from', new Date(RS.from + 'T00:00').toISOString());
      if (RS.to) qs.set('to', new Date(+new Date(RS.to + 'T00:00') + 864e5).toISOString());
      if (![...qs.keys()].length) return out.replaceChildren(h('p', { class: 'small muted m0' }, 'Type a lot number, or pick a fish or dates.'));
      const mine = ++seq;
      let rows; try { rows = await api('GET', `/receipts?${qs}`); } catch (e) { return toast(e.message, true); }
      if (mine !== seq) return;
      const lbs = rows.reduce((x, r) => x + (Number(r.lb) || 0), 0);
      out.replaceChildren(rows.length ? h('div', { class: 'table-wrap' }, h('table', null,
        h('thead', null, h('tr', null, ['Received', 'Lot', 'Fish', 'Count', 'Weight', 'Truck / trip', 'Driver', ''].map((x, i) => h('th', { class: i === 3 || i === 4 ? 'num' : null }, x)))),
        h('tbody', null, rows.map((r) => h('tr', { class: 'click', onclick: () => showTrip(r.trip_id) },
          h('td', { class: 'small' }, fmtTime(r.received_at)), h('td', null, h('b', null, r.lot)), h('td', null, r.species),
          h('td', { class: 'num' }, L.countText(r) || '–'), h('td', { class: 'num' }, fmtLb(L.lbOf(r))), h('td', { class: 'small' }, `${[r.vehicle_type, r.vehicle].filter(Boolean).join(' · ')} · #${r.trip_no}`), h('td', null, r.driver_name, r.team ? [' ', h('span', { class: 'chip info' }, 'Team')] : null),
          h('td', null, r.result === 'issue' ? h('span', { class: 'chip bad' }, 'Problem') : null)))),
        h('tfoot', null, h('tr', null, h('td', { colspan: 4 }, `${rows.length} line${rows.length === 1 ? '' : 's'}`), h('td', { class: 'num' }, h('b', null, fmtLb(lbs))), h('td', { colspan: 3 })))))
        : h('p', { class: 'small muted m0' }, 'Nothing received matches.'));
    };
    let timer;
    lot.addEventListener('input', () => { clearTimeout(timer); timer = setTimeout(run, 300); });
    [fish, from, to].forEach((el) => el.addEventListener('change', run));
    run();
    return h('section', { class: 'card' }, h('h2', { class: 'm0' }, icon('list', 'sm'), ' Find received fish'),
      h('div', { class: 'filter-grid my10' }, h('label', { class: 'search' }, icon('list', 'sm'), lot), fish, from, to), out);
  }

  // ---------- page: Corrections ----------
  async function pageCorrections(main) {
    const list = await api('GET', '/corrections');
    const ST = { pending: ['Awaiting Scheduler', 'warn', 1], first_approved: ['Awaiting Payroll', 'warn', 2], approved: ['Applied', 'ok', 3], rejected: ['Rejected', 'bad', 3] };
    main.append(pageHead('Time corrections', 'Driver requests, Scheduler approves first, Payroll gives final approval. One person cannot do both approval steps.'));
    if (!list.length) main.append(emptyBox('No correction requests.', 'edit'));
    list.forEach((c) => {
      const [label, cls, step] = ST[c.status];
      const reject = async (stage) => { const r = await ask('Reason for rejecting', { input: true, ok: 'Reject' }); if (r) act(() => api('POST', `/corrections/${c.id}/${stage}`, { approve: false, reason: r }), 'Rejected'); };
      const mine = c.requested_by === me.user.id;
      main.append(h('div', { class: 'card' },
        h('div', { class: 'spread' }, h('div', null, h('b', null, `${c.trip_no} · ${L.EVENT_LABELS[c.event_type]}`), ' ', h('span', { class: 'chip ' + cls }, label)), h('span', { class: 'muted small' }, c.driver_name)),
        h('div', { class: 'steps', 'aria-hidden': 'true' }, [1, 2, 3].map((i) => h('span', { class: i <= step && c.status !== 'rejected' ? 'on' : '' }))),
        h('dl', { class: 'kv' },
          h('dt', null, 'Original'), h('dd', { class: 'mono' }, fmtTime(c.original_time)),
          h('dt', null, 'Requested'), h('dd', { class: 'mono' }, h('b', null, fmtTime(c.requested_time))),
          h('dt', null, 'Reason'), h('dd', null, c.reason),
          c.first_by_name ? [h('dt', null, 'Scheduler'), h('dd', null, `${c.first_by_name} · ${fmtTime(c.first_at)}`)] : null,
          c.final_by_name ? [h('dt', null, 'Payroll'), h('dd', null, `${c.final_by_name} · ${fmtTime(c.final_at)}`)] : null,
          c.reject_reason ? [h('dt', null, 'Rejection reason'), h('dd', null, c.reject_reason)] : null),
        h('div', { class: 'row' },
          h('button', { class: 'btn small', onclick: () => showTrip(c.trip_id) }, 'View trip'),
          c.status === 'pending' && can('correction.first') && !mine ? [
            h('button', { class: 'btn small primary', onclick: () => act(() => api('POST', `/corrections/${c.id}/first`, { approve: true }), 'Approved (step 1)') }, 'Approve'),
            h('button', { class: 'btn small danger', onclick: () => reject('first') }, 'Reject')] : null,
          c.status === 'first_approved' && can('correction.final') && !mine ? [
            h('button', { class: 'btn small primary', onclick: () => act(() => api('POST', `/corrections/${c.id}/final`, { approve: true }), 'Final approval given, record updated') }, 'Final approve'),
            h('button', { class: 'btn small danger', onclick: () => reject('final') }, 'Reject')] : null)));
    });
  }

  // ---------- page: Trip History ----------
  function periodFilter(onChange, withDriver) {
    const today = new Date();
    const from = h('input', { type: 'date', value: new Date(today - 30 * 864e5).toISOString().slice(0, 10) });
    const to = h('input', { type: 'date', value: new Date(+today + 864e5).toISOString().slice(0, 10) });
    const drv = h('select', null, h('option', { value: '' }, 'All'));
    if (withDriver) api('GET', '/drivers').then((ds) => ds.forEach((d) => drv.append(h('option', { value: d.id }, d.name)))).catch(() => {});
    const q = () => {
      const p = new URLSearchParams();
      if (from.value) p.set('from', new Date(from.value + 'T00:00').toISOString());
      if (to.value) p.set('to', new Date(to.value + 'T00:00').toISOString());
      if (drv.value) p.set('driver_id', drv.value);
      return p.toString();
    };
    // Filters apply as soon as they change (no Search button)
    [from, to, drv].forEach((x) => x.addEventListener('change', () => onChange(q())));
    const el = h('div', { class: 'card' }, h('div', { class: 'form' },
      h('label', { class: 'f' }, 'From', from), h('label', { class: 'f' }, 'To (exclusive)', to),
      withDriver ? h('label', { class: 'f' }, 'Driver', drv) : null));
    return { el, q };
  }

  async function pageHistory(main) {
    const all = can('history.all');
    main.append(pageHead('Trip History', all ? 'Every trip on record. Tap a row to see its full event history.' : 'Your finished and past trips. Tap a row for details.'));
    const out = h('div');
    // Lot numbers recorded in Receiving, shown compactly: first lot (+ count of the others), fish underneath
    const lotsOf = (t) => ((t.receipt && t.receipt.items) || []).filter((x) => x.lot || x.species);
    const lotCell = (t) => {
      const it = lotsOf(t);
      if (!it.length) return h('span', { class: 'muted' }, '–');
      const fish = [...new Set(it.map((x) => x.species).filter(Boolean))];
      return h('div', { class: 'lotcell', title: it.map((x) => [x.lot, x.species].filter(Boolean).join(' · ')).join('\n') },
        h('div', null, h('span', { class: 'mono' }, it[0].lot || '–'), it.length > 1 ? h('span', { class: 'chip-more' }, `+${it.length - 1}`) : null),
        fish.length ? h('div', { class: 'small muted' }, fish.length > 1 ? `${fish[0]} +${fish.length - 1}` : fish[0]) : null);
    };
    let trips = [];
    const search = h('input', { type: 'search', placeholder: 'Find a lot number or fish', 'aria-label': 'Find a lot number or fish', maxlength: 60 });
    const draw = () => {
      const k = search.value.trim().toLowerCase();
      const list = !k ? trips : trips.filter((t) => lotsOf(t).some((x) => `${x.lot || ''} ${x.species || ''}`.toLowerCase().includes(k)));
      out.replaceChildren(tripTable(list, [
        ['Date', (t) => fmtDate(t.planned_departure)], ['Trip', (t) => t.trip_no], all ? ['Driver', (t) => h('span', null, L.teamNames(t), ' ', teamChip(t))] : null,
        ['Route', (t) => routeOf(t)], all ? ['Lot no.', lotCell] : null, ['Accepted', (t) => fmtTime(t.times.depart)], ['Finished', (t) => fmtTime(t.times.return)],
        ['Recorded', (t) => fmtMin(t.pay.recorded)], ['Status', (t) => [statusChip(t.status), ' ', flagChips(t)]],
      ]));
    };
    const load = async (qs) => { trips = await api('GET', `/trips?scope=history&${qs}`); draw(); };
    search.addEventListener('input', draw);
    const f = periodFilter((qs) => load(qs).catch((e) => toast(e.message, true)), all);
    if (all) f.el.append(h('div', { class: 'search', style: 'margin-top:10px' }, icon('search', 'sm'), search));
    main.append(f.el, out);
    await load(f.q());
  }

  // ---------- page: Pay ----------
  // Payroll flow: pick a period -> each driver shows trips, hours x rate = amount -> tick trips -> Approve.
  function periodPicker(onChange) {
    const day = (d) => d.toISOString().slice(0, 10);
    const startOfWeek = (d) => { const x = new Date(d); x.setHours(0, 0, 0, 0); x.setDate(x.getDate() - ((x.getDay() + 6) % 7)); return x; };
    const presets = {
      'This week': () => { const a = startOfWeek(new Date()); return [a, new Date(+a + 7 * 864e5)]; },
      'Last week': () => { const b = startOfWeek(new Date()); return [new Date(+b - 7 * 864e5), b]; },
      'This month': () => { const n = new Date(); return [new Date(n.getFullYear(), n.getMonth(), 1), new Date(n.getFullYear(), n.getMonth() + 1, 1)]; },
      'Last 30 days': () => { const n = new Date(); n.setHours(0, 0, 0, 0); return [new Date(+n - 29 * 864e5), new Date(+n + 864e5)]; },
    };
    const from = h('input', { type: 'date', 'aria-label': 'From' });
    const to = h('input', { type: 'date', 'aria-label': 'To' });
    let range = presets['Last 30 days']();
    const seg = h('div', { class: 'seg seg4 period', role: 'radiogroup', 'aria-label': 'Period' });
    const fire = () => onChange(range);
    Object.entries(presets).forEach(([name, fn]) => seg.append(h('button', { type: 'button', role: 'radio', class: name === 'Last 30 days' ? 'on' : '', 'aria-checked': name === 'Last 30 days' ? 'true' : 'false', onclick: (e) => {
      range = fn(); from.value = day(range[0]); to.value = day(new Date(+range[1] - 864e5));
      seg.querySelectorAll('button').forEach((b) => { const on = b === e.currentTarget; b.classList.toggle('on', on); b.setAttribute('aria-checked', on ? 'true' : 'false'); });
      fire();
    } }, name)));
    from.value = day(range[0]); to.value = day(new Date(+range[1] - 864e5));
    const custom = () => {
      if (!from.value || !to.value) return;
      seg.querySelectorAll('button').forEach((b) => { b.classList.remove('on'); b.setAttribute('aria-checked', 'false'); });
      range = [new Date(from.value + 'T00:00'), new Date(+new Date(to.value + 'T00:00') + 864e5)]; fire();
    };
    from.addEventListener('change', custom); to.addEventListener('change', custom);
    return { seg, dates: h('div', { class: 'row dates' }, from, h('span', { class: 'muted' }, 'to'), to), get: () => range };
  }

  const PAY_STATE = { driver: '', tab: 'todo' };
  // Pay: only the status of each trip and the buttons needed. Driver pay options live on the Drivers pay setting page.
  async function pagePay(main) {
    const payroll = can('pay.approve');
    const all = payroll || can('pay.view');
    main.append(pageHead(all ? 'Pay' : 'My Pay', all
      ? 'Approve finished trips, then see what is paid. Each driver\'s rate and BC options are on the Drivers pay setting page.'
      : 'Your finished trips and pay. Paid time = Accept to Finish, minus the meal break on trips over 5 hours.'));
    const pp = periodPicker(() => load());
    let drivers = [];
    let picked = PAY_STATE.driver;
    const pills = h('div', { class: 'pills', role: 'radiogroup', 'aria-label': 'Driver' });
    const drawPills = () => pills.replaceChildren(...[{ id: '', name: 'All drivers' }].concat(drivers).map((d) => h('button', {
      type: 'button', role: 'radio', class: 'pill' + (String(d.id) === String(picked) ? ' on' : ''), 'aria-checked': String(d.id) === String(picked) ? 'true' : 'false',
      onclick: () => { picked = PAY_STATE.driver = d.id; drawPills(); load(); },
    }, d.id ? h('span', { class: 'avatar xs' }, initials(d.name)) : icon('users', 'sm'), d.name)));
    if (all) {
      try { drivers = await api('GET', '/pay/drivers'); } catch (e) { drivers = []; }
      drawPills();
    }
    main.append(h('div', { class: 'card filters' }, all ? pills : null, pp.seg, h('div', { class: 'row' }, pp.dates)));
    const out = h('div');
    main.append(out);
    let seq = 0; let data = null;
    async function load() {
      const mine = ++seq;
      const [a, b] = pp.get();
      const qs = new URLSearchParams({ from: a.toISOString(), to: b.toISOString() });
      if (picked) qs.set('driver_id', picked);
      let d;
      try { d = await api('GET', `/pay?${qs}`); } catch (e) { return toast(e.message, true); }
      if (mine !== seq) return; // a newer filter is already loading
      data = d; render();
    }
    const sum = (list, f) => list.reduce((x, t) => x + (Number(f(t)) || 0), 0);
    const ready = (t) => !t.pay.approved && ['returned', 'received'].includes(t.status) && !t.pending_corrections && t.pay.amount != null && t.pay.recorded > 0;
    // Trips the driver has not finished yet: listed so Payroll sees why they cannot be approved. Tapping one shows an alert.
    function waitingBox() {
      const w = payroll && PAY_STATE.tab === 'todo' ? (data.waiting || []) : [];
      if (!w.length) return null;
      return h('section', { class: 'card paycard' },
        h('div', { class: 'notice warn' }, icon('alert', 'sm'), ` ${w.length} trip${w.length === 1 ? ' is' : 's are'} not finished by the driver yet. Pay can be approved only after the driver taps Finish.`),
        h('div', { class: 'paylist' }, w.map((t) => h('div', { class: 'payrow' }, h('input', { type: 'checkbox', class: 'check', disabled: true, 'aria-label': 'Not finished' }),
          h('button', { class: 'payinfo', type: 'button', onclick: () => toast(`${t.driver_name} · #${t.trip_no}: ${L.NOT_FINISHED_MSG}`, true) },
            h('span', { class: 'pd' }, h('b', null, fmtDate(t.planned_departure)), h('span', { class: 'small muted' }, ` · ${t.driver_name} · #${t.trip_no}`), t.team ? [' ', teamChip(t)] : null),
            h('span', { class: 'small muted' }, `${t.pickup_location} → ${t.destination}`)),
          h('div', { class: 'paystate' }, statusChip(t.status), h('span', { class: 'chip warn' }, 'Driver has not finished'))))));
    }
    function render() {
      // One list of pay lines: trips + stat holidays the driver did not work
      const items = data.trips.map((t) => ({ kind: 'trip', t, date: t.planned_departure, amount: t.pay.amount, approved: t.pay.approved, paid: t.status === 'paid' || !!t.pay.paid_at }))
        .concat((data.holidays || []).map((x) => ({ kind: 'holiday', x, date: x.date + 'T12:00:00', amount: x.amount, approved: x.approved, paid: !!x.paid_at })));
      items.sort((a, b) => new Date(b.date) - new Date(a.date));
      const tabs = {
        todo: ['To approve', items.filter((i) => !i.approved)],
        unpaid: ['Approved · unpaid', items.filter((i) => i.approved && !i.paid)],
        paid: ['Paid', items.filter((i) => i.paid)],
      };
      const seg = h('div', { class: 'seg tabs3', role: 'tablist' }, Object.entries(tabs).map(([k, [label, list]]) => h('button', {
        type: 'button', role: 'tab', class: PAY_STATE.tab === k ? 'on' : '', 'aria-selected': PAY_STATE.tab === k ? 'true' : 'false',
        onclick: () => { PAY_STATE.tab = k; render(); } }, `${label} (${list.length})`)));
      const list = tabs[PAY_STATE.tab][1];
      const chosen = new Set();
      if (payroll && PAY_STATE.tab === 'todo') list.forEach((i) => { if (i.kind === 'trip' ? ready(i.t) && !i.t.pay.checks.some((c) => c.tone === 'bad') : i.x.eligible) chosen.add(i); });
      const approveBtn = h('button', { class: 'btn primary' });
      const total = h('b', { class: 'mono' });
      const update = () => {
        const sel = [...chosen];
        approveBtn.replaceChildren(icon('check', 'sm'), `Approve ${sel.length} · ${money(sum(sel, (i) => i.amount))}`);
        approveBtn.disabled = !sel.length;
        total.textContent = money(sum(list, (i) => i.amount));
      };
      approveBtn.addEventListener('click', async () => {
        const sel = [...chosen];
        if (!sel.length || !(await ask(`Approve ${sel.length} pay line${sel.length === 1 ? '' : 's'}?`, { ok: 'Approve', text: `Total ${money(sum(sel, (i) => i.amount))}. Approved pay is locked and goes to Accounting for payment.` }))) return;
        await act(async () => {
          for (const i of sel) {
            if (i.kind === 'trip') await api('POST', `/pay/${i.t.id}/approve`, {});
            else await api('POST', '/pay/holiday/approve', { driver_id: i.x.driver_id, date: i.x.date });
          }
        }, `${sel.length} approved`);
      });
      update();
      const row = (i) => {
        const box = payroll && PAY_STATE.tab === 'todo' ? h('input', { type: 'checkbox', class: 'check', 'aria-label': 'Select', checked: chosen.has(i) || null,
          disabled: (i.kind === 'trip' && !ready(i.t)) || null, onchange: (e) => { if (e.target.checked) chosen.add(i); else chosen.delete(i); update(); } }) : h('span');
        const state = i.paid ? h('span', { class: 'chip ok' }, 'Paid') : i.approved ? h('span', { class: 'chip info' }, 'Approved · unpaid') : null;
        if (i.kind === 'holiday') {
          const x = i.x;
          return h('div', { class: 'payrow' }, box,
            h('div', { class: 'payinfo' }, h('span', { class: 'pd' }, h('b', null, fmtDate(i.date)), h('span', { class: 'small muted' }, ` · ${x.driver_name}`)),
              h('span', { class: 'small muted' }, `${x.name} (not worked): average day's pay`)),
            h('div', { class: 'payamt' }, h('b', { class: 'mono' }, money(x.amount)), h('span', { class: 'small muted' }, `${x.days_worked} days worked in 30 before`)),
            h('div', { class: 'paystate' }, state || h('span', { class: 'chip info' }, 'Stat holiday'),
              !x.approved && !x.eligible ? h('span', { class: 'chip warn' }, `Not eligible? Needs ${data.rules.stat_eligible_days} days`) : null));
        }
        const t = i.t;
        const chips = (t.pay.checks || []).map((c) => h('span', { class: 'chip ' + c.tone }, c.text));
        const why = t.pending_corrections ? h('span', { class: 'chip warn' }, 'Correction open') : !t.pay.approved && !ready(t) ? statusChip(t.status) : null;
        return h('div', { class: 'payrow' }, box,
          h('button', { class: 'payinfo', type: 'button', onclick: () => (payroll && ready(t) ? approveForm(t) : showTrip(t.id)) },
            h('span', { class: 'pd' }, h('b', null, fmtDate(t.planned_departure)), h('span', { class: 'small muted' }, ` · ${t.driver_name} · #${t.trip_no}`), t.team ? [' ', teamChip(t), h('span', { class: 'small muted' }, ` ${withText(t)}`)] : null),
            h('span', { class: 'small muted mono' }, `${fmtClock(t.times.depart)} → ${fmtClock(t.times.return)}`)),
          h('div', { class: 'payamt' }, h('b', { class: 'mono' }, money(t.pay.amount)),
            h('span', { class: 'small muted mono' }, `${fmtMin((t.pay.recognized || 0) + (t.pay.callin || 0))}${t.pay.ot ? ` · ${fmtMin(t.pay.ot)} OT` : ''}`)),
          h('div', { class: 'paystate' }, state, why, ...chips, ...flagChips(t).filter(Boolean).filter((c) => !/correction/.test(c.textContent))));
      };
      out.replaceChildren(
        h('div', { class: 'my10' }, seg),
        list.length ? h('section', { class: 'card paycard' },
          h('div', { class: 'paylist' }, list.map(row)),
          h('div', { class: 'payfoot' },
            h('div', { class: 'tot' }, h('span', { class: 'muted small' }, 'Total'), total),
            payroll && PAY_STATE.tab === 'todo' ? approveBtn : null))
          : emptyBox(PAY_STATE.tab === 'todo' ? 'Nothing waiting for approval in this period.' : 'Nothing here in this period.', 'dollar'),
        waitingBox(),
        h('p', { class: 'small muted' }, icon('alert', 'sm'), ' Amounts are before tax, CPP and EI. Your payroll provider or accounting handles deductions.'));
    }
    await load();
  }

  function approveForm(t) {
    const mins = h('input', { type: 'number', min: 0, max: 2880, value: t.pay.recognized });
    const reason = h('input', { placeholder: 'Required if you change paid minutes', maxlength: 500 });
    const due = t.pay.meal_due || 0;
    let mealPaid = !!t.pay.meal_paid;
    const mealBox = due ? h('label', { class: 'checkline' }, h('input', { type: 'checkbox', class: 'check', checked: mealPaid || null, onchange: (e) => {
      mealPaid = e.target.checked; mins.value = Number(mins.value) + (mealPaid ? due : -due);
    } }), `Break paid: the driver had to stay on call during the ${due}-min meal break (no deduction)`) : null;
    const close = modal(`Approve pay · ${t.trip_no}`, h('div', null,
      h('p', { class: 'sub mt0' }, `${t.driver_name}${t.team ? ' (' + withText(t) + ')' : ''} · ${fmtDate(t.planned_departure)} · ${t.pickup_location} → ${t.destination}`),
      t.team ? h('p', { class: 'small muted' }, 'Team trip: each driver is paid for their own Accept → Finish time. This approval covers only this driver.') : null,
      payLine(t),
      (t.pay.checks || []).length ? h('div', { class: 'row gap4 wrap my10' }, t.pay.checks.map((c) => h('span', { class: 'chip ' + c.tone }, c.text))) : null,
      t.flags.length ? h('div', { class: 'notice' }, 'This trip has warning flags. Check the notes and the receiving record.') : null,
      h('div', { class: 'form one-col' },
        mealBox,
        h('label', { class: 'f' }, 'Paid minutes', mins), h('label', { class: 'f' }, 'Adjustment reason', reason),
        h('p', { class: 'small muted' }, 'Approving locks this trip. Its time and amount can no longer change.'),
        h('button', { class: 'btn primary', onclick: async () => {
          const base = t.pay.recognized + (mealPaid === !!t.pay.meal_paid ? 0 : mealPaid ? due : -due);
          const body = { meal_paid: mealPaid };
          if (Number(mins.value) !== base) Object.assign(body, { recognized_minutes: mins.value, reason: reason.value });
          const ok = await act(() => api('POST', `/pay/${t.id}/approve`, body), 'Pay approved'); if (ok) close();
        } }, 'Approve'))));
  }

  // ---------- page: Drivers (Payroll) ----------
  // Each driver's pay options, and the company pay rules (BC defaults that payroll can change).
  async function pageDrivers(main) {
    const edit = can('pay.approve');
    const [drivers, R] = await Promise.all([api('GET', '/pay/drivers'), api('GET', '/pay/rules')]);
    const rules = R.rules;
    const ot = L.otRules(rules);
    main.append(pageHead('Drivers pay setting', 'Set each driver\'s pay once. Tap a driver to change it. Changes never affect pay that is already approved.'));
    const rateText = (d) => (d.hourly_rate != null ? `${money(d.hourly_rate)}/h` : rules.hourly_rate != null ? `${money(rules.hourly_rate)}/h (company)` : 'Not set');
    const low = (d) => { const v = d.hourly_rate != null ? d.hourly_rate : rules.hourly_rate; return v != null && v < rules.min_wage; };
    main.append(drivers.length ? h('div', { class: 'table-wrap' }, h('table', null,
      h('thead', null, h('tr', null, ['Driver', 'Hourly rate', 'Overtime', 'Vacation', 'Options', ''].map((x) => h('th', null, x)))),
      h('tbody', null, drivers.map((d) => h('tr', { class: 'click', onclick: () => driverForm(d) },
        h('td', null, h('div', { class: 'row' }, h('span', { class: 'avatar xs' }, initials(d.name)), h('b', null, d.name))),
        h('td', null, rateText(d), low(d) ? h('div', { class: 'small warn-text' }, 'Below minimum wage') : null),
        h('td', null, d.profile.ot_rule === 'none' ? 'None' : ot[d.profile.ot_rule].label),
        h('td', null, d.profile.vacation_pct ? `${d.profile.vacation_pct}%` : 'None'),
        h('td', null, h('div', { class: 'row gap4 wrap' },
          d.profile.stat_pay ? h('span', { class: 'chip info' }, 'Stat holiday pay') : h('span', { class: 'chip gray' }, 'No stat pay'),
          d.profile.callin ? h('span', { class: 'chip info' }, 'Minimum pay') : null,
          d.profile.meal_paid ? h('span', { class: 'chip warn' }, 'Break paid') : null)),
        h('td', null, edit ? h('button', { class: 'btn small' }, icon('edit', 'sm'), 'Edit') : null)))))) : emptyBox('No active drivers yet. Add them on the Users page.', 'users'));

    function driverForm(d) {
      const prof = Object.assign({}, d.profile);
      const dis = !edit || null;
      const rate = h('input', { type: 'number', min: 0, max: 1000, step: 0.01, value: d.hourly_rate == null ? '' : d.hourly_rate, disabled: dis,
        placeholder: rules.hourly_rate == null ? 'Not set' : `Company ${money(rules.hourly_rate)}` });
      const meal = h('input', { type: 'number', min: 0, max: 240, value: prof.meal_min == null ? '' : prof.meal_min, disabled: dis, placeholder: `Company ${rules.meal_min} min` });
      const wageWarn = h('div', { class: 'small warn-text' });
      const checkWage = () => { const v = rate.value === '' ? rules.hourly_rate : Number(rate.value); wageWarn.textContent = v != null && v < rules.min_wage ? `Below the minimum wage (${money(rules.min_wage)}/h). Pay cannot be approved.` : ''; };
      rate.addEventListener('input', checkWage); checkWage();
      const hint = h('div', { class: 'small muted' });
      const seg = (key, options, onPick) => {
        const el = h('div', { class: 'seg tabs3', role: 'radiogroup' });
        const draw = () => el.replaceChildren(...options.map(([v, label]) => h('button', {
          type: 'button', role: 'radio', class: prof[key] === v ? 'on' : '', 'aria-checked': prof[key] === v ? 'true' : 'false', disabled: dis,
          onclick: () => { prof[key] = v; draw(); if (onPick) onPick(); } }, label)));
        draw(); return el;
      };
      const showHint = () => { hint.textContent = ot[prof.ot_rule].hint; };
      const otSeg = seg('ot_rule', [['none', 'None'], ['short_haul', 'Short haul'], ['long_haul', 'Long haul']], showHint); showHint();
      const vac = seg('vacation_pct', [[0, 'None'], [4, '4%'], [6, '6%']]);
      const tick = (key, label, help) => h('label', { class: 'checkline' }, h('input', { type: 'checkbox', class: 'check', checked: prof[key] || null, disabled: dis,
        onchange: (e) => { prof[key] = e.target.checked; } }), h('span', null, h('b', null, label), h('span', { class: 'small muted block' }, help)));
      const close = modal(`${d.name} · pay`, h('div', null,
        h('div', { class: 'ps-grid' },
          h('label', { class: 'f' }, 'Hourly rate (CAD)', rate, h('span', { class: 'small muted' }, 'Empty = company rate'), wageWarn),
          h('label', { class: 'f' }, 'Meal break (min)', meal, h('span', { class: 'small muted' }, 'Empty = company setting'))),
        h('div', { class: 'f my10' }, h('b', null, 'Overtime'), otSeg, hint),
        h('div', { class: 'f my10' }, h('b', null, 'Vacation pay'), vac, h('span', { class: 'small muted' }, 'BC: 4%, or 6% after 5 years. Added to each pay line.')),
        h('div', { class: 'checks my10' },
          tick('stat_pay', 'Stat holiday pay', `Worked on a holiday: ${rules.stat_mult}× (${rules.stat_double_mult}× after ${rules.stat_double_after_h} h). Not worked: average day's pay.`),
          tick('callin', 'Minimum daily pay', `At least ${rules.callin_h} h pay a day (${rules.callin_long_h} h when scheduled over ${rules.callin_long_after_h} h).`),
          tick('meal_paid', 'Meal break is paid', 'Use when this driver usually stays on call during the break. You can also tick it per trip when approving.')),
        edit ? h('div', { class: 'actions' }, h('button', { class: 'btn', onclick: () => close() }, 'Cancel'),
          h('button', { class: 'btn primary', onclick: async () => {
            const ok = await act(() => api('POST', `/pay/profile/${d.id}`, { hourly_rate: rate.value, ot_rule: prof.ot_rule, vacation_pct: prof.vacation_pct, meal_min: meal.value,
              stat_pay: prof.stat_pay, callin: prof.callin, meal_paid: prof.meal_paid }), 'Saved');
            if (ok) close();
          } }, icon('check', 'sm'), 'Save')) : null));
    }

    // Company pay rules
    const B = R.bc_defaults;
    const f = {};
    const numIn = (k, v, step) => (f[k] = h('input', { type: 'number', min: 0, step: step || 0.5, value: v == null ? '' : v, disabled: !edit || null }));
    const field = (label, k, v, unit, step) => h('label', { class: 'f' }, label, h('div', { class: 'unit' }, numIn(k, v, step), unit ? h('span', { class: 'muted small' }, unit) : null),
      B[k] != null && Number(v) !== Number(B[k]) ? h('span', { class: 'small muted' }, `BC default: ${B[k]}`) : null);
    const bcBox = h('input', { type: 'checkbox', class: 'check', checked: rules.bc_holidays || null, disabled: !edit || null });
    const extra = h('textarea', { rows: 3, disabled: !edit || null, placeholder: '2026-12-26 Boxing Day' });
    extra.value = rules.extra_holidays.map((x) => `${x.date} ${x.name}`).join('\n');
    const ded = h('textarea', { rows: 3, disabled: !edit || null, placeholder: 'CPP 5.95' });
    ded.value = rules.deductions.map((x) => `${x.name} ${x.pct}`).join('\n');
    const parseLines = (txt, fn) => txt.split('\n').map((x) => x.trim()).filter(Boolean).map(fn);
    const group = (title, ...kids) => h('div', { class: 'rule-group' }, h('h3', null, title), h('div', { class: 'ps-grid' }, ...kids));
    const reset = () => {
      Object.keys(f).forEach((k) => { if (B[k] != null) f[k].value = B[k]; });
      f.meal_min.value = 30; bcBox.checked = true;
      toast('BC defaults filled in. Press Save to keep them.');
    };
    main.append(h('section', { class: 'card pay-settings mt16' },
      h('div', { class: 'row between' }, h('h2', { class: 'm0' }, icon('sliders', 'sm'), 'Pay rules'),
        edit ? h('div', { class: 'row' }, h('button', { class: 'btn', onclick: reset }, 'Reset to BC defaults'),
          h('button', { class: 'btn primary', onclick: () => act(() => api('PUT', '/pay/rules', Object.assign(
            Object.fromEntries(Object.entries(f).map(([k, el]) => [k, el.value])),
            { bc_holidays: bcBox.checked,
              extra_holidays: parseLines(extra.value, (x) => { const [date, ...n] = x.split(/\s+/); return { date, name: n.join(' ') }; }),
              deductions: parseLines(ded.value, (x) => { const m = x.match(/^(.*?)\s+([\d.]+)\s*%?$/); return m ? { name: m[1], pct: m[2] } : { name: x, pct: '' }; }) })), 'Pay rules saved') }, icon('check', 'sm'), 'Save')) : null),
      h('p', { class: 'notice' }, 'Default values follow BC employment standards (2026). You can change any value. Changes apply to pay not yet approved. Please confirm with your payroll provider.'),
      group('Wages', field('Company hourly rate', 'hourly_rate', rules.hourly_rate, 'CAD/h', 0.01), field('Minimum wage', 'min_wage', rules.min_wage, 'CAD/h', 0.01)),
      group('Overtime', field('Overtime rate', 'ot_mult', rules.ot_mult, '×', 0.1), field('Short haul: after (day)', 'short_day_h', rules.short_day_h, 'h'),
        field('Short haul: after (week)', 'short_week_h', rules.short_week_h, 'h'), field('Long haul: after (week)', 'long_week_h', rules.long_week_h, 'h')),
      group('Meal break', field('Meal break', 'meal_min', rules.meal_min, 'min', 1), field('Deduct only on trips over', 'meal_after_h', rules.meal_after_h, 'h')),
      group('Minimum daily pay', field('Minimum pay', 'callin_h', rules.callin_h, 'h'), field('Minimum pay (long day)', 'callin_long_h', rules.callin_long_h, 'h'),
        field('Long day = scheduled over', 'callin_long_after_h', rules.callin_long_after_h, 'h')),
      group('Stat holidays', field('Worked on a holiday', 'stat_mult', rules.stat_mult, '×', 0.1), field('Double time after', 'stat_double_after_h', rules.stat_double_after_h, 'h'),
        field('Double time rate', 'stat_double_mult', rules.stat_double_mult, '×', 0.1), field('Eligible after working', 'stat_eligible_days', rules.stat_eligible_days, 'of 30 days', 1)),
      h('div', { class: 'ps-grid' },
        h('div', { class: 'f' }, h('label', { class: 'checkline' }, bcBox, h('b', null, 'Use BC statutory holidays')),
          h('details', { class: 'small muted' }, h('summary', null, 'Show the holiday list'), ...R.holidays.map((y) => h('p', null, h('b', null, `${y.year}: `), y.list.map((x) => `${new Date(x.date + 'T12:00').toLocaleDateString('en-CA', { month: 'short', day: 'numeric' })} ${x.name}`).join(', '))))),
        h('label', { class: 'f' }, 'Extra company holidays (one per line)', extra)),
      group('Deductions (estimate only)',
        h('label', { class: 'f' }, 'Name and % (one per line)', ded,
          h('span', { class: 'small muted' }, 'Shown as an estimate on Payouts. Leave empty if your payroll provider handles tax, CPP and EI.')))));
  }

  // ---------- page: Payouts ----------
  async function pagePayout(main) {
    const { rows, deductions } = await api('GET', '/payout');
    const est = deductions.length > 0;
    main.append(pageHead('Pay drivers', 'Approved pay. After you send a payment, press Mark paid. The CSV opens directly in Excel.',
      window.MockAPI ? h('span', { class: 'small muted' }, 'CSV download works on the real server.')
        : h('a', { class: 'btn', href: '/api/payout/export.csv', download: 'payout.csv' }, icon('ext', 'sm'), 'Download CSV (Excel)')));
    if (!rows.length) return main.append(emptyBox('No approved pay yet.', 'cash'));
    const markPaid = (p) => async () => {
      const ref = await ask('Payment reference (e-transfer no., optional)', { input: true, optional: true, ok: 'Mark paid' });
      if (ref !== null) act(() => api('POST', p.kind === 'holiday' ? `/payout/holiday/${p.holiday_id}/paid` : `/payout/${p.trip_id}/paid`, { payment_ref: ref }), 'Marked as paid');
    };
    const ptabs = { unpaid: ['To pay', rows.filter((p) => !p.paid_at)], paid: ['Paid', rows.filter((p) => p.paid_at)] };
    main.append(statusTabs('payout', ptabs, 'unpaid'));
    const shown = ptabs[TAB_STATE.payout][1];
    if (!shown.length) return main.append(emptyBox(TAB_STATE.payout === 'unpaid' ? 'Nothing to pay right now.' : 'Nothing paid yet.', 'cash'));
    main.append(h('div', { class: 'table-wrap' }, h('table', null,
      h('thead', null, h('tr', null, ['Trip', 'Driver', 'Paid time', 'Rate', 'Amount', est ? 'Net (est.)' : null, 'Approved', 'Paid', ''].filter((x) => x !== null)
        .map((x) => h('th', { class: ['Paid time', 'Rate', 'Amount', 'Net (est.)'].includes(x) ? 'num' : null }, x)))),
      h('tbody', null, shown.map((p) => h('tr', null,
        h('td', null, p.trip_no), h('td', null, p.driver_name, p.team_with ? [' ', h('span', { class: 'chip info', title: `Team trip with ${p.team_with}` }, 'Team')] : null), h('td', { class: 'num' }, p.kind === 'holiday' ? '–' : fmtMin((p.recognized_minutes || 0) + (p.callin_minutes || 0))),
        h('td', { class: 'num' }, p.kind === 'holiday' ? '–' : money(p.hourly_rate)), h('td', { class: 'num' }, money(p.amount)),
        est ? h('td', { class: 'num', title: `Estimated deductions ${money(p.deductions)}` }, money(p.net)) : null,
        h('td', { class: 'small' }, `${p.approved_by_name} · ${fmtDate(p.approved_at)}`),
        h('td', { class: 'small' }, p.paid_at ? h('span', { class: 'chip ok' }, `Paid ${fmtDate(p.paid_at)}${p.payment_ref ? ' · ' + p.payment_ref : ''}`) : h('span', { class: 'chip warn' }, 'Unpaid')),
        h('td', null, p.paid_at ? null : can('payout.edit') ? h('button', { class: 'btn small primary', onclick: markPaid(p) }, 'Mark paid')
          : h('span', { class: 'small muted' }, 'Accounting marks paid'))))))));
    if (est) main.append(h('p', { class: 'small muted' }, `Net is an estimate using ${deductions.map((d) => `${d.name} ${d.pct}%`).join(', ')} from Pay rules. Your payroll provider calculates the real deductions.`));
  }

  // ---------- page: Settings ----------
  async function pageSettings(main) {
    const s = await api('GET', '/settings');
    const edit = can('settings.edit');
    const f = {
      rounding_unit_min: h('select', { disabled: !edit || null }, [1, 5, 6, 10, 15, 30].map((v) => h('option', { value: v }, `${v} min`))),
      rounding_mode: h('select', { disabled: !edit || null }, [['none', 'No rounding'], ['nearest', 'Round to nearest'], ['down', 'Round down'], ['up', 'Round up']].map(([v, l]) => h('option', { value: v }, l))),
      long_trip_warn_hours: h('input', { type: 'number', min: 1, max: 48, step: 0.5, value: s.long_trip_warn_hours, disabled: !edit || null }),
      mismatch_warn_min: h('input', { type: 'number', min: 1, max: 600, value: s.mismatch_warn_min, disabled: !edit || null }),
      accept_early_min: h('input', { type: 'number', min: 0, max: 240, value: s.accept_early_min == null ? 15 : s.accept_early_min, disabled: !edit || null }),
    };
    f.rounding_unit_min.value = s.rounding_unit_min; f.rounding_mode.value = s.rounding_mode;
    main.append(pageHead('Settings', 'Rounding, warnings and the Accept window. Hourly rates, meal break and BC pay rules are on the Drivers pay setting page. Changes are logged and never affect pay that is already approved.'),
      h('div', { class: 'card' }, h('div', { class: 'form' },
        h('label', { class: 'f' }, 'Rounding unit', f.rounding_unit_min), h('label', { class: 'f' }, 'Rounding mode', f.rounding_mode),
        h('label', { class: 'f' }, 'Long trip warning (hours)', f.long_trip_warn_hours),
        h('label', { class: 'f' }, 'Finish vs receiving warning (min)', f.mismatch_warn_min),
        h('label', { class: 'f' }, 'Accept opens before planned start (min)', f.accept_early_min),
        edit ? h('button', { class: 'btn primary', onclick: () => act(() => api('PUT', '/settings', Object.fromEntries(Object.entries(f).map(([k, el]) => [k, el.value]))), 'Settings saved') }, 'Save') : null)),
      h('p', { class: 'small muted' }, 'The 13-hour default is based on the Canadian federal hours-of-service limit (about 13 driving hours per day). Please confirm against the current regulations.'));
    // Admin, local demo only: start the demo over before showing it to the next person
    if (me.demo_reset) main.append(h('div', { class: 'card mt12' }, h('h2', null, icon('undo', 'sm'), 'Demo data'),
      h('p', { class: 'sub mt0' }, 'Deletes everything entered during the demo and loads the sample trips again. Only in the demo, never on real data.'),
      h('button', { class: 'btn danger', onclick: resetDemo }, 'Reset demo data')));
  }
  async function resetDemo() {
    const ok = await ask('Reset demo data?', { ok: 'Reset', danger: true,
      text: 'All trips, receipts, corrections and payments are deleted and the sample data is loaded again. Everyone is signed out. This cannot be undone.' });
    if (!ok || busy) return;
    busy = true;
    try {
      await flushPending();
      await api('POST', '/admin/demo-reset', { confirm: 'RESET' });
      me = null; notes = { unread: 0, items: [] }; location.hash = ''; render();
      toast('Demo data reset. Sign in with any demo account.');
    } catch (e) { toast(e.message, true); } finally { busy = false; }
  }

  // ---------- page: Users ----------
  async function pageUsers(main) {
    const users = await api('GET', '/users');
    const roleBoxes = (sel) => Object.entries(L.ROLES).map(([k, l]) => h('label', null, h('input', { type: 'checkbox', value: k, checked: sel.includes(k) || null, class: 'check' }), l));
    const pick = (wrap) => [...wrap.querySelectorAll('input:checked')].map((x) => x.value);
    const nf = { username: h('input', { maxlength: 40, placeholder: 'driver4' }), name: h('input', { maxlength: 80 }), phone: h('input', { maxlength: 30 }), password: h('input', { type: 'password', minlength: 10, autocomplete: 'new-password' }) };
    const nroles = h('div', { class: 'role-boxes' }, roleBoxes(['driver']));
    main.append(pageHead('Users & roles', 'One account per person. Change a name or roles and press Save. Reset password gives a temporary one; the person then chooses their own at sign-in and can change it any time. Deactivating signs them out and keeps their records.'),
      h('div', { class: 'card form-card' }, h('h2', null, icon('users', 'sm'), 'New account'), h('div', { class: 'form' },
        h('label', { class: 'f' }, 'Username', nf.username), h('label', { class: 'f' }, 'Name', nf.name), h('label', { class: 'f' }, 'Phone', nf.phone),
        h('label', { class: 'f' }, 'Temporary password (10+ chars)', nf.password, h('span', { class: 'small muted' }, 'They choose their own password at first sign-in.'))), h('div', { class: 'my10' }, nroles),
        h('button', { class: 'btn primary', onclick: () => act(() => api('POST', '/users', { username: nf.username.value, name: nf.name.value, phone: nf.phone.value, password: nf.password.value, roles: pick(nroles) }), 'Account created') }, 'Create')));
    main.append(h('div', { class: 'table-wrap' }, h('table', null,
      h('thead', null, h('tr', null, ['Name', 'Username', 'Roles', 'Status', ''].map((x) => h('th', null, x)))),
      h('tbody', null, users.map((u) => {
        const rb = h('div', { class: 'role-boxes' }, roleBoxes(u.roles));
        const nm = h('input', { value: u.name, maxlength: 80, 'aria-label': `Name of ${u.username}`, class: 'name-in' });
        return h('tr', null, h('td', null, nm), h('td', { class: 'small' }, u.username), h('td', null, rb),
          h('td', null, u.active ? h('span', { class: 'chip ok' }, 'Active') : h('span', { class: 'chip gray' }, 'Inactive')),
          h('td', null, h('div', { class: 'row' },
            h('button', { class: 'btn small primary', onclick: () => {
              const body = {};
              if (nm.value.trim() !== u.name) body.name = nm.value.trim();
              const roles = pick(rb);
              if (roles.slice().sort().join() !== u.roles.slice().sort().join()) body.roles = roles;
              if (!Object.keys(body).length) return toast('Nothing changed.');
              act(() => api('POST', `/users/${u.id}`, body), 'Saved');
            } }, 'Save'),
            h('button', { class: 'btn small' + (u.active ? ' danger' : ''), onclick: () => act(() => api('POST', `/users/${u.id}`, { active: !u.active }), u.active ? 'Deactivated' : 'Reactivated') }, u.active ? 'Deactivate' : 'Activate'),
            h('button', { class: 'btn small', onclick: async () => { const pw = await ask(`New temporary password for ${u.name}`, { input: true, type: 'password', ok: 'Reset', text: '10+ characters. Give it to them in person; they choose their own at next sign-in.' }); if (pw) act(() => api('POST', `/users/${u.id}`, { password: pw }), 'Password reset'); } }, 'Reset password'))));
      })))));
  }

  // ---------- page: Audit Log ----------
  async function pageAudit(main) {
    const rows = await api('GET', '/audit');
    main.append(pageHead('Activity log', 'Every action is recorded with who and when. This log cannot be edited or deleted.'),
      h('div', { class: 'table-wrap' }, h('table', null,
        h('thead', null, h('tr', null, ['Time', 'User', 'Action', 'Target', 'Details'].map((x) => h('th', null, x)))),
        h('tbody', null, rows.map((a) => h('tr', null, h('td', { class: 'small mono' }, fmtTime(a.at)), h('td', null, a.user_name || '–'),
          h('td', { class: 'small' }, a.action), h('td', { class: 'small' }, a.entity ? `${a.entity} ${a.entity_id || ''}` : ''),
          h('td', { class: 'small muted detail' }, JSON.stringify(a.detail))))))));
  }

  // ---------- page: Pay History (Payroll, Accounting) ----------
  async function pagePayHist(main) {
    const pp = periodPicker(() => load());
    const drv = h('select', { 'aria-label': 'Driver' }, h('option', { value: '' }, 'All drivers'));
    api('GET', '/drivers').then((ds) => ds.forEach((d) => drv.append(h('option', { value: d.id }, d.name)))).catch(() => {});
    const fish = h('select', { 'aria-label': 'Fish' }, h('option', { value: '' }, 'All fish'), L.MAIN_SPECIES.concat('Other').map((x) => h('option', { value: x }, x)));
    const lot = h('input', { type: 'search', placeholder: 'Lot number', 'aria-label': 'Lot number', maxlength: 60 });
    const sort = h('select', { 'aria-label': 'Sort by' }, [['date', 'Sort: Date'], ['driver', 'Sort: Driver'], ['fish', 'Sort: Fish'], ['lot', 'Sort: Lot no.']].map(([v, l]) => h('option', { value: v }, l)));
    const qs = () => {
      const [a, b] = pp.get();
      const q = new URLSearchParams({ from: a.toISOString(), to: b.toISOString(), sort: sort.value });
      if (drv.value) q.set('driver_id', drv.value);
      if (fish.value) q.set('fish', fish.value);
      if (lot.value.trim()) q.set('lot', lot.value.trim());
      return q.toString();
    };
    const dl = window.MockAPI ? h('span', { class: 'small muted' }, 'Excel download works on the real server.')
      : h('a', { class: 'btn', href: '#', onclick: (e) => { e.currentTarget.href = '/api/payhist/export.xlsx?' + qs(); } }, icon('download', 'sm'), 'Download Excel');
    main.append(pageHead('Pay History', 'Approved and paid trips, one line per fish lot. A trip with several lots is paid once, on its first line. Filter, sort and download exactly what you see.', dl),
      h('div', { class: 'card filters' }, pp.seg, h('div', { class: 'row' }, pp.dates),
        h('div', { class: 'filter-grid' }, drv, fish, h('div', { class: 'search' }, icon('search', 'sm'), lot), sort)));
    [drv, fish, sort].forEach((x) => x.addEventListener('change', () => load()));
    let timer2; lot.addEventListener('input', () => { clearTimeout(timer2); timer2 = setTimeout(load, 300); });
    const out = h('div');
    main.append(out);
    let seq = 0;
    async function load() {
      const mine = ++seq;
      let rows;
      try { rows = await api('GET', '/payhist?' + qs()); } catch (e) { return toast(e.message, true); }
      if (mine !== seq) return;
      const sum = (f) => rows.reduce((x, r) => x + (Number(f(r)) || 0), 0);
      const trips = new Set(rows.map((r) => r.team_key || r.trip_id)).size; // a team trip counts once
      out.replaceChildren(...[
        h('div', { class: 'grid stats wide' },
          statCard('Amount', money(sum((r) => r.amount)), 'dollar', 'ok', `${trips} trip${trips === 1 ? '' : 's'}`),
          statCard('Paid hours', fmtMin(sum((r) => r.paid_min)), 'clock'),
          statCard('Tonnes', `${sum((r) => r.tonnes).toLocaleString('en-CA', { maximumFractionDigits: 3 })} t`, 'box', 'gray', `${rows.filter((r) => r.lot).length} lot line${rows.length === 1 ? '' : 's'}`)),
        rows.length ? h('div', { class: 'table-wrap' }, h('table', null,
          h('thead', null, h('tr', null, ['Date', 'Trip', 'Driver', 'Fish', 'Lot no.', 'Tonnes', 'Paid time', 'Amount', 'Status'].map((x, i) => h('th', { class: [5, 6, 7].includes(i) ? 'num' : null }, x)))),
          h('tbody', null, rows.map((r) => h('tr', { class: 'click', onclick: () => showTrip(r.trip_id) },
            h('td', null, fmtDate(r.date)), h('td', null, r.trip_no), h('td', null, r.driver, r.team_with ? [' ', h('span', { class: 'chip info', title: `Team trip with ${r.team_with}` }, 'Team'), h('div', { class: 'small muted' }, `with ${r.team_with}`)] : null), h('td', null, r.species || '–'),
            h('td', { class: 'mono' }, r.lot || '–'), h('td', { class: 'num' }, r.tonnes == null ? '–' : fmtT(r.tonnes)),
            r.same_trip ? h('td', { colspan: 2, class: 'num small muted', title: `One trip carried several lots. Its pay is counted once${r.pay_lot ? `, on the ${r.pay_lot} line` : ''}.` }, 'Same trip · paid once')
              : [h('td', { class: 'num' }, r.paid_min == null ? '' : fmtMin(r.paid_min)), h('td', { class: 'num' }, r.amount == null ? '' : money(r.amount))],
            h('td', null, r.paid_at ? h('span', { class: 'chip ok' }, 'Paid') : h('span', { class: 'chip info' }, 'Approved')))))))
          : emptyBox('No approved pay matches these filters.', 'list'),
      ]);
    }
    await load();
  }

  // ---------- page: Addresses (address book for Dispatch) ----------
  async function pageAddresses(main) {
    const list = await api('GET', '/addresses');
    const add = h('input', { placeholder: 'Add an address', maxlength: 200, 'aria-label': 'New address' });
    const q = h('input', { type: 'search', placeholder: 'Search saved addresses', 'aria-label': 'Search' });
    main.append(pageHead('Saved addresses', 'Addresses used in Dispatch are saved here automatically and suggested next time. Fix spelling or remove ones you no longer use.'),
      h('div', { class: 'card' }, h('div', { class: 'input-row' }, add, mapButton(add),
        h('button', { class: 'btn primary', onclick: () => act(() => api('POST', '/addresses', { address: add.value }), 'Address saved') }, icon('plus', 'sm'), 'Add'))),
      h('div', { class: 'search mb12' }, icon('search', 'sm'), q));
    const box = h('div', { class: 'card addr-list' });
    const draw = () => {
      const term = q.value.trim().toLowerCase();
      const shown = list.filter((a) => !term || a.address.toLowerCase().includes(term));
      box.replaceChildren(...(shown.length ? shown.map((a) => h('div', { class: 'addr' },
        h('div', { class: 'addr-text' }, icon('pin', 'sm'), place(a.address)),
        h('span', { class: 'small muted' }, `used ${a.use_count}×`),
        h('div', { class: 'row gap4' },
          h('button', { class: 'btn small', onclick: async () => {
            const v = await ask('Edit address', { input: true, ok: 'Save', text: a.address });
            if (v) act(() => api('POST', `/addresses/${a.id}`, { address: v }), 'Address updated');
          } }, 'Edit'),
          h('button', { class: 'btn small danger', onclick: async () => {
            if (await ask('Remove this address?', { ok: 'Remove', text: `${a.address} — trips that already use it are not changed.` })) act(() => api('POST', `/addresses/${a.id}`, { remove: true }), 'Address removed');
          } }, 'Remove')))) : [h('p', { class: 'muted small' }, term ? 'No saved address matches.' : 'No saved addresses yet.')]));
    };
    q.addEventListener('input', draw);
    draw();
    main.append(box);
  }

  // ---------- page: Today (office home: only what needs you) ----------
  async function pageToday(main) {
    const items = await api('GET', '/today');
    const hr = new Date().getHours();
    const first = String(me.user.name).split(/[\s(]/)[0];
    main.append(pageHead(`${hr < 12 ? 'Good morning' : hr < 18 ? 'Good afternoon' : 'Good evening'}, ${first}`,
      items.length ? 'Only the things that need you right now.' : null));
    if (!items.length) return main.append(h('div', { class: 'card allclear' }, h('span', { class: 'allclear-ico' }, icon('check')), h('b', null, 'All caught up'), h('span', { class: 'muted' }, 'Nothing needs you right now. This page refreshes by itself.')));
    const label = (id) => (me.pages.find((x) => x.id === id) || { label: id }).label;
    main.append(h('div', { class: 'today-grid' }, items.map((it) => h('section', { class: 'card todo ' + it.tone },
      h('div', { class: 'todo-head' }, h('span', { class: 'todo-count' }, String(it.count)),
        h('div', null, h('b', null, it.title), h('div', { class: 'small muted' }, it.amount != null ? `${money(it.amount)} in total. ${it.hint}` : it.hint))),
      h('div', { class: 'todo-list' }, it.list.map((x) => h('button', { class: 'todo-row', type: 'button', onclick: () => showTrip(x.trip_id) },
        h('span', { class: 'mono small' }, x.trip_no), h('span', { class: 'todo-who' }, x.driver), h('span', { class: 'small muted' }, x.text)))),
      it.count > it.list.length ? h('div', { class: 'small muted' }, `+ ${it.count - it.list.length} more`) : null,
      h('a', { class: 'btn primary block', href: '#' + it.page }, `Open ${label(it.page)}`)))));
  }

  // ---------- page: Quick guide (one page per role, simple English, big icons) ----------
  const GUIDE = {
    driver: ['Driver', [
      ['play', 'Accept', `When your trip starts, press Accept trip. It opens 15 minutes before the planned time. Your paid time starts.`],
      ['box', 'Pickup done', 'Optional. Press it after loading.'],
      ['flag', 'Finish', `When you are done, press Finish trip. Tapped by mistake? Press Undo within ${UNDO_SEC} seconds.`],
      ['edit', 'Wrong time?', 'Open the trip and press Fix a time. Your manager checks it.'],
      ['dollar', 'Your pay', 'Pay shows your hours and amount for each trip.']]],
    scheduler: ['Scheduler', [
      ['home', 'Today', 'Start here. It lists trips not accepted yet, long trips and corrections to check.'],
      ['plus', 'Assign trips', 'Create a trip: driver, truck, addresses, start time. Saved addresses appear as you type.'],
      ['board', 'Live trips', 'See who is on the road and for how long.'],
      ['edit', 'Time corrections', 'Check a driver\'s time fix first. Payroll gives the final OK.']]],
    logistics: ['Logistics', [
      ['box', 'Receiving', 'Tap a trip, then record the fish, lot number and weight. Pick Case or Tote and the count fills in from the average weight (you can change it). Then set the time you received it.'],
      ['list', 'Find received fish', 'On Receiving, type a lot number (or pick a fish and dates) to see what came in, when and on which truck.'],
      ['clock', 'Trip History', 'Find any past trip by date or driver.']]],
    payer: ['Payroll', [
      ['home', 'Today', 'Shows corrections for final approval and trips ready to pay.'],
      ['users', 'Drivers pay setting', 'Tap a driver once to set the hourly rate, overtime, vacation pay, stat holiday pay and minimum pay. Pay rules (BC defaults) are below the list.'],
      ['check', 'Pay', 'Tick the trips under To approve and press Approve. Approved · unpaid and Paid show the rest.'],
      ['list', 'Pay History', 'Filter by driver, fish or lot and download Excel.']]],
    accounting: ['Accounting', [
      ['cash', 'Pay drivers', 'After you send a payment, press Mark paid.'],
      ['list', 'Pay History', 'Filter and download Excel.'],
      ['shield', 'Activity log', 'Every action, who and when. It cannot be changed.']]],
    admin: ['Admin', [
      ['users', 'Users & roles', 'Create an account for each person with a temporary password. They choose their own at first sign-in. Change anyone\'s name or roles here any time.'],
      ['key', 'Forgot password', 'Users page → Reset password. Give the new temporary password in person.'],
      ['sliders', 'Settings', 'Rounding, Accept window, warnings. Pay rates and BC rules are on Drivers pay setting.']]],
  };
  function guideSteps(role) {
    const [title, steps] = GUIDE[role];
    return h('section', { class: 'card guide' }, h('h2', null, title),
      h('ol', { class: 'gsteps' }, steps.map(([ic, t, d]) => h('li', null, h('span', { class: 'gstep-ico' }, icon(ic)), h('div', null, h('b', null, t), h('p', null, d))))));
  }
  async function pageGuide(main) {
    markGuideSeen();
    main.append(pageHead('Quick guide', 'Everything you need on one page.'));
    const roles = me.user.roles.filter((r) => GUIDE[r]);
    roles.forEach((r) => main.append(guideSteps(r)));
    main.append(h('section', { class: 'card guide' }, h('h2', null, 'Put it on your phone'),
      h('ol', { class: 'gsteps' },
        h('li', null, h('span', { class: 'gstep-ico' }, icon('phone')), h('div', null, h('b', null, 'Android (Chrome)'), h('p', null, 'Menu ⋮ → Install app (or Add to Home screen).'))),
        h('li', null, h('span', { class: 'gstep-ico' }, icon('phone')), h('div', null, h('b', null, 'iPhone (Safari)'), h('p', null, 'Share button → Add to Home Screen. Open Trip Log from the new icon.'))),
        h('li', null, h('span', { class: 'gstep-ico' }, icon('lock')), h('div', null, h('b', null, 'Stay signed in'), h('p', null, 'Leave "Keep me signed in" ticked when you sign in. Untick it on shared computers.'))),
        h('li', null, h('span', { class: 'gstep-ico' }, icon('bell')), h('div', null, h('b', null, 'Alerts'), h('p', null, 'Tap the bell, then Turn on phone alerts. iPhone: open Trip Log from the Home Screen icon first.')))),
      installButton()));
  }
  const GUIDE_KEY = () => `triplog-guide-seen-${me.user.id}`;
  function markGuideSeen() { try { localStorage.setItem(GUIDE_KEY(), '1'); } catch (e) { /* private mode */ } }
  function guideSeen() { try { return !!localStorage.getItem(GUIDE_KEY()); } catch (e) { return true; } }

  // ---------- install (PWA) ----------
  let installEvt = null;
  window.addEventListener('beforeinstallprompt', (e) => { e.preventDefault(); installEvt = e; });
  const standalone = () => window.matchMedia('(display-mode: standalone)').matches || window.navigator.standalone === true;
  function installButton() {
    if (window.MockAPI) return h('p', { class: 'small muted' }, 'Installing works on the real server (https).');
    if (standalone()) return h('p', { class: 'small muted' }, icon('check', 'sm'), ' Trip Log is installed on this device.');
    if (!installEvt) return null;
    return h('button', { class: 'btn primary', onclick: async () => { installEvt.prompt(); await installEvt.userChoice.catch(() => null); installEvt = null; route(); } }, icon('download', 'sm'), 'Install Trip Log on this device');
  }
  if (!window.MockAPI && 'serviceWorker' in navigator) window.addEventListener('load', () => navigator.serviceWorker.register('/sw.js').catch(() => {}));

  // ---------- notifications (bell) + phone alerts ----------
  let notes = { unread: 0, items: [] };
  function drawBadges() {
    document.querySelectorAll('.bell-badge').forEach((b) => { b.textContent = notes.unread > 9 ? '9+' : String(notes.unread); b.hidden = !notes.unread; });
  }
  async function refreshNotes(announce) {
    if (!me || me.must_change_pw) return;
    try {
      const n = await api('GET', '/notifications');
      const fresh = n.items.filter((x) => !x.read_at && !notes.items.some((y) => y.id === x.id));
      const first = !notes.loaded;
      notes = Object.assign(n, { loaded: true }); drawBadges();
      if (announce && !first && fresh.length) toast(fresh[0].title);
    } catch (e) { /* offline: try again next minute */ }
  }
  setInterval(() => { if (me && document.visibilityState === 'visible') refreshNotes(true); }, 60000);
  document.addEventListener('visibilitychange', () => { if (me && document.visibilityState === 'visible') refreshNotes(true); });
  const NOTE_ICON = { trip: 'route', correction: 'edit', long_trip: 'alert' };
  const pushOk = () => !window.MockAPI && 'serviceWorker' in navigator && 'PushManager' in window && 'Notification' in window;
  function b64u(s) { const p = '='.repeat((4 - (s.length % 4)) % 4); const b = atob((s + p).replace(/-/g, '+').replace(/_/g, '/')); return Uint8Array.from(b, (c) => c.charCodeAt(0)); }
  async function pushSub() { if (!pushOk()) return null; const reg = await navigator.serviceWorker.ready; return reg.pushManager.getSubscription(); }
  async function enablePush() {
    if (await Notification.requestPermission() !== 'granted') throw new Error('Alerts are blocked. Allow notifications for this site in the browser settings, then try again.');
    const { key } = await fetch('/api/push/key').then((r) => r.json());
    if (!key) throw new Error('Phone alerts are not set up on the server.');
    const reg = await navigator.serviceWorker.ready;
    const sub = (await reg.pushManager.getSubscription()) || await reg.pushManager.subscribe({ userVisibleOnly: true, applicationServerKey: b64u(key) });
    await api('POST', '/push/subscribe', sub.toJSON());
  }
  async function disablePush() {
    const sub = await pushSub().catch(() => null);
    if (sub) { await api('POST', '/push/unsubscribe', { endpoint: sub.endpoint }).catch(() => {}); await sub.unsubscribe().catch(() => {}); }
  }
  // After sign-in on a phone that already allowed alerts, link this phone to the person now signed in
  async function relinkPush() {
    try { if (pushOk() && Notification.permission === 'granted') { const sub = await pushSub(); if (sub) await api('POST', '/push/subscribe', sub.toJSON()); } } catch (e) { /* ignore */ }
  }
  async function pushRow() {
    if (window.MockAPI) return h('p', { class: 'small muted' }, icon('bell', 'sm'), ' Phone alerts work on the real server.');
    if (!pushOk()) return h('p', { class: 'small muted' }, icon('bell', 'sm'), /iP(hone|ad)/.test(navigator.userAgent) && !standalone() ? ' iPhone: add Trip Log to the Home Screen first (Share → Add to Home Screen), then turn on alerts there.' : ' This browser cannot show phone alerts. The bell still works.');
    const on = Notification.permission === 'granted' && await pushSub().catch(() => null);
    return h('div', { class: 'push-row' }, icon('bell', 'sm'), h('span', { class: 'grow small' }, on ? 'Phone alerts are on for this device.' : 'Get an alert on this device even when the app is closed.'),
      h('button', { class: 'btn small' + (on ? '' : ' primary'), onclick: async (e) => {
        e.currentTarget.disabled = true;
        try { if (on) { await disablePush(); toast('Phone alerts turned off'); } else { await enablePush(); toast('Phone alerts are on'); } } catch (err) { toast(err.message, true); }
        closeNotes(); openNotes();
      } }, on ? 'Turn off' : 'Turn on phone alerts'));
  }
  let closeNotes = () => {};
  async function openNotes() {
    await refreshNotes(false);
    const list = notes.items.length ? h('div', { class: 'note-list' }, notes.items.map((n) => h('button', { class: 'note' + (n.read_at ? '' : ' unread'), type: 'button', onclick: () => { closeNotes(); if (n.link) { if (location.hash === n.link) route(); else location.hash = n.link; } } },
      h('span', { class: 'note-ico' }, icon(NOTE_ICON[n.kind] || 'bell', 'sm')),
      h('span', { class: 'grow' }, h('b', null, n.title), n.body ? h('span', { class: 'small muted block' }, n.body) : null, h('span', { class: 'small muted block' }, fmtTime(n.created_at))))))
      : h('p', { class: 'muted' }, 'No notifications yet.');
    closeNotes = modal('Notifications', h('div', null, await pushRow(), list));
    if (notes.unread) { api('POST', '/notifications/read', {}).catch(() => {}); notes.unread = 0; drawBadges(); }
  }
  const bellBtn = (cls) => h('button', { class: 'icon-btn bell ' + (cls || ''), 'aria-label': 'Notifications', title: 'Notifications', onclick: openNotes }, icon('bell'), h('span', { class: 'bell-badge', hidden: true }));

  // ---------- account: change password ----------
  function passwordForm(forced, done) {
    const cur = h('input', { type: 'password', autocomplete: 'current-password' });
    const nw = h('input', { type: 'password', autocomplete: 'new-password', minlength: 10 });
    const nw2 = h('input', { type: 'password', autocomplete: 'new-password', minlength: 10 });
    return h('form', { class: 'form one-col', onsubmit: async (e) => {
      e.preventDefault();
      if (nw.value.length < 10) return toast('The new password needs at least 10 characters.', true);
      if (nw.value !== nw2.value) return toast('The two new passwords do not match.', true);
      try { await api('POST', '/me/password', { current_password: cur.value, new_password: nw.value }); toast('Password changed'); done(); } catch (err) { toast(err.message, true); }
    } },
    h('label', { class: 'f' }, forced ? 'Temporary password (from your admin)' : 'Current password', cur),
    h('label', { class: 'f' }, 'New password (10+ characters)', nw),
    h('label', { class: 'f' }, 'New password again', nw2),
    h('button', { class: 'btn primary block', type: 'submit' }, 'Save new password'));
  }
  function renderForcedPassword() {
    $app().replaceChildren(h('div', { class: 'login' },
      h('div', { class: 'logo' }, h('span', { class: 'logo-mark' }, icon('truck')), h('span', null, 'Trip Log')),
      h('h1', null, `Welcome, ${String(me.user.name).split(/[\s(]/)[0]}`), h('p', { class: 'sub' }, 'Choose your own password to continue. Only you will know it.'),
      h('div', { class: 'card' }, passwordForm(true, async () => { await loadMe(); render(); })),
      h('button', { class: 'btn ghost block', onclick: signOut }, icon('logout', 'sm'), 'Sign out')));
  }
  function accountSheet() {
    const roles = me.user.roles.map((r) => L.ROLES[r]).join(', ');
    const close = modal('Account', h('div', null,
      h('div', { class: 'row mb12' }, h('span', { class: 'avatar' }, initials(me.user.name)), h('div', null, h('b', null, `${roles} - ${me.user.name}`), h('div', { class: 'small muted' }, me.user.username))),
      h('div', { class: 'nav-list' },
        h('a', { href: '#guide', onclick: () => close() }, icon('help'), 'Quick guide'),
        h('a', { href: '#', onclick: (e) => { e.preventDefault(); close(); openNotes(); } }, icon('bell'), 'Notifications and phone alerts'),
        h('a', { href: '#', onclick: (e) => { e.preventDefault(); close(); const c = modal('Change password', passwordForm(false, () => c())); } }, icon('key'), 'Change password')),
      installButton(),
      h('div', { class: 'row mt12' }, h('button', { class: 'btn block', onclick: () => { close(); signOut(); } }, icon('logout', 'sm'), 'Sign out'))));
  }

  const PAGE_FN = { today: pageToday, guide: pageGuide, my: pageMy, dispatch: pageDispatch, board: pageBoard, receipt: pageReceipt, corrections: pageCorrections,
    history: pageHistory, pay: pagePay, drivers: pageDrivers, payout: pagePayout, settings: pageSettings, users: pageUsers, audit: pageAudit,
    payhist: pagePayHist, addresses: pageAddresses };

  // ---------- sign in ----------
  function renderSetup() {
    const f = { name: h('input', { maxlength: 80, autocomplete: 'name' }), username: h('input', { maxlength: 40, autocapitalize: 'none', autocomplete: 'username', placeholder: 'e.g. eden' }),
      password: h('input', { type: 'password', autocomplete: 'new-password', minlength: 10 }) };
    $app().replaceChildren(h('div', { class: 'login' },
      h('div', { class: 'logo' }, h('span', { class: 'logo-mark' }, icon('truck')), h('span', null, 'Trip Log')),
      h('h1', null, 'First start'), h('p', { class: 'sub' }, 'Create the admin account. Then add your staff on the Users page.'),
      h('form', { class: 'card', onsubmit: async (e) => {
        e.preventDefault();
        try { await api('POST', '/setup', { name: f.name.value, username: f.username.value, password: f.password.value }); window.SETUP_NEEDED = false; await loadMe(); location.hash = '#users'; render(); }
        catch (err) { toast(err.message, true); }
      } }, h('div', { class: 'form one-col' },
        h('label', { class: 'f' }, 'Your name', f.name), h('label', { class: 'f' }, 'Username (lowercase)', f.username),
        h('label', { class: 'f' }, 'Password (10+ characters)', f.password),
        h('button', { class: 'btn primary block', type: 'submit' }, 'Create admin account')))));
  }
  function renderLogin() {
    if (window.SETUP_NEEDED) return renderSetup();
    const u = h('input', { autocomplete: 'username', autocapitalize: 'none' });
    const p = h('input', { type: 'password', autocomplete: 'current-password' });
    const rem = h('input', { type: 'checkbox', class: 'check', checked: true });
    const go = async (username, password) => {
      try { await api('POST', '/login', { username, password, remember: rem.checked }); await loadMe(); location.hash = ''; render(); relinkPush(); }
      catch (e) { toast(e.message, true); }
    };
    const demo = window.DEMO_ACCOUNTS;
    $app().replaceChildren(h('div', { class: 'login' },
      h('div', { class: 'logo' }, h('span', { class: 'logo-mark' }, icon('truck')), h('span', null, 'Trip Log')),
      h('h1', null, 'Sign in'), h('p', { class: 'sub' }, 'Driver trips, hours and pay'),
      h('form', { class: 'card', onsubmit: (e) => { e.preventDefault(); go(u.value, p.value); } },
        h('div', { class: 'form one-col' },
          h('label', { class: 'f' }, 'Username', u), h('label', { class: 'f' }, 'Password', p),
          h('label', { class: 'remember' }, rem, h('span', null, 'Keep me signed in on this device', h('span', { class: 'small muted block' }, 'Untick on shared computers'))),
          h('button', { class: 'btn primary block', type: 'submit' }, 'Sign in')),
        h('p', { class: 'small muted mb0' }, 'Forgot your password? Ask your admin to reset it.')),
      demo ? h('div', { class: 'card' }, h('b', null, 'Try a demo account'),
        h('p', { class: 'small muted' }, `Each role sees different menus. Password: ${demo.password}`),
        h('div', { class: 'demo-list' }, demo.users.map(([id, label]) => h('button', { class: 'btn small', onclick: () => go(id, demo.password) }, label)))) : null));
  }

  // ---------- shell ----------
  async function loadMe() {
    try { me = await api('GET', '/me'); csrf = me.csrf; } catch (e) { me = null; }
  }
  let timer = null;
  let routeSeq = 0;
  async function route() {
    const mine = ++routeSeq;
    if (!me) return renderLogin();
    if (me.must_change_pw) return renderForcedPassword();
    const pages = me.pages;
    let id = location.hash.replace('#', '');
    // Default page: Today for office staff, My Trips for drivers, otherwise the first work page
    const home = pages.find((p) => p.id === 'today') || pages.find((p) => p.id !== 'my' || me.user.roles.includes('driver')) || pages[0];
    if (id !== 'guide' && !pages.find((p) => p.id === id)) id = home ? home.id : '';
    document.querySelectorAll('a[data-id]').forEach((a) => { const on = a.dataset.id === id; a.classList.toggle('on', on); if (on) a.setAttribute('aria-current', 'page'); else a.removeAttribute('aria-current'); });
    const more = document.querySelector('.bottom .more-btn'); if (more) more.classList.toggle('on', !!document.querySelector('.bottom') && ![...document.querySelectorAll('.bottom a[data-id]')].some((a) => a.dataset.id === id));
    const main = document.querySelector('main');
    const fresh = h('main');
    if (me.app_version !== L.APP_VERSION) fresh.append(h('div', { class: 'notice' }, icon('alert'),
      h('span', null, 'The app files were updated but the server is still running the old version. Stop it (Ctrl+C) and start it again with npm run demo.')));
    if (id !== 'guide' && !guideSeen()) fresh.append(h('div', { class: 'notice info guide-tip' }, icon('help'),
      h('span', { class: 'grow' }, 'New here? A one-page guide shows how to use Trip Log.'),
      h('a', { class: 'btn small primary', href: '#guide' }, 'Open guide'),
      h('button', { class: 'btn small ghost', onclick: (e) => { markGuideSeen(); e.currentTarget.closest('.guide-tip').remove(); } }, 'Hide')));
    clearInterval(timer);
    try { if (PAGE_FN[id]) await PAGE_FN[id](fresh); else fresh.append(h('p', { class: 'empty' }, 'No pages available for your role.')); }
    catch (e) { fresh.append(h('div', { class: 'notice' }, e.message)); }
    if (mine !== routeSeq) return; // drop this result if a newer page was opened meanwhile
    (document.querySelector('main') || main).replaceWith(fresh);
    if (id === 'board' || id === 'my' || id === 'today') timer = setInterval(() => { if (!document.querySelector('.modal-bg')) route(); }, 60000);
  }
  const initials = (n) => String(n || '?').split(/\s+/).filter(Boolean).slice(0, 2).map((x) => x[0].toUpperCase()).join('');
  async function signOut() {
    await flushPending();
    await disablePush(); // a shared phone should not keep getting this person's alerts
    await api('POST', '/logout').catch(() => {}); me = null; notes = { unread: 0, items: [] }; location.hash = ''; render();
  }
  function moreSheet(rest) {
    const close = modal('Menu', h('div', null,
      h('div', { class: 'nav-list' }, rest.map((p) => h('a', { href: '#' + p.id, 'data-id': p.id, onclick: () => close() }, icon(PAGE_ICON[p.id] || 'board'), p.label))),
      h('div', { class: 'nav-list' }, h('a', { href: '#guide', onclick: () => close() }, icon('help'), 'Quick guide')),
      h('div', { class: 'row mt12' }, h('button', { class: 'btn block', onclick: () => { close(); signOut(); } }, icon('logout', 'sm'), 'Sign out'))));
  }
  function render() {
    if (!me) return renderLogin();
    if (me.must_change_pw) return renderForcedPassword();
    const roles = me.user.roles.map((r) => L.ROLES[r]).join(', ');
    const link = (p) => h('a', { href: '#' + p.id, 'data-id': p.id }, icon(PAGE_ICON[p.id] || 'board'), h('span', null, p.label));
    // Phones: up to 4 tabs at the bottom, the rest under More. Desktop: sidebar with everything.
    const primary = me.pages.length <= 5 ? me.pages : me.pages.slice(0, 4);
    const rest = me.pages.filter((p) => !primary.includes(p));
    $app().replaceChildren(h('div', { class: 'shell' },
      h('aside', { class: 'side' },
        h('a', { class: 'logo', href: '#' }, h('span', { class: 'logo-mark' }, icon('truck')), h('span', null, 'Trip Log')),
        me.demo ? h('span', { class: 'chip warn demo-chip' }, 'Demo data') : null,
        h('nav', { class: 'nav-list', 'aria-label': 'Main' }, me.pages.map(link)),
        h('div', { class: 'side-tools' },
          h('button', { class: 'side-tool', type: 'button', onclick: openNotes }, h('span', { class: 'bell' }, icon('bell'), h('span', { class: 'bell-badge', hidden: true })), 'Notifications'),
          h('a', { class: 'side-tool', href: '#guide' }, icon('help'), 'Quick guide')),
        h('div', { class: 'me' }, h('button', { class: 'me-btn', type: 'button', onclick: accountSheet, title: 'Account' }, h('span', { class: 'avatar' }, initials(me.user.name)), h('span', { class: 'who' }, h('b', null, me.user.name), h('small', null, roles))),
          h('button', { class: 'icon-btn', 'aria-label': 'Sign out', title: 'Sign out', onclick: signOut }, icon('logout')))),
      h('div', { class: 'content' },
        h('header', { class: 'topbar' },
          h('a', { class: 'logo', href: '#' }, h('span', { class: 'logo-mark' }, icon('truck')), h('span', null, 'Trip Log')),
          me.demo ? h('span', { class: 'chip warn demo-chip' }, 'Demo') : null,
          h('span', { class: 'spacer' }),
          h('a', { class: 'icon-btn', href: '#guide', 'aria-label': 'Quick guide', title: 'Quick guide' }, icon('help')),
          bellBtn(),
          h('button', { class: 'avatar avatar-btn', type: 'button', 'aria-label': 'Account', title: `${roles} - ${me.user.name}`, onclick: accountSheet }, initials(me.user.name))),
        h('main'),
        h('nav', { class: 'bottom', 'aria-label': 'Main' }, primary.map(link),
          rest.length ? h('button', { class: 'more-btn', onclick: () => moreSheet(rest) }, icon('more'), h('span', null, 'More')) : null))));
    route();
    drawBadges(); refreshNotes(false);
  }
  window.addEventListener('hashchange', () => me && route());
  // The browser can open (or show a saved copy of) the page before the server has finished starting, e.g. right after
  // start.bat. Then nothing on the sign-in page would work and the demo buttons would be missing, so wait for the server.
  function renderWaiting(tries) {
    $app().replaceChildren(h('div', { class: 'login' },
      h('div', { class: 'logo' }, h('span', { class: 'logo-mark' }, icon('truck')), h('span', null, 'Trip Log')),
      h('div', { class: 'card' }, h('h1', { class: 'm0' }, tries < 15 ? 'Starting Trip Log…' : 'Trip Log is not running'),
        h('p', { class: 'sub' }, tries < 15 ? 'Waiting for the app to start. This page opens by itself in a moment.'
          : 'This computer cannot reach the Trip Log server. Double-click start.bat again (or ask whoever runs the shared PC). This page keeps trying.'))));
  }
  (async () => {
    if (!window.MockAPI) {
      let st = null;
      for (let tries = 0; ; tries++) {
        st = await fetch('/api/setup', { cache: 'no-store' }).then((r) => (r.ok ? r.json() : null)).catch(() => null);
        if (st) break;
        renderWaiting(tries);
        await new Promise((r) => setTimeout(r, 2000));
      }
      window.SETUP_NEEDED = !!st.needed;
      const d = await fetch('/demo-accounts', { cache: 'no-store' }).then((r) => (r.ok ? r.json() : null)).catch(() => null);
      if (d && d.users && d.users.length) window.DEMO_ACCOUNTS = d;
    }
    await loadMe(); render();
  })();
})();
