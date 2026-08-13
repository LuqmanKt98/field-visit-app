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
   timestamp drawn directly onto the pixels (canvas), then uploaded as it's taken to
   `POST /api/tasks/:taskId/media`, which stores it in S3 under `<bucket>/<taskId>/…`
   (creating the bucket on first use) and records it in Postgres.
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

To try it without AWS: seed a sample task with `backend/src/db/seed.sql`
(`psql $DATABASE_URL -f src/db/seed.sql`) using Task ID `345667896`.

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

## Deployment notes

The frontend deploys cleanly to Vercel (static build). The backend does **not** fit
Vercel's serverless model well here, because it streams multipart photo/video uploads
(up to ~200MB for the video) through to S3 — that needs a long-lived Node process, not
a short-lived serverless function. Deploy the backend to a regular Node host (Render,
Railway, Fly.io, or an EC2/Lightsail box) and point `VITE_API_BASE_URL` at it.

## What's still needed to go live

- **AWS IAM keys** for the `s3access` user (Access Key ID + Secret Access Key) —
  needs `s3:CreateBucket`, `s3:PutObject`, `s3:PutBucketPublicAccessBlock` on the
  target bucket/account.
- **Google Maps JavaScript API key** (with the Maps JavaScript API enabled/billed).
- **A Postgres database** to point `DATABASE_URL` at (any managed Postgres works —
  RDS, Supabase, Neon, etc.).
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
