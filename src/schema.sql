-- Trip tracking schema (PostgreSQL)
-- Rule: trip events and the audit log cannot be updated or deleted (blocked by triggers). Corrections append new events.

create table users (
  id              serial primary key,
  username        text not null unique check (username ~ '^[a-z0-9._-]{3,40}$'),
  name            text not null check (length(name) between 1 and 80),
  phone           text,
  password_hash   text not null,
  active          boolean not null default true,
  failed_attempts int not null default 0,
  locked_until    timestamptz,
  hourly_rate     numeric(8,2),          -- driver's own rate; null = company rate in Settings
  pay_profile     jsonb not null default '{}'::jsonb,  -- overtime rule, vacation %, meal break (see shared/logic.js)
  must_change_pw  boolean not null default false,       -- temporary password set by an admin
  created_at      timestamptz not null default now()
);

create table user_roles (
  user_id int not null references users(id),
  role    text not null check (role in ('admin','driver','scheduler','logistics','receiver','payer','accounting')),
  primary key (user_id, role)
);

create table sessions (
  token_hash  text primary key,          -- SHA-256 of the cookie value. The raw token is never stored
  user_id     int not null references users(id),
  csrf_token  text not null,
  created_at  timestamptz not null default now(),
  last_seen   timestamptz not null default now(),
  expires_at  timestamptz not null,
  remember    boolean not null default false  -- "Keep me signed in on this device"
);
create index on sessions(user_id);

create table settings (
  key   text primary key,
  value jsonb not null
);

-- Vehicle types offered in Assign trips (10 ton, 5 ton ...). Scheduler/admin can add more with one button.
create table vehicle_types (
  id         serial primary key,
  name       text not null check (length(name) between 1 and 40),
  created_at timestamptz not null default now()
);
create unique index vehicle_types_lower on vehicle_types (lower(name));
insert into vehicle_types(name) values ('10 ton truck'), ('5 ton truck');

create table trips (
  id                 serial primary key,
  trip_no            text not null unique,
  driver_id          int not null references users(id),
  vehicle            text not null,
  vehicle_type       text,
  team_id            int references trips(id),
  pickup_location    text not null,
  destination        text not null,
  planned_departure  timestamptz not null,
  planned_hours      numeric(5,2),
  cargo_ref          text,
  status             text not null default 'dispatched'
                     check (status in ('dispatched','in_progress','returning','returned','received','approved','paid','cancelled')),
  created_by         int not null references users(id),
  created_at         timestamptz not null default now()
);
create index on trips(driver_id);
create index on trips(status);

create table trip_events (
  id           serial primary key,
  trip_id      int not null references trips(id),
  type         text not null check (type in ('depart','pickup_done','return','receipt')),
  occurred_at  timestamptz not null,
  recorded_by  int not null references users(id),
  method       text not null check (method in ('button','correction','receipt')),
  data         jsonb not null default '{}'::jsonb,
  created_at   timestamptz not null default now()
);
create index on trip_events(trip_id);

create table trip_memos (
  id         serial primary key,
  trip_id    int not null references trips(id),
  author_id  int not null references users(id),
  note       text not null check (length(note) between 1 and 1000),
  created_at timestamptz not null default now()
);

create table correction_requests (
  id              serial primary key,
  trip_id         int not null references trips(id),
  event_type      text not null check (event_type in ('depart','pickup_done','return')),
  requested_time  timestamptz not null,
  reason          text not null check (length(reason) between 1 and 1000),
  requested_by    int not null references users(id),
  status          text not null default 'pending'
                  check (status in ('pending','first_approved','approved','rejected')),
  first_by        int references users(id),
  first_at        timestamptz,
  final_by        int references users(id),
  final_at        timestamptz,
  reject_reason   text,
  result_event_id int references trip_events(id),
  created_at      timestamptz not null default now()
);

create table pay_records (
  id                  serial primary key,
  trip_id             int not null unique references trips(id),
  recorded_minutes    int not null,
  recognized_minutes  int not null,
  ot_minutes          int not null default 0,
  stat_minutes        int not null default 0,   -- worked on a stat holiday (holiday rate)
  double_minutes      int not null default 0,   -- stat holiday hours past the double-time limit
  callin_minutes      int not null default 0,   -- minimum daily pay top-up
  meal_paid           boolean not null default false, -- break paid because the driver stayed on call
  hourly_rate         numeric(8,2),
  vacation_pay        numeric(10,2) not null default 0,
  amount              numeric(10,2),
  adjustment_reason   text,
  approved_by         int not null references users(id),
  approved_at         timestamptz not null default now(),
  paid_by             int references users(id),
  paid_at             timestamptz,
  payment_ref         text
);

-- Stat holiday pay for a holiday the driver did not work (average day's pay)
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

create table audit_log (
  id        bigserial primary key,
  at        timestamptz not null default now(),
  user_id   int references users(id),
  action    text not null,
  entity    text,
  entity_id text,
  detail    jsonb not null default '{}'::jsonb,
  ip        text
);

create function forbid_change() returns trigger language plpgsql as $$
begin
  raise exception 'append-only table: % cannot be changed', tg_table_name;
end $$;

create trigger trip_events_append_only before update or delete on trip_events
  for each row execute function forbid_change();
create trigger audit_log_append_only before update or delete on audit_log
  for each row execute function forbid_change();
create trigger trip_memos_append_only before update or delete on trip_memos
  for each row execute function forbid_change();

-- Approved pay values are locked; only the paid_* fields can be filled in, once
create function pay_records_guard() returns trigger language plpgsql as $$
begin
  if tg_op = 'DELETE' then raise exception 'pay_records cannot be deleted'; end if;
  if (new.trip_id, new.recorded_minutes, new.recognized_minutes, new.hourly_rate, new.amount,
      new.adjustment_reason, new.approved_by, new.approved_at)
     is distinct from
     (old.trip_id, old.recorded_minutes, old.recognized_minutes, old.hourly_rate, old.amount,
      old.adjustment_reason, old.approved_by, old.approved_at) then
    raise exception 'approved pay values are locked';
  end if;
  if old.paid_at is not null then raise exception 'already paid'; end if;
  return new;
end $$;
create trigger pay_records_lock before update or delete on pay_records
  for each row execute function pay_records_guard();

create table addresses (
  id          serial primary key,
  address     text not null check (length(address) between 1 and 200),
  use_count   int not null default 0,
  last_used   timestamptz,
  created_by  int references users(id),
  created_at  timestamptz not null default now()
);
create unique index addresses_lower on addresses (lower(address));

-- Early start: a driver asks to accept a trip before the accept window opens; a Scheduler/Admin approves or declines (v0.8.2)
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

-- Notifications (bell) and Web Push subscriptions
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
);
