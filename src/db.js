'use strict';
// With DATABASE_URL set, connect to PostgreSQL (e.g. the Docker container on the company NAS).
// Without it, run on embedded PGlite (same PostgreSQL SQL, stored in a file) for development and demos.
const fs = require('fs');
const path = require('path');

let impl;
// Fills the address book from addresses already used on trips
// v0.8.3: first start with the truck list fills it from the plates already used on trips
const BACKFILL_TRUCKS = `insert into trucks(plate, vehicle_type) select distinct on (left(upper(trim(vehicle)), 20)) left(upper(trim(vehicle)), 20), vehicle_type from trips where trim(vehicle) <> '' order by left(upper(trim(vehicle)), 20), id desc on conflict do nothing;`;
const BACKFILL_ADDRESSES = `insert into addresses(address, use_count, last_used)
  select min(a), count(*), max(c) from (select pickup_location a, created_at c from trips
    union all select destination, created_at from trips) x group by lower(a) on conflict do nothing;`;

async function init() {
  const url = process.env.DATABASE_URL;
  if (url) {
    const { Pool } = require('pg');
    const pool = new Pool({
      connectionString: url,
      ssl: process.env.DATABASE_SSL === 'true' ? { rejectUnauthorized: true } : false,
      max: 10,
    });
    impl = {
      kind: 'postgres',
      query: (t, p) => pool.query(t, p),
      exec: (t) => pool.query(t),
      async tx(fn) {
        const c = await pool.connect();
        try {
          await c.query('BEGIN');
          const r = await fn({ query: (t, p) => c.query(t, p) });
          await c.query('COMMIT');
          return r;
        } catch (e) {
          await c.query('ROLLBACK');
          throw e;
        } finally {
          c.release();
        }
      },
    };
  } else {
    const { PGlite } = await import('@electric-sql/pglite');
    const dir = process.env.PGLITE_DIR || path.join(__dirname, '..', 'data', 'pglite');
    fs.mkdirSync(path.dirname(dir), { recursive: true });
    const db = new PGlite(dir);
    await db.waitReady;
    impl = {
      kind: 'pglite',
      query: (t, p) => db.query(t, p),
      exec: (t) => db.exec(t),
      tx: (fn) => db.transaction((tx) => fn({ query: (t, p) => tx.query(t, p) })),
    };
  }
  const { rows } = await impl.query(
    "select to_regclass('public.users') is not null as ok"
  );
  if (!rows[0].ok) {
    await impl.exec(fs.readFileSync(path.join(__dirname, 'schema.sql'), 'utf8'));
    return { fresh: true, kind: impl.kind };
  }
  // Upgrades for databases created by an older version (safe to run on every start)
  await impl.exec(`
    alter table users add column if not exists hourly_rate numeric(8,2);
    alter table users add column if not exists pay_profile jsonb not null default '{}'::jsonb;
    alter table pay_records add column if not exists ot_minutes int not null default 0;
    alter table pay_records add column if not exists vacation_pay numeric(10,2) not null default 0;
    alter table pay_records add column if not exists stat_minutes int not null default 0;
    alter table pay_records add column if not exists double_minutes int not null default 0;
    alter table pay_records add column if not exists callin_minutes int not null default 0;
    alter table pay_records add column if not exists meal_paid boolean not null default false;
create table if not exists holiday_pay (
      id            serial primary key,
      driver_id     int not null references users(id),
      holiday       date not null,
      name          text not null,
      days_worked   int not null default 0,
      avg_day_pay   numeric(10,2) not null default 0,
      vacation_pay  numeric(10,2) not null default 0,
      amount        numeric(10,2) not null,
      approved_by   int not null references users(id),
      approved_at   timestamptz not null default now(),
      paid_by       int references users(id),
      paid_at       timestamptz,
      payment_ref   text,
      unique (driver_id, holiday)
    );
    alter table users add column if not exists must_change_pw boolean not null default false;
    -- v0.7: the separate Receiving role was merged into Logistics Manager
    insert into user_roles(user_id, role) select user_id, 'logistics' from user_roles where role = 'receiver' on conflict do nothing;
    delete from user_roles where role = 'receiver';
    alter table sessions add column if not exists remember boolean not null default false;
    alter table trips add column if not exists vehicle_type text;
    alter table trips add column if not exists team_id int references trips(id);
    create table if not exists vehicle_types (
      id serial primary key, name text not null check (length(name) between 1 and 40), created_at timestamptz not null default now());
    create unique index if not exists vehicle_types_lower on vehicle_types (lower(name));
    -- v0.8.2: early start requests
    create table if not exists early_start_requests (
      id            serial primary key,
      trip_id       int not null references trips(id),
      requested_by  int not null references users(id),
      reason        text check (reason is null or length(reason) <= 300),
      status        text not null default 'pending' check (status in ('pending','approved','declined')),
      decided_by    int references users(id),
      decided_at    timestamptz,
      decline_reason text check (decline_reason is null or length(decline_reason) <= 300),
      created_at    timestamptz not null default now()
    );
    create index if not exists early_start_trip on early_start_requests(trip_id);
    create unique index if not exists early_start_one_open on early_start_requests(trip_id) where status = 'pending';
create table if not exists notifications (
  id          serial primary key,
  user_id     int not null references users(id),
  kind        text not null,
  title       text not null,
  body        text not null default '',
  link        text not null default '',
  dedupe_key  text,
  created_at  timestamptz not null default now(),
  read_at     timestamptz
);
create index if not exists notifications_user on notifications(user_id, id);
create unique index if not exists notifications_once on notifications(user_id, dedupe_key);
create table if not exists push_subs (
  id          serial primary key,
  user_id     int not null references users(id),
  endpoint    text not null unique check (length(endpoint) <= 1000),
  p256dh      text not null,
  auth        text not null,
  created_at  timestamptz not null default now()
);`);
  // v0.8.0: the demo account Jaskaran (logistics) also gets the Scheduler role, so existing demo databases need no reset
  await impl.exec(`insert into user_roles(user_id, role) select u.id, 'scheduler' from users u
    where u.username = 'logistics' and u.name = 'Jaskaran'
      and exists (select 1 from user_roles r where r.user_id = u.id and r.role = 'logistics')
      and not exists (select 1 from user_roles r where r.user_id = u.id and r.role = 'scheduler')
      and not exists (select 1 from audit_log a where a.action = 'user.update' and a.entity_id = u.id::text)`);
  // Default vehicle types only when the list has never had any entry (the admin may add more later)
  await impl.exec(`insert into vehicle_types(name) select x from (values ('10 ton truck'), ('5 ton truck')) v(x)
    where not exists (select 1 from vehicle_types) and not exists (select 1 from trips where vehicle_type is not null)`);
  const { rows: [tk] } = await impl.query("select to_regclass('public.trucks') is not null as ok");
  if (!tk.ok) await impl.exec(`create table trucks (
      id           serial primary key,
      plate        text not null check (length(plate) between 1 and 20),
      vehicle_type text,
      active       boolean not null default true,
      created_by   int references users(id),
      created_at   timestamptz not null default now()
    );
    create unique index trucks_plate_lower on trucks (lower(plate));
    ${BACKFILL_TRUCKS}`);
  const { rows: [ab] } = await impl.query("select to_regclass('public.addresses') is not null as ok");
  if (!ab.ok) {
    // First start after the address book was added: create it and fill it from existing trips
    await impl.exec(`
      create table addresses (
        id serial primary key, address text not null check (length(address) between 1 and 200),
        use_count int not null default 0, last_used timestamptz, created_by int references users(id),
        created_at timestamptz not null default now());
      create unique index addresses_lower on addresses (lower(address));
      ${BACKFILL_ADDRESSES}`);
  }
  return { fresh: false, kind: impl.kind };
}

