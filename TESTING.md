# Manual Testing Guide

A walkthrough for verifying every requirement in the client brief by hand, before
handover. Roughly 45 minutes end to end.

Automated coverage exists (`npm test`, `npm run test:integration`) but cannot open a
real camera or read a real compass — those are what this guide is for.

---

## 0. Before you start

### Start everything

```bash
# Postgres (portable build). Check first:
netstat -ano | grep ":5432 .*LISTENING"
```

If it is not running, from PowerShell:

```powershell
$p = "C:\Users\luqma\AppData\Local\Temp\claude\c--Users-luqma-Desktop-PrabhuRaj\a983004c-818d-45f2-9f80-b94b5556e28e\scratchpad\pg"
Start-Process -FilePath "$p\pgsql\bin\postgres.exe" -ArgumentList "-D","$p\data","-p","5432" -WindowStyle Hidden
```

Then:

```bash
cd backend  && npm run dev     # http://localhost:4000
cd frontend && npm run dev     # http://localhost:5173
```

### What you are testing against

| | |
|---|---|
| Seed task | `345667896` — 1 MG Road, Bengaluru (12.9757, 77.6079) |
| Admin logins | `admin1`, `admin2` — passwords are whatever you set with `npm run create-admin` (not stored in this repo) |
| S3 bucket | `assetlookout-field-visit-media` (ap-south-1) |

### Reset between runs

Wipes captured media so you can re-run the flow from scratch:

```bash
cd backend && npm run reset-demo
```

---

## 1. Desktop pass (~10 min)

Everything except the camera. Chrome DevTools can fake your location, so you can test
the distance gate without leaving your desk.

**Spoofing location:** open DevTools → `⋮` → More tools → **Sensors** → Location →
**Other…** and enter a latitude/longitude.

### 1.1 Task ID entry

1. Open `http://localhost:5173`
2. Enter `345667896`, submit.
3. **Expect:** property details load, satellite map shows a `P` marker.

### 1.2 Direct link (client asked for this specifically)

1. Open `http://localhost:5173/?taskid=345667896`
2. **Expect:** loads straight into the task, URL rewrites to `/task/345667896`.

### 1.3 Distance gate — too far

1. Sensors → set location to `51.5072, -0.1276` (London). Reload.
2. **Expect:** "Move closer to the property. You are 7,000+ km away (need to be within
   100 m)." Camera preview is **not** shown — only the locked message.

### 1.4 Distance gate — on site

1. Sensors → set `12.9757, 77.6079`. Reload.
2. **Expect:** green "You are close enough to the property. Camera unlocked."
3. On a desktop with no webcam you will then see a camera error — that is correct here.
   The camera itself is covered in Part 2.

### 1.5 Bad input

| Try | Expect |
|---|---|
| `/task/abc` | "Task not found", not a crash |
| `/task/999999999` | "No task found for ID 999999999" |
| `/admin` while logged out | redirected to `/admin/login` |

---

## 2. Phone pass (~20 min) — the important one

This is the only way to verify camera capture, the direction stamp and real GPS.

### 2.1 Point the task at where you actually are

**Do this first or nothing will unlock.** The seed task is in Bengaluru; the camera
only unlocks within 100 m of it.

Get your coordinates: Google Maps → right-click your location → click the lat/long to
copy. Then:

```bash
cd backend && npm run set-task-location -- 345667896 <YOUR_LAT> <YOUR_LNG>
```

Set it back to Bengaluru afterwards with:

```bash
cd backend && npm run set-task-location -- 345667896 12.9757 77.6079
```

### 2.2 Get the app onto the phone as a secure context

Camera and GPS need a **secure context**. `localhost` and HTTPS qualify; a LAN address
like `http://192.168.1.11:5173` does **not** — the camera will silently refuse to open.

**Android (easiest, no config):**

1. Phone: Settings → Developer options → **USB debugging** on. Connect by USB.
2. Desktop Chrome: open `chrome://inspect/#devices` → **Port forwarding…**
3. Add `5173 → localhost:5173` and `4000 → localhost:4000`. Tick "Enable port
   forwarding".
4. On the phone open **`http://localhost:5173`** — the phone treats this as secure, so
   camera and GPS both work.

**iPhone, or no cable:** put an HTTPS tunnel in front of both servers:

```bash
cloudflared tunnel --url http://localhost:5173     # frontend
cloudflared tunnel --url http://localhost:4000     # backend
```

