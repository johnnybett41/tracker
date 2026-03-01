# Multi Tracker (Frontend + Backend)

## Structure

- `frontend/` - HTML, CSS, and client JS
- `backend/` - Node server and auth/session APIs

## Run

1. Open terminal in this folder.
2. Run:

```bash
npm start
```

3. Open: `http://localhost:3000`

## Environment Variables

- `PORT` (optional): server port (default `3000`)
- `HOST` (optional): bind host (default `0.0.0.0`)
- `DATA_DIR` (optional): folder for SQLite data (default `backend/data`)
- `NODE_ENV` (optional): set to `production` in deployed environments

## Auth

- Email: `johnbett414@gmail.com`
- Password: `johnbett41`
- You can also create a new account from `login.html` using **Sign Up**.

## Backend Endpoints

- `POST /api/login`
- `POST /api/signup`
- `POST /api/forgot-password`
- `POST /api/reset-password`
- `GET /api/session`
- `POST /api/logout`
- `POST /api/logout-all`
- `GET /api/data`
- `PUT /api/data`

`frontend/home.html` is protected by a session cookie when served through `backend/server.js`.

## Database

- SQLite database path: `backend/data/tracker.sqlite`
- Legacy JSON (`backend/data/db.json`) is migrated on startup if present.

If deploying, set `DATA_DIR` to a persistent disk mount.

## UX Features

- Quick Add command bar: `Ctrl/Cmd + K`
- Dashboard cards, expense timeline chart, and monthly calendar
- Search/filter/sort in all tracker panels
- Browser reminders for overdue tasks, low stock, and missed daily habits
- Export/import (JSON and CSV)
- Onboarding starter templates
- PWA support (`manifest.webmanifest` + `sw.js`)

## Deploy (Render + Custom Domain)

This repo includes:

- `Dockerfile`
- `render.yaml` (web service + persistent disk + health check)
- `/healthz` endpoint

### 1. Push to GitHub

Push this project to a GitHub repository.

### 2. Create Render service

1. In Render, create a new **Blueprint** and select your repo.
2. Render reads `render.yaml` and creates:
   - web service `multi-tracker`
   - persistent disk mounted at `/data`
3. Deploy.

### 3. Verify deployment

- Open your Render URL.
- Check health endpoint: `https://<your-render-domain>/healthz`

### 4. Add your real domain

1. In Render service settings, open **Custom Domains**.
2. Add your domain (for example `tracker.yourdomain.com`).
3. Add the DNS records Render shows at your DNS provider.
4. Wait for DNS to propagate.

Render provisions HTTPS certificates automatically after DNS is correct.

### 5. Cookie security in production

In production over HTTPS, session cookies are automatically marked `Secure`.
