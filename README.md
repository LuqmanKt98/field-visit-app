# Field Visit Management App

A mobile-friendly app for real estate field reps: enter a Task ID (or open a direct
link), see the property location and live distance on a map, and once within range
capture 10 photos + 1 video (each stamped with compass direction and timestamp) that
upload straight to AWS S3. Admins log in separately to browse/search all tasks.

## How it works

1. Rep enters a Task ID at `/`, or opens `https://<domain>/?taskid=345667896` directly.
2. `GET /api/tasks/:taskId` loads the property address/location from Postgres.
3. The browser tracks the rep's GPS position and shows both points on a Google Map,
   with the live distance between them.
4. Once the rep is within `CAMERA_UNLOCK_DISTANCE_METERS` (default 100m, configurable),
   the camera unlocks.
5. Each photo/video is captured via `getUserMedia`, with direction (N/S/E/W…) and the
   timestamp drawn directly onto the pixels (canvas), then uploaded as it's taken in
   two steps: `POST /api/tasks/:taskId/media/presign` returns a short-lived S3 URL
   (after re-validating distance), the browser `PUT`s the file straight to S3 with it,
   then `POST /api/tasks/:taskId/media/confirm` records it in Postgres. The file itself
   never passes through our API — see [Deployment notes](#deployment-notes) for why.
6. The server independently re-checks the rep's reported GPS against the property on
   every upload (`ENFORCE_SERVER_SIDE_DISTANCE_CHECK`), so the 100m rule can't be
   bypassed by tampering with the client.
7. Once 10 photos + 1 video are stored, the task is marked complete and the app shows
   "The task is complete, you can leave the field."
8. Admins sign in at `/admin/login` and browse all tasks at `/admin`, sortable by
   created/updated date or searchable by Task ID.

## Stack

- **Frontend**: React + TypeScript (Vite), plain CSS, Google Maps JS API
- **Backend**: Node.js + Express + TypeScript, PostgreSQL (`pg`), AWS SDK v3 for S3
- **Auth**: JWT for admins (bcrypt-hashed passwords); reps need no login, just the Task ID

## Project layout

```
backend/    Express API, Postgres migrations, S3 upload logic
frontend/   Vite/React app (rep flow + admin dashboard)
```

## Database

The `tasks_field` table (`backend/src/db/migrations/001_create_tasks_field.sql`)
mirrors the client-supplied `task_schema.xlsx` column-for-column. Two additional
tables were needed beyond that schema:

- `task_media` — one row per captured photo/video (S3 key, direction, GPS, timestamp).
  `tasks_field` only has a single `cloud_url` folder link, which isn't enough to track
  and validate 10 photos + 1 video individually.
- `admin_users` — admin login credentials (not in the original schema).

### One deviation from the supplied schema

`004_widen_url_columns.sql` widens `CLOUD_URL`, `FOLDER_URL` and `WEB_URL` from
`VARCHAR(75)` to `VARCHAR(500)`. A real S3 folder URL doesn't fit in 75 characters —

```
https://assetlookout-field-visit-media.s3.ap-south-1.amazonaws.com/345667896/   (77 chars)
```

— so the first photo upload failed with `value too long for type character varying(75)`.
Widening a varchar is non-destructive (nothing is rewritten or truncated), so it is
safe to apply to an existing populated table.

## Local setup

### Backend

```bash
cd backend
npm install
cp .env.example .env      # fill in DATABASE_URL, AWS keys, JWT_SECRET
npm run migrate           # creates tables
npm run create-admin -- <username> <email> <password>   # repeat for the 2nd admin
npm run dev                # http://localhost:4000
```

Seed a sample task (1 MG Road, Bengaluru — Task ID `345667896`) with
`psql $DATABASE_URL -f src/db/seed.sql`.

To confirm AWS is wired up correctly — presign, a real browser-style `PUT`, and the
bucket's CORS policy — run:

```bash
npm run verify-s3
```

Re-run it after changing AWS credentials, region, bucket name, or `CORS_ORIGIN`
(especially after deploying, since the bucket CORS policy is derived from
`CORS_ORIGIN` and a mismatch only shows up in a real browser).

### Frontend

```bash
cd frontend
npm install
cp .env.example .env.local   # fill in VITE_GOOGLE_MAPS_API_KEY
npm run dev                   # http://localhost:5173
```

Camera and geolocation both require a secure context on a real phone — either deploy
behind HTTPS, or use `npm run dev -- --host` and open the printed network URL from a
phone on the same Wi-Fi (Chrome/Safari allow camera/geo on `localhost` and LAN IPs
without HTTPS during development, but not on other hostnames).

## Configuration

Business rules live in `backend/src/config/index.ts` (server-enforced) and are
mirrored for UI display in `frontend/src/config/config.ts`:

| Env var | Default | Purpose |
|---|---|---|
| `CAMERA_UNLOCK_DISTANCE_METERS` | 100 | How close the rep must be before capture is allowed |
| `REQUIRED_PHOTO_COUNT` | 10 | Photos required to complete a task |
| `REQUIRED_VIDEO_COUNT` | 1 | Videos required to complete a task |
| `ENFORCE_SERVER_SIDE_DISTANCE_CHECK` | true | Re-validates distance server-side on every upload |

`AWS_REGION` is set to `ap-south-1` (Mumbai): the app launches in India first, so
keeping the bucket in-region minimises upload latency for reps in the field.

## Deployment notes

Both the frontend and backend deploy to **Vercel**, as two separate Vercel projects
pointing at the same GitHub repo (set each project's "Root Directory" to `frontend`
and `backend` respectively).

Vercel serverless functions are short-lived and cap request bodies at a few MB, which
would normally rule out a ~200MB video upload passing through the API. That's why
uploads go straight from the browser to S3 (see step 5 above) instead of through the
backend — every backend request stays small and fast regardless of file size, which is
what makes the whole app deployable on Vercel.

- **Backend**: `backend/api/index.ts` exports the Express app as a single serverless
  function; `backend/vercel.json` routes all requests to it. Set the env vars from
  `backend/.env.example` in the Vercel project settings. Use a Postgres provider that
  handles serverless connection pooling well (Neon or Supabase both work out of the
  box — use their "pooled" connection string for `DATABASE_URL`).
- **Frontend**: standard Vite static build; `frontend/vercel.json` rewrites unknown
  paths to `index.html` so client-side routes like `/task/12345` don't 404 on refresh.
  Set `VITE_API_BASE_URL` to the deployed backend project's URL.
- **S3 CORS**: the backend sets the bucket's CORS policy automatically (allowing `PUT`
  from `CORS_ORIGIN`) the first time it touches the bucket, so no manual S3 console
  step is needed — just make sure `CORS_ORIGIN` includes the real frontend URL once
  it has a fixed Vercel domain.

## What's still needed to go live

- **AWS Access Key ID + Secret Access Key** for the `s3access` IAM user, with full S3
  permissions (not narrowly scoped) — the app creates the bucket, sets its
  public-access-block and CORS policy, and issues presigned upload URLs, so it's
  simplest to grant full S3 access once rather than adding individual permissions as
  they come up. This does **not** need to be (and shouldn't be) full AWS account access
  — just the S3 service.
- **Google Maps JavaScript API key** (with the Maps JavaScript API enabled/billed).
- **A Postgres database** to point `DATABASE_URL` at — I'll set this up (Neon) so no
  action is needed here.
- **2 admin accounts** — create with `npm run create-admin -- <username> <email> <password>`
  once the database is live.

## Known limitations

- Video is recorded as WebM (`MediaRecorder` output) rather than MP4 — this is a
  browser API constraint (native MP4 recording isn't reliably supported across
  Android Chrome/iOS Safari yet). S3 lifecycle rules and any downstream viewer should
  expect `.webm` for the video file.
- Compass heading (`DeviceOrientationEvent`) accuracy depends on the phone's
  magnetometer and calibration; there's no way to unit-test this without a physical
  device in the field.