Then set `VITE_API_BASE_URL` to the backend tunnel URL, `CORS_ORIGIN` to the frontend
tunnel URL, re-run `npm run provision-s3` (so the bucket's CORS matches), and restart
both dev servers.

### 2.3 Walk the flow

1. Open the task on the phone. Allow location, then allow camera when prompted.
2. iOS will also show a **"Enable compass for direction stamping"** button — tap it and
   allow Motion & Orientation access.
3. **Expect:** live camera preview with a small overlay showing direction + time.
4. Take all 10 photos. Watch the counter climb `1 / 10 … 10 / 10`.
5. The button then becomes **Start Recording**. Record a few seconds, **Stop**.
6. **Expect:** "The task is complete, you can leave the field"

### 2.4 Checks while you are on the phone

- [ ] Direction letter in the overlay **changes as you turn** (N → NE → E …). If it
      stays fixed, the compass needs calibrating — move the phone in a figure-8.
- [ ] Walk >100 m away mid-task. The camera should lock again and show the "move
      closer" message.
- [ ] Kill the browser tab after 4 photos, reopen the task. Progress should resume at
      `4 / 10`, not reset.
- [ ] Turn on airplane mode, take a photo. You should get an upload error **with a
      Retry button** — and the photo should not be lost. Turn signal back on, tap Retry.
- [ ] If the phone has no compass, expect a yellow warning that photos will be stamped
      "Direction: N/A". This is intended behaviour, not a bug — see Known limitations.

---

## 3. Admin pass (~10 min)

1. Go to `http://localhost:5173/admin/login`, sign in as `admin1`.
2. **Expect:** task list with Task ID, Status, Address, Agent, Created, Updated, Media.
3. Check each of these:

- [ ] Status reads **Completed** for the task you just finished.
- [ ] Sort by **Created date** and **Updated date**, both directions.
- [ ] Search by full Task ID `345667896`, and a partial `345667`.
- [ ] Click **View** → the gallery opens.

### 3.1 The gallery is where you verify the client's core requirement

- [ ] All 10 photos render (not broken image icons).
- [ ] **Each photo has the direction and date/time visibly burned into the image** —
      bottom-left corner. This is the requirement Prabhu was most specific about.
- [ ] The video plays, and the stamp is visible **and updating** as the video runs.
- [ ] Captions show `#1 · N`, `#2 · NE` etc. with capture times.

### 3.2 Confirm the files really are in S3

```bash
cd backend && npm run list-task-media -- 345667896
```

**Expect:** 11 objects — `photo_1.jpg` … `photo_10.jpg` and `video.webm` (or
`video.mp4` if captured on iPhone), each a realistic size, all distinct.

---

## 4. Things that should FAIL

If any of these *succeed*, stop and tell me.

```bash
# Admin API without a token
curl -s -o /dev/null -w "%{http_code}\n" http://localhost:4000/api/admin/tasks
# expect 401

# Wrong admin password
curl -s -o /dev/null -w "%{http_code}\n" -X POST \
  http://localhost:4000/api/admin/auth/login \
  -H "Content-Type: application/json" \
  -d '{"username":"admin1","password":"wrong"}'
# expect 401

# Upload from the other side of the world
curl -s -o /dev/null -w "%{http_code}\n" -X POST \
  http://localhost:4000/api/tasks/345667896/media/presign \
  -H "Content-Type: application/json" \
  -d '{"mediaType":"photo","sequenceNumber":1,"contentType":"image/jpeg","latitude":51.5,"longitude":-0.12}'
# expect 403

# Claim a photo slot without uploading anything
curl -s -o /dev/null -w "%{http_code}\n" -X POST \
  http://localhost:4000/api/tasks/345667896/media/confirm \
  -H "Content-Type: application/json" \
  -d '{"mediaType":"photo","sequenceNumber":7,"contentType":"image/jpeg","latitude":12.9757,"longitude":77.6079}'
# expect 409  <-- this is the "rep fakes a visit" defence

# A raw S3 link should not be publicly readable
curl -s -o /dev/null -w "%{http_code}\n" \
  https://assetlookout-field-visit-media.s3.ap-south-1.amazonaws.com/345667896/photo_1.jpg
# expect 403
```

---

## 5. Automated checks

```bash
cd backend
npm run typecheck && npm run build
npm test                 # 23 unit tests, ~0.5s, no infrastructure needed
npm run test:integration # 12 tests against the real DB + S3, ~6s
npm run verify-s3        # presign -> PUT -> verify -> cleanup

cd ../frontend
npm run build
```

All should pass. `test:integration` creates and then removes its own tasks and S3
objects.

---

## Known limitations — don't report these as bugs

| Behaviour | Why |
|---|---|
| Video saves as `.webm` on Android, `.mp4` on iPhone | Browser recording formats differ by platform. Both are handled. |
| Direction shows "N/A" on some devices | Not every phone has a usable magnetometer. The app warns rather than blocking capture — **Prabhu needs to decide** whether it should hard-block instead. |
| Camera fails on a `192.168.x.x` URL | Not a secure context. See 2.2. |
| Gallery links stop working after ~1 hour | Presigned URLs expire by design. Reopen the dialog. |
| Distance can be faked by a determined user | Browser GPS is client-side. Inherent to any web app; the claimed position is stored with every upload for auditing. |

---

## After testing

Clear the demo media so the client's bucket is empty at handover:

```bash
cd backend && npm run reset-demo
npm run set-task-location -- 345667896 12.9757 77.6079   # if you moved it
```
