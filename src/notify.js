'use strict';
// In-app notifications (bell) + optional phone/desktop push (free Web Push, no paid service).
// Push keys (VAPID) are generated on first use and kept in the settings table.
const db = require('./db');
const L = require('../shared/logic');

let webpush = null;
try { webpush = require('web-push'); } catch (e) { webpush = null; } // push is optional; the bell works without it

let vapid = null;
async function vapidKeys() {
  if (vapid || !webpush) return vapid;
  const { rows: [r] } = await db.query(`select value from settings where key = 'vapid'`);
  if (r) vapid = r.value;
  else {
    vapid = webpush.generateVAPIDKeys();
    await db.query(`insert into settings(key, value) values ('vapid', $1) on conflict (key) do nothing`, [JSON.stringify(vapid)]);
    const { rows: [again] } = await db.query(`select value from settings where key = 'vapid'`);
    vapid = again.value;
  }
  return vapid;
}
async function publicKey() { const k = await vapidKeys(); return k ? k.publicKey : null; }

// Active users holding any of the permissions
async function usersWith(perms, exclude = []) {
  const { rows } = await db.query(
    `select u.id, array_agg(r.role) as roles from users u join user_roles r on r.user_id = u.id where u.active group by u.id`);
  return rows.filter((u) => !exclude.includes(u.id) && perms.some((p) => L.permsFor(u.roles).has(p))).map((u) => u.id);
}

// key makes a notification once-only per person (e.g. one long-trip alert per trip)
async function notify(userIds, { kind, title, body = '', link = '', key = null }) {
  const sent = [];
  for (const uid of [...new Set(userIds)]) {
    const { rows } = await db.query(
      `insert into notifications(user_id, kind, title, body, link, dedupe_key) values ($1,$2,$3,$4,$5,$6)
       on conflict (user_id, dedupe_key) do nothing returning id`,
      [uid, kind, title.slice(0, 120), String(body).slice(0, 300), link.slice(0, 100), key]);
    if (rows.length) sent.push(uid);
  }
  if (sent.length) push(sent, { title, body, link }).catch((e) => console.error('push:', e.message));
  return sent.length;
}
// Never let a notification problem break the action that caused it
const safeNotify = (ids, n) => Promise.resolve(ids).then((x) => notify(x, n)).catch((e) => console.error('notify:', e.message));

async function push(userIds, payload) {
  const k = await vapidKeys();
  if (!k) return;
  webpush.setVapidDetails(process.env.PUSH_CONTACT || 'mailto:trip-log@example.com', k.publicKey, k.privateKey);
  const { rows } = await db.query('select * from push_subs where user_id = any($1::int[])', [userIds]);
  for (const s of rows) {
    try {
      await webpush.sendNotification({ endpoint: s.endpoint, keys: { p256dh: s.p256dh, auth: s.auth } }, JSON.stringify(payload), { TTL: 6 * 3600 });
    } catch (e) {
      if (e.statusCode === 404 || e.statusCode === 410) await db.query('delete from push_subs where id = $1', [s.id]); // phone unsubscribed
      else console.error('push send:', e.statusCode || e.message);
    }
  }
}

// Every 5 minutes: alert admins and schedulers about trips running past the long-trip limit
async function watchLongTrips() {
  const { rows: [s] } = await db.query(`select value from settings where key = 'long_trip_warn_hours'`);
  const hours = Number(s ? s.value : 13) || 13;
  const { rows } = await db.query(
    `select t.id, t.trip_no, u.name as driver, e.occurred_at from trips t join users u on u.id = t.driver_id
       join lateral (select occurred_at from trip_events where trip_id = t.id and type = 'depart' order by id desc limit 1) e on true
      where t.status in ('in_progress','returning') and e.occurred_at < now() - make_interval(mins => $1::int)`, [Math.round(hours * 60)]);
  if (!rows.length) return;
  const ids = await usersWith(['users.manage', 'board.view']);
  for (const t of rows) {
    await notify(ids, { kind: 'long_trip', title: `Over ${hours} h on the road: ${t.driver}`, body: `Trip ${t.trip_no} was accepted ${Math.floor((Date.now() - new Date(t.occurred_at)) / 3600000)} h ago and is not finished.`, link: '#board', key: `long:${t.id}` });
  }
}
function startWatcher() {
  const run = () => watchLongTrips().then(() => db.query(`delete from notifications where created_at < now() - interval '60 days'`)).catch((e) => console.error('watcher:', e.message));
  setTimeout(run, 10000);
  return setInterval(run, 5 * 60000);
}

module.exports = { notify, safeNotify, usersWith, publicKey, startWatcher, watchLongTrips };
