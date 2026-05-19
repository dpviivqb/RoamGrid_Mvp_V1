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

## Vercel Field Test Deployment

Use the GitHub integration for the first outdoor MVP test:

1. Push `main` to `git@github.com:dpviivqb/RoamGrid_Mvp_V1.git`.
2. In Vercel, import the GitHub repository as a new project.
3. Keep the framework preset as `Next.js`, root directory as the repository root, build command as `npm run build`, install command as `npm install`, and output settings as the Vercel default.
4. Add these environment variables to both Production and Preview:

```bash
NEXT_PUBLIC_MAPBOX_TOKEN=your_mapbox_public_token
NEXT_PUBLIC_SUPABASE_URL=your_supabase_project_url
NEXT_PUBLIC_SUPABASE_ANON_KEY=your_supabase_anon_key
SUPABASE_SERVICE_ROLE_KEY=your_supabase_service_role_key
```

`SUPABASE_SERVICE_ROLE_KEY` is server-only and must not use the `NEXT_PUBLIC_` prefix. It is recommended for Vercel writes because the API route can save field-test data without exposing the key in the browser. If it is omitted, the API route falls back to `NEXT_PUBLIC_SUPABASE_ANON_KEY` and requires the insert-only RLS policies in `supabase/roamgrid_field_test.sql`.

5. If the Mapbox token uses URL restrictions, allow the production Vercel domain and any Preview domains you plan to test.
6. In Supabase SQL Editor, run `supabase/roamgrid_field_test.sql` before the phone test.
7. Redeploy in Vercel after changing any environment variable.
8. Open `/api/exploration-results` on the deployed site to verify the server sees the Supabase URL and write key. The response only reports booleans and never returns secrets.

For the phone test, open the production HTTPS URL at `/explore`, allow browser location permission, walk outdoors for at least 200-300 meters, finish the session, then verify `/result` and the three Supabase tables contain the run data.
