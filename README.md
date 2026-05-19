# RoamGrid MVP

RoamGrid turns real-world walking into an open-world map exploration game.

## Stack

- Next.js App Router
- TypeScript
- Tailwind CSS
- Mapbox GL JS
- Supabase JS client
- localStorage
- html2canvas

## Setup

```bash
npm install
cp .env.example .env.local
npm run dev
```

Add a Mapbox public token to `.env.local`:

```bash
NEXT_PUBLIC_MAPBOX_TOKEN=your_mapbox_token
```

Supabase is optional. When these values are present, finished sessions are synced in addition to localStorage:

```bash
NEXT_PUBLIC_SUPABASE_URL=your_supabase_url
NEXT_PUBLIC_SUPABASE_ANON_KEY=your_supabase_anon_key
```

## Supabase Tables

```sql
create table exploration_sessions (
  id uuid primary key,
  anonymous_id text,
  started_at timestamptz,
  ended_at timestamptz,
  city_name text,
  distance_meters float,
  discovered_grid_count int,
  exploration_percentage float
);

create table location_points (
  id uuid primary key,
  session_id uuid,
  lat float,
  lng float,
  timestamp timestamptz
);

create table discovered_grids (
  id uuid primary key,
  anonymous_id text,
  grid_id text,
  discovered_at timestamptz
);
```

## Pages

- `/` home page
- `/explore` real-time map exploration
- `/result` session summary and share card

## Phone Location Testing

Geolocation generally requires HTTPS or localhost. To test from a phone, expose the local dev server through a trusted tunnel, then open `/explore` on the phone and allow location access.
