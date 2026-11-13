create table if not exists workspaces (id text primary key, revision integer not null default 0, apps text not null default '[]', updated_at text not null);
insert or ignore into workspaces values ('default',0,'[]',strftime('%Y-%m-%dT%H:%M:%fZ','now'));
create table if not exists assets (id text primary key,mime text not null,width integer not null,height integer not null,bytes integer not null,created_at text not null);
create table if not exists connection_configs (id text primary key,scope text not null,app_id text,fields text not null,secret text not null,revision integer not null default 1,verification text,updated_at text not null);
create table if not exists jobs (id text primary key,app_id text not null,platform text not null,kind text not null,status text not null default 'queued',input text not null,result text,created_at text not null,updated_at text not null);
create index if not exists jobs_status_created on jobs(status,created_at);
create table if not exists job_logs (id integer primary key autoincrement,job_id text not null references jobs(id) on delete cascade,step text not null,message text not null,created_at text not null);
create table if not exists store_snapshots (app_id text primary key,config_revision integer not null,current_snapshot text not null,previous_snapshot text,updated_at text not null);
create table if not exists worker_lease (id integer primary key check(id=1),owner text not null,expires_at integer not null);
