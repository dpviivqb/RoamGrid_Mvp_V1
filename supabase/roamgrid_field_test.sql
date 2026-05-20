create table if not exists public.exploration_sessions (
  id uuid primary key,
  anonymous_id text not null,
  user_id uuid references auth.users(id) on delete set null,
  started_at timestamptz not null,
  ended_at timestamptz not null,
  city_name text,
  admin_area_id text,
  admin_area_name text,
  admin_area_display_name text,
  admin_level text,
  admin_source text,
  admin_area_m2 double precision,
  place_parent_label_en text,
  place_parent_label_zh text,
  place_full_label_en text,
  place_full_label_zh text,
  map_snapshot_data_url text,
  map_snapshot_storage_path text,
  map_snapshot_version integer,
  total_grid_count integer,
  distance_meters double precision not null default 0,
  discovered_grid_count integer not null default 0,
  exploration_percentage double precision not null default 0
);

create table if not exists public.location_points (
  id uuid primary key,
  user_id uuid references auth.users(id) on delete set null,
  session_id uuid not null references public.exploration_sessions(id) on delete cascade,
  lat double precision not null,
  lng double precision not null,
  timestamp timestamptz not null
);

create table if not exists public.discovered_grids (
  id uuid primary key,
  anonymous_id text not null,
  user_id uuid references auth.users(id) on delete set null,
  session_id uuid references public.exploration_sessions(id) on delete set null,
  admin_area_id text,
  grid_id text not null,
  discovered_at timestamptz not null
);

alter table public.exploration_sessions add column if not exists user_id uuid references auth.users(id) on delete set null;
alter table public.exploration_sessions add column if not exists admin_area_id text;
alter table public.exploration_sessions add column if not exists admin_area_name text;
alter table public.exploration_sessions add column if not exists admin_area_display_name text;
alter table public.exploration_sessions add column if not exists admin_level text;
alter table public.exploration_sessions add column if not exists admin_source text;
alter table public.exploration_sessions add column if not exists admin_area_m2 double precision;
alter table public.exploration_sessions add column if not exists place_parent_label_en text;
alter table public.exploration_sessions add column if not exists place_parent_label_zh text;
alter table public.exploration_sessions add column if not exists place_full_label_en text;
alter table public.exploration_sessions add column if not exists place_full_label_zh text;
alter table public.exploration_sessions add column if not exists map_snapshot_data_url text;
alter table public.exploration_sessions add column if not exists map_snapshot_storage_path text;
alter table public.exploration_sessions add column if not exists map_snapshot_version integer;
alter table public.exploration_sessions add column if not exists total_grid_count integer;

alter table public.location_points add column if not exists user_id uuid references auth.users(id) on delete set null;

alter table public.discovered_grids add column if not exists user_id uuid references auth.users(id) on delete set null;
alter table public.discovered_grids add column if not exists session_id uuid references public.exploration_sessions(id) on delete set null;
alter table public.discovered_grids add column if not exists admin_area_id text;

create index if not exists exploration_sessions_user_ended_at_idx
on public.exploration_sessions (user_id, ended_at desc);

create index if not exists location_points_user_session_timestamp_idx
on public.location_points (user_id, session_id, timestamp);

create index if not exists discovered_grids_user_admin_idx
on public.discovered_grids (user_id, admin_area_id);

create unique index if not exists discovered_grids_user_admin_grid_uidx
on public.discovered_grids (user_id, admin_area_id, grid_id);

alter table public.exploration_sessions enable row level security;
alter table public.location_points enable row level security;
alter table public.discovered_grids enable row level security;

revoke all on table public.exploration_sessions from anon, authenticated;
revoke all on table public.location_points from anon, authenticated;
revoke all on table public.discovered_grids from anon, authenticated;

grant usage on schema public to anon, authenticated;
grant insert on table public.exploration_sessions to anon;
grant insert on table public.location_points to anon;
grant insert on table public.discovered_grids to anon;
grant insert, select, delete on table public.exploration_sessions to authenticated;
grant insert, select, delete on table public.location_points to authenticated;
grant insert, select, delete on table public.discovered_grids to authenticated;

