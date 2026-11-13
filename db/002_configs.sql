create table if not exists connection_configs (
 id text primary key, scope text not null check(scope in ('apple','google','text','image')), app_id text,
 fields jsonb not null, secret text not null, revision integer not null default 1,
 updated_at timestamptz not null default now(),
 check ((scope in ('apple','google') and app_id is not null) or (scope in ('text','image') and app_id is null))
);
