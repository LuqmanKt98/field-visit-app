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
   created/updated date or searchable by Task ID, with a **View** action that opens the
   captured photos and video for that task.

The camera is only opened once the rep is inside the unlock radius, and is released
again if they move away — the phone doesn't hold the camera open for the whole visit.

Because the bucket blocks all public access, anything that displays media (the admin
gallery, and the rep reviewing their own captures) is served through short-lived
presigned GET URLs. Raw `https://bucket.s3….amazonaws.com/…` links return 403.

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

### Deviations from the supplied schema

**Six column names were corrected.** The spreadsheet spells them
`G_ADMINSTRATIVE_AREA_LEVEL_1..3` (and the `_SH` variants) — missing the second "i".
The migration uses the correct `G_ADMINISTRATIVE_…`. The `AGENT_FM`/`AGENT_LN`
inconsistency *was* preserved as supplied. **Flag this to the client**: any ETL written
against the spreadsheet will fail with `column does not exist` until it is updated.



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
npm run provision-s3      # once per environment: creates the bucket + its policies
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

Camera and geolocation require a **secure context**. Only `localhost`, `127.0.0.1` and
HTTPS qualify — a LAN address such as `http://192.168.1.11:5173` does **not**, so
opening the Vite `--host` URL directly on a phone will fail to open the camera.

To test on a real device, use one of:

- **Android (simplest, no config):** connect by USB with USB debugging on, open
  `chrome://inspect/#devices` on the desktop, and add a port forward
  `5173 → localhost:5173` (and `4000 → localhost:4000`). The phone then reaches the app
  at `http://localhost:5173`, which *is* a secure context, so camera and GPS work.
- **iPhone, or without a cable:** put an HTTPS tunnel in front of both servers
  (`cloudflared tunnel --url http://localhost:5173` and the same for `:4000`), then set
  `VITE_API_BASE_URL` to the backend tunnel URL and `CORS_ORIGIN` to the frontend one,
  and re-run `npm run provision-s3` so the bucket's CORS policy matches.

See `TESTING.md` for a full manual test walkthrough.

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
- **S3 provisioning is a one-off step, not part of a request.** Run `npm run provision-s3`
  once per environment with that environment's `CORS_ORIGIN`. It creates the bucket,
  blocks public access, enables default encryption, and sets the CORS rule for browser
  uploads. Doing this per-request would force the runtime IAM user to hold bucket-admin
  rights permanently, and — because the CORS rule is derived from `CORS_ORIGIN` — a
  preview deployment would overwrite production's CORS policy and break uploads for
  real reps. At runtime the API only signs URLs.
- **Runtime IAM permissions** can therefore be narrow: `s3:PutObject` and `s3:GetObject`
  on `{bucket}/*`. The broader bucket-admin rights are only needed by the provisioning
  script.
- **`JWT_SECRET` must be set.** There is no fallback: the app refuses to boot in
  production without it (checked from both `src/server.ts` and the Vercel entrypoint
  `api/index.ts`).

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

- **Video container varies by platform.** `MediaRecorder` produces WebM on
  Android/desktop Chrome and MP4 on iOS Safari; the app probes what the browser
  supports and stores whichever it gets, so the video file is either `video.webm` or
  `video.mp4`. S3 lifecycle rules and any downstream viewer should expect both.
- **Compass accuracy is device-dependent.** `DeviceOrientationEvent` relies on the
  phone's magnetometer and calibration, and iOS additionally requires a user gesture to
  grant access. If the compass is unavailable the photo still uploads, but without a
  direction stamp — this can't be meaningfully tested without a physical device.
- **Camera and GPS require HTTPS** on a real device. Both are fine on the Vercel
  deployment; locally they work on `localhost` only.
- **The geofence verifies a claim, not a position.** Coordinates are supplied by the
  browser, so a determined rep can send the property's own coordinates. This ceiling is
  inherent to browser geolocation — no web app can do better. The claimed position is
  stored per upload so mismatches can be audited after the fact. If stronger proof of
  presence is required, that needs a native app with attestation.
- **Not yet verified on physical hardware**: real camera capture (`getUserMedia`,
  autofocus, device resolutions), iOS Safari's MP4 recording path, and physical compass
  accuracy. These need a real iPhone and Android handset before launch.