drop policy if exists "anon can insert exploration sessions" on public.exploration_sessions;
create policy "anon can insert exploration sessions"
on public.exploration_sessions
for insert
to anon
with check (user_id is null);

drop policy if exists "anon can insert location points" on public.location_points;
create policy "anon can insert location points"
on public.location_points
for insert
to anon
with check (user_id is null);

drop policy if exists "anon can insert discovered grids" on public.discovered_grids;
create policy "anon can insert discovered grids"
on public.discovered_grids
for insert
to anon
with check (user_id is null);

drop policy if exists "authenticated can insert own exploration sessions" on public.exploration_sessions;
create policy "authenticated can insert own exploration sessions"
on public.exploration_sessions
for insert
to authenticated
with check ((select auth.uid()) = user_id);

drop policy if exists "authenticated can read own exploration sessions" on public.exploration_sessions;
create policy "authenticated can read own exploration sessions"
on public.exploration_sessions
for select
to authenticated
using ((select auth.uid()) = user_id);

drop policy if exists "authenticated can delete own exploration sessions" on public.exploration_sessions;
create policy "authenticated can delete own exploration sessions"
on public.exploration_sessions
for delete
to authenticated
using ((select auth.uid()) = user_id);

drop policy if exists "authenticated can insert own location points" on public.location_points;
create policy "authenticated can insert own location points"
on public.location_points
for insert
to authenticated
with check ((select auth.uid()) = user_id);

drop policy if exists "authenticated can read own location points" on public.location_points;
create policy "authenticated can read own location points"
on public.location_points
for select
to authenticated
using ((select auth.uid()) = user_id);

drop policy if exists "authenticated can delete own location points" on public.location_points;
create policy "authenticated can delete own location points"
on public.location_points
for delete
to authenticated
using ((select auth.uid()) = user_id);

drop policy if exists "authenticated can insert own discovered grids" on public.discovered_grids;
create policy "authenticated can insert own discovered grids"
on public.discovered_grids
for insert
to authenticated
with check ((select auth.uid()) = user_id);

drop policy if exists "authenticated can read own discovered grids" on public.discovered_grids;
create policy "authenticated can read own discovered grids"
on public.discovered_grids
for select
to authenticated
using ((select auth.uid()) = user_id);

drop policy if exists "authenticated can delete own discovered grids" on public.discovered_grids;
create policy "authenticated can delete own discovered grids"
on public.discovered_grids
for delete
to authenticated
using ((select auth.uid()) = user_id);

insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('exploration-snapshots', 'exploration-snapshots', false, 10485760, array['image/png'])
on conflict (id) do update
set public = false,
    file_size_limit = 10485760,
    allowed_mime_types = array['image/png'];

drop policy if exists "authenticated can read own exploration snapshots" on storage.objects;
create policy "authenticated can read own exploration snapshots"
on storage.objects
for select
to authenticated
using (
  bucket_id = 'exploration-snapshots'
  and (storage.foldername(name))[1] = (select auth.uid())::text
);

drop policy if exists "authenticated can insert own exploration snapshots" on storage.objects;
create policy "authenticated can insert own exploration snapshots"
on storage.objects
for insert
to authenticated
with check (
  bucket_id = 'exploration-snapshots'
  and (storage.foldername(name))[1] = (select auth.uid())::text
);

drop policy if exists "authenticated can update own exploration snapshots" on storage.objects;
create policy "authenticated can update own exploration snapshots"
on storage.objects
for update
to authenticated
using (
  bucket_id = 'exploration-snapshots'
  and (storage.foldername(name))[1] = (select auth.uid())::text
)
with check (
  bucket_id = 'exploration-snapshots'
  and (storage.foldername(name))[1] = (select auth.uid())::text
);

drop policy if exists "authenticated can delete own exploration snapshots" on storage.objects;
create policy "authenticated can delete own exploration snapshots"
on storage.objects
for delete
to authenticated
using (
  bucket_id = 'exploration-snapshots'
  and (storage.foldername(name))[1] = (select auth.uid())::text
);
