create table if not exists workspaces (id text primary key, revision integer not null default 0, apps jsonb not null default '[]', updated_at timestamptz not null default now());
insert into workspaces (id) values ('default') on conflict do nothing;
create table if not exists assets (id text primary key, mime text not null, width integer not null, height integer not null, bytes integer not null, created_at timestamptz not null default now());
create table if not exists jobs (id text primary key, app_id text not null, platform text not null, kind text not null, status text not null default 'queued', input jsonb not null, result jsonb, created_at timestamptz not null default now(), updated_at timestamptz not null default now());
create table if not exists job_logs (id bigserial primary key, job_id text not null references jobs(id), step text not null, message text not null, created_at timestamptz not null default now());
create index if not exists jobs_created_idx on jobs(created_at desc);
