create table if not exists screenshot_groups (
 id uuid primary key,app_id text not null,platform text not null check(platform in ('apple','google')),locale text not null,device text not null,
 settings jsonb not null,adopted jsonb not null default '[]',previous jsonb not null default '[]',revision integer not null default 1,
 updated_at timestamptz not null default now(),unique(app_id,platform,locale,device)
);
create table if not exists image_candidates (
 id uuid primary key,group_id uuid not null references screenshot_groups(id),job_id text references jobs(id),request_id uuid,
 status text not null default 'queued',settings jsonb not null,origin text not null,url text,thumbnail text,raw_url text,error text,discarded boolean not null default false,
 created_at timestamptz not null default now(),updated_at timestamptz not null default now(),unique(group_id,request_id)
);
create index if not exists image_candidates_group_idx on image_candidates(group_id,created_at desc);
create table if not exists image_calls (
 candidate_id uuid primary key references image_candidates(id),status text not null,config_revision integer not null,
 started_at timestamptz not null default now(),completed_at timestamptz
);
create sequence if not exists image_generation_slot;
