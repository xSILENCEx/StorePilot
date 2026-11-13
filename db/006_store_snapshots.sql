create table store_snapshots (
  app_id text primary key,
  config_revision integer not null,
  current_snapshot jsonb not null,
  previous_snapshot jsonb,
  updated_at timestamptz not null default now()
);
