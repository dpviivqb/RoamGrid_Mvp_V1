create table if not exists public.exploration_sessions (
  id uuid primary key,
  anonymous_id text not null,
  started_at timestamptz not null,
  ended_at timestamptz not null,
  city_name text,
  distance_meters double precision not null default 0,
  discovered_grid_count integer not null default 0,
  exploration_percentage double precision not null default 0
);

create table if not exists public.location_points (
  id uuid primary key,
  session_id uuid not null references public.exploration_sessions(id) on delete cascade,
  lat double precision not null,
  lng double precision not null,
  timestamp timestamptz not null
);

create table if not exists public.discovered_grids (
  id uuid primary key,
  anonymous_id text not null,
  grid_id text not null,
  discovered_at timestamptz not null
);

alter table public.exploration_sessions enable row level security;
alter table public.location_points enable row level security;
alter table public.discovered_grids enable row level security;

revoke all on table public.exploration_sessions from anon, authenticated;
revoke all on table public.location_points from anon, authenticated;
revoke all on table public.discovered_grids from anon, authenticated;

grant usage on schema public to anon;
grant insert on table public.exploration_sessions to anon;
grant insert on table public.location_points to anon;
grant insert on table public.discovered_grids to anon;

drop policy if exists "anon can insert exploration sessions" on public.exploration_sessions;
create policy "anon can insert exploration sessions"
on public.exploration_sessions
for insert
to anon
with check (true);

drop policy if exists "anon can insert location points" on public.location_points;
create policy "anon can insert location points"
on public.location_points
for insert
to anon
with check (true);

drop policy if exists "anon can insert discovered grids" on public.discovered_grids;
create policy "anon can insert discovered grids"
on public.discovered_grids
for insert
to anon
with check (true);