// Demo reset: only the local demo (npm run demo / start.bat / start-shared.bat) on the embedded database with DEMO_LOGIN=true.
// Never available on the NAS (PostgreSQL via DATABASE_URL), whatever the other settings are.
const demoResetAllowed = () => process.env.DEMO_LOGIN === 'true' && !process.env.DATABASE_URL && !!impl && impl.kind === 'pglite';

// Deletes every table and creates them again empty (the caller then loads the demo data). Keeps the push keys.
async function wipeForDemo() {
  if (!demoResetAllowed()) throw new Error('demo reset is not allowed on this database');
  const { rows: [vapid] } = await impl.query(`select value from settings where key = 'vapid'`);
  await impl.exec('drop schema public cascade; create schema public;');
  await impl.exec(fs.readFileSync(path.join(__dirname, 'schema.sql'), 'utf8'));
  if (vapid) await impl.query(`insert into settings(key, value) values ('vapid', $1)`, [JSON.stringify(vapid.value)]);
}

module.exports = {
  BACKFILL_ADDRESSES,
  BACKFILL_TRUCKS,
  init,
  demoResetAllowed,
  wipeForDemo,
  query: (t, p) => impl.query(t, p),
  tx: (fn) => impl.tx(fn),
  get kind() { return impl && impl.kind; },
};
