-- 067「上次啥时候」云端备份表
-- 环境：E-01 共享环境 p059-prompter-d6gzk482uf502540d（ap-shanghai，PostgreSQL + PostgREST）
-- 形态：单表、只做手动备份/恢复；本地 IndexedDB 始终是主库，不做实时同步。
-- 隔离判据与 043 一致：表前缀 p067_ + app_id = '067' + owner_uid = (select auth.jwt()->>'sub')
-- 该脚本已在 CloudBase 控制台 SQL 编辑器整批执行并通过回读校验（2026-11-11）。

create table if not exists public.p067_snapshots (
  id text primary key,
  app_id text not null default '067' check (app_id = '067'),
  owner_uid text not null default (auth.jwt() ->> 'sub'),
  schema_version integer not null default 1 check (schema_version >= 1),
  item_count integer not null default 0 check (item_count >= 0),
  event_count integer not null default 0 check (event_count >= 0),
  checksum text not null,
  payload jsonb not null,
  device_label text,
  created_at timestamptz not null default now()
);

create index if not exists p067_snapshots_owner_created_idx
  on public.p067_snapshots (owner_uid, created_at desc);

alter table public.p067_snapshots enable row level security;

drop policy if exists p067_snapshots_select on public.p067_snapshots;
create policy p067_snapshots_select on public.p067_snapshots
  for select to authenticated
  using (app_id = '067' and owner_uid = (select auth.jwt() ->> 'sub'));

drop policy if exists p067_snapshots_insert on public.p067_snapshots;
create policy p067_snapshots_insert on public.p067_snapshots
  for insert to authenticated
  with check (app_id = '067' and owner_uid = (select auth.jwt() ->> 'sub'));

drop policy if exists p067_snapshots_update on public.p067_snapshots;
create policy p067_snapshots_update on public.p067_snapshots
  for update to authenticated
  using (app_id = '067' and owner_uid = (select auth.jwt() ->> 'sub'))
  with check (app_id = '067' and owner_uid = (select auth.jwt() ->> 'sub'));

drop policy if exists p067_snapshots_delete on public.p067_snapshots;
create policy p067_snapshots_delete on public.p067_snapshots
  for delete to authenticated
  using (app_id = '067' and owner_uid = (select auth.jwt() ->> 'sub'));

grant select, insert, update, delete on table public.p067_snapshots to authenticated;
