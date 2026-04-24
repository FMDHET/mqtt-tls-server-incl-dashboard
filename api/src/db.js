import pg from "pg";

export const pool = new pg.Pool({
  connectionString: process.env.DATABASE_URL
});

export async function migrate() {
  await pool.query(`
    create extension if not exists "uuid-ossp";

    create table if not exists users (
      id uuid primary key default uuid_generate_v4(),
      email text not null unique,
      name text not null,
      password_hash text not null,
      role text not null check (role in ('admin', 'user')),
      created_at timestamptz not null default now()
    );

    create table if not exists devices (
      id uuid primary key default uuid_generate_v4(),
      user_id uuid not null references users(id) on delete cascade,
      name text not null,
      client_id text not null,
      serial_number text not null,
      mqtt_username text not null unique,
      manufacturer text,
      model text,
      last_seen_at timestamptz,
      created_at timestamptz not null default now(),
      unique (client_id, serial_number)
    );

    alter table devices add column if not exists mqtt_username text;
    update devices set mqtt_username = client_id || '_' || serial_number where mqtt_username is null;
    alter table devices alter column mqtt_username set not null;
    create unique index if not exists devices_mqtt_username_idx on devices (mqtt_username);

    create table if not exists mqtt_credentials (
      username text primary key,
      password_hash text not null,
      salt text not null,
      is_superuser boolean not null default false,
      enabled boolean not null default true,
      device_id uuid references devices(id) on delete cascade,
      created_at timestamptz not null default now()
    );

    create table if not exists metric_configs (
      id uuid primary key default uuid_generate_v4(),
      device_id uuid references devices(id) on delete cascade,
      unique_id text not null unique,
      state_topic text not null,
      metric text not null,
      name text,
      device_class text,
      state_class text,
      unit text,
      raw_config jsonb not null,
      created_at timestamptz not null default now(),
      updated_at timestamptz not null default now()
    );

    create table if not exists readings (
      id bigserial primary key,
      device_id uuid not null references devices(id) on delete cascade,
      metric text not null,
      value double precision not null,
      unit text,
      raw_payload jsonb,
      created_at timestamptz not null default now()
    );

    create index if not exists readings_device_metric_created_idx
      on readings (device_id, metric, created_at desc);
  `);
}
