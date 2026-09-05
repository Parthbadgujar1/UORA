# Deploying UORA to Hostinger

This guide covers deploying the UORA Publications platform (Next.js frontend +
Express backend + MySQL) to Hostinger's **managed Node.js hosting** (the plan
you have: `uorapublications.com`, Node 24.x supported, Next.js/Express listed
as supported frameworks). The same steps adapt to a self-managed VPS using PM2
(`ecosystem.config.js`).

> **Production notes**
> - Email (password reset / verification) **works** once SMTP vars are set in
>   hPanel — see [Email](#email) below.
> - The backend **refuses to start** in production without a valid
>   `DATABASE_URL` and a `JWT_SECRET` of **at least 32 characters**.
> - CORS only allows origins listed in `CORS_ORIGINS` / `FRONTEND_URL`. They
>   must exactly match your deployed domain, or every API call will be rejected.
> - `NEXT_PUBLIC_API_URL` must be set in Hostinger **before the frontend build**
>   — it is baked in at build time.

---

## Architecture on Hostinger

This is a **two-part** deployment — the frontend and backend are separate Node
applications and must be deployed as two separate Node apps in Hostinger:

| App      | Stack        | Listens on        | Purpose                     |
|----------|--------------|-------------------|------------------------------|
| Backend  | Express      | port `5000`       | All `/api/*` REST endpoints  |
| Frontend | Next.js 16   | port `3000` (HTTPS via myHostinger nginx) | Public site + SSR |

The frontend calls the backend in one of two ways:

1. **Direct cross-origin (recommended):** set `NEXT_PUBLIC_API_URL` to the
   backend's public URL at build time. The browser calls the backend directly.
2. **Same-origin proxy:** the Next.js `next.config.ts` rewrites `/api/*` to
   `BACKEND_URL`. Use this only if both apps sit behind the same hostname/port.

---

## 1. Create the database in Hostinger

1. In hPanel → **Databases** → create a MySQL database (or use the one bundled
   with your plan). Note the hostname (often `localhost` on shared/managed
   plans or a host like `mysql-server-url`).
2. Create a database user and grant it all privileges on that database.
3. Build your connection string:
   `mysql://USER:PASSWORD@HOST:PORT/DBNAME`
   (Hostinger managed plans typically: `mysql://USER:PASS@localhost:3306/DBNAME`)

---

## 2. Configure backend environment variables

Open `backend/.env.production.example` — it is your copy-paste template.
In Hostinger hPanel → Hosting → Node.js → backend app → **Environment Variables**,
set **every** variable below. Replace all `<<REPLACE_*>>` placeholders:

| Variable               | Required | Notes                                                        |
|------------------------|----------|--------------------------------------------------------------|
| `NODE_ENV`             | yes      | `production`                                                 |
| `PORT`                 | no       | default `5000`                                               |
| `DATABASE_URL`         | **yes**  | from step 1                                                  |
| `JWT_SECRET`           | **yes**  | **≥ 32 chars**. Generate: `node -e "console.log(require('crypto').randomBytes(48).toString('hex'))"` |
| `JWT_EXPIRES_IN`       | no       | `1h`                                                         |
| `JWT_ISSUER`           | no       | `uora-api`                                                   |
| `JWT_AUDIENCE`         | no       | `uora-client`                                                |
| `REFRESH_EXPIRES_DAYS` | no       | `14`                                                         |
| `FRONTEND_URL`         | yes      | `https://uorapublications.com`                               |
| `CORS_ORIGINS`         | yes      | `https://uorapublications.com,https://www.uorapublications.com` |
| `ADMIN_EMAIL`          | for seed | initial admin email                                          |
| `ADMIN_PASSWORD`       | for seed | initial admin password (strong!)                             |
| `ADMIN_NAME`           | for seed | admin display name                                           |
| `ADMIN_BOOTSTRAP_SECRET` | no     | long random secret enabling `POST /api/auth/bootstrap-admin` for emergency admin recovery — leave unset to disable it entirely |
| `TRUST_PROXY_HOPS`     | no       | `1` — number of reverse-proxy hops in front of this app; wrong values break per-IP rate limiting, confirm with Hostinger support if unsure |
| `SMTP_HOST`            | for email | `smtp.hostinger.com`                                        |
| `SMTP_PORT`            | for email | `465`                                                        |
| `SMTP_SECURE`          | for email | `true`                                                       |
| `SMTP_USER`            | for email | `no-reply@uorapublications.com`                             |
| `SMTP_PASS`            | for email | your Hostinger mailbox password                              |
| `SMTP_FROM`            | for email | `UORA Publications <no-reply@uorapublications.com>`         |

> All SMTP_* vars must be set together. If any of SMTP_HOST/SMTP_USER/SMTP_PASS
> is missing, email is silently disabled but the server still starts normally.
> (`MAIL_*` names are still accepted as a fallback for one release, but
> `SMTP_*` is what this template and the code now treat as canonical.)

> Also append `?connection_limit=5` to `DATABASE_URL` — see the table above —
> to keep this app's DB connections comfortably under Hostinger MySQL's
> connection ceiling.

---

## 3. Deploy the backend app

1. In hPanel, use the **Node.js** product / **Deployments** flow to point at the
   `backend/` folder of the repo.
2. Build command: `npm run build` in `backend/` (compiles `src/` → `dist/`).
3. Start command: `node dist/server.js` (already the `start` script in `package.json`).
4. Instantiate the schema against the production DB. **Use real migrations,
   not `prisma db push`** — see `backend/prisma/migrations/README.md` for the
   one-time baseline step if you haven't done it yet. Once a baseline exists:
   ```bash
   cd backend
   npm run prisma:deploy        # applies any pending migrations (prisma migrate deploy)
   npm run prisma:seed          # create the admin account (idempotent — safe to re-run)
   ```
   Run these from a machine with the prod `DATABASE_URL`, or via a one-off
   build hook on Hostinger if your plan supports it. `db push` bypasses the
   migration history entirely and should not be used against production
   again once the baseline exists.
5. Set your **uploads directory** (`backend/uploads/`) to a **persistent** path
   that survives redeploys (Hostinger managed plans may reset the app folder on
   each deploy). Submissions attach manuscript files here — losing it loses files.
6. Verify the backend is reachable: `GET /api/health` returns 200 with a success payload.

---

## 4. Deploy the frontend (Next.js) app

1. Point Hostinger's Next.js deployment at the `frontend/` folder.
2. Set **build-time** env vars in hPanel **BEFORE** triggering a build
   (open `frontend/.env.production.example` for the template):
   - `NEXT_PUBLIC_API_URL=https://<your-backend-public-url>` — the public HTTPS
     URL of the backend you deployed in step 3.
   - If instead you keep same-origin proxying, set `BACKEND_URL` to the internal
     backend origin. (Direct cross-origin with `NEXT_PUBLIC_API_URL` is recommended.)
3. Build command: `npm run build` (i.e. `next build`).
4. Start command: `next start -p 3000` (or Hostinger's default for the Next.js
   starter). Ensure the port matches your plan's expectations; on managed
   Next.js hosting Hostinger usually handles the port for you.
5. Add a bypass so public-only paths (login/register/landing) are reachable
   without auth — this is already the case; the app protects only role-scoped
   routes client-side, so no server bypass is needed.

---

## 5. DNS / domain / HTTPS

- Both `uorapublications.com` and `www.uorapublications.com` resolve to your
  Hostinger IP (`147.93.109.3`). Point the `A` records (and `www` CNAME) there
  if not already set.
- If the backend is exposed on a subdomain (e.g. `api.uorapublications.com`),
  add an `A`/`CNAME` record for `api` → same IP and enable HTTPS for it too.
- Check CORS: ensure `https://api.uorapublications.com` (if used) and the
  frontend origin are both present in the backend's `CORS_ORIGINS`.

---

## 6. Verify the deployed app

- Landing page loads over HTTPS.
- `Author Login`, registration, and the "Submit Manuscript" button work
  (i.e. no hard redirect to an admin page; the button routes anonymous users to
  login/register).
- Register a new account → it logs in as an AUTHOR.
- Log in as the seeded admin → admin dashboard loads.
- `GET <backend>/api/health` returns healthy.
- Trigger "Forgot Password" → email arrives in the inbox (if SMTP is configured).

---

## Email

Email delivery is now **fully implemented** via nodemailer (`backend/src/security/mailer.ts`).

**To enable:** set all six `SMTP_*` vars in hPanel (see step 2 table above).
When `SMTP_HOST`, `SMTP_USER`, and `SMTP_PASS` are all present, the server
automatically switches to the SMTP provider on startup. (`MAIL_*` is accepted
as a fallback name for one release, but new configuration should use `SMTP_*`.)

**Hostinger SMTP settings:**

| Setting     | Value                           |
|-------------|----------------------------------|
| Host        | `smtp.hostinger.com`             |
| Port        | `465`                            |
| Encryption  | SSL/TLS (`SMTP_SECURE=true`)     |
| Username    | your full email address          |
| Password    | your Hostinger email password    |

Create the `no-reply@uorapublications.com` mailbox in hPanel → **Emails → Manage**
before deploying.

---

## Performance & resource tuning (2 vCPU / 3GB RAM plan)

What's already in place, and what to configure on your side:

- **Gzip compression** is on for all API responses (`compression()` in
  `app.ts`) — meaningfully smaller payloads for the public journal/issue/
  article listings, at a small CPU cost.
- **Public catalogue endpoints are bounded.** `/api/public/articles` and
  `/api/public/issues` previously fetched every published row, unbounded,
  on every request. They're now capped (`take: 200`) so the catalogue
  growing over time can't turn into an unbounded query. If you cross ~200
  published articles/issues, convert these to real `page`/`limit` query
  params (this needs a matching frontend change, since the response shape
  changes from a plain array to a paginated object — flag it if you want
  this done next).
- **PDF downloads** no longer pull the full article→journal→issue→volume→
  submission→authors graph just to check `pdfUrl` — a lightweight
  title+pdfUrl-only query is used instead.
- **File uploads** already stream straight to disk (`multer.diskStorage`),
  not into memory — large manuscript uploads don't spike RAM.
- **`DATABASE_URL` connection_limit**: set `?connection_limit=5` (see step 2)
  so this app can never open more MySQL connections than your plan allows.
  Prisma's default pool size scales with CPU count and can otherwise exceed
  a shared MySQL plan's `max_connections` under load.
- **Node heap cap**: on a 3GB box shared with MySQL, the frontend app, and
  PHP workers, cap each Node process's heap so a leak or spike in one
  process can't take down the whole box. Set, if your Hostinger Node.js app
  plan supports custom start-command flags:
  ```
  NODE_OPTIONS=--max-old-space-size=384
  ```
  (384MB per process is a reasonable starting point for backend and
  frontend each, leaving headroom for MySQL and the OS. If running via
  the included `ecosystem.config.js` on a VPS instead, `max_memory_restart`
  is already set to 512M per app as a hard safety net.)
- **Prisma query logging** is `["warn","error"]` only in production (not
  `"query"`) — avoids log-volume/IO overhead from logging every query.
- **Admin/journal/volume/issue list endpoints already paginate and use
  `select`** to avoid over-fetching — this was already correct going in and
  didn't need changes.

Not yet done (larger, higher-risk changes — call these out if you want them
next): a full N+1 pass over the submission/review workflow's remaining
list endpoints, and converting the two capped public endpoints above to real
pagination (requires a frontend contract change).

---

## Deployment checklist

```
[ ] MySQL DB created in hPanel → connection string built
[ ] All backend env vars set in hPanel (NODE_ENV, DATABASE_URL, JWT_SECRET, CORS, MAIL_*)
[ ] NEXT_PUBLIC_API_URL set in frontend env vars in hPanel BEFORE build
[ ] Backend deployed → npm run build → node dist/server.js
[ ] npx prisma db push → npm run prisma:seed (creates admin account)
[ ] uploads/ folder mapped to a persistent volume
[ ] Frontend deployed → npm run build → next start
[ ] DNS A records → 147.93.109.3 for uorapublications.com and www
[ ] If using subdomain for API: A/CNAME for api.uorapublications.com + HTTPS
[ ] GET /api/health returns 200
[ ] Login as admin → dashboard loads
[ ] Forgot Password email arrives (confirms SMTP is working)
```

---

## Self-managed VPS (alternative)

If you move to a root VPS instead of managed hosting:

```bash
# On the server (Node 24 + MySQL installed)
npm install -g pm2
git clone <repo> uora && cd uora
npm --prefix backend install && npm --prefix frontend install
cp backend/.env.production.example backend/.env   # fill in all <<REPLACE_*>>
npm run build:backend && npm run build:frontend
pm2 start ecosystem.config.js
pm2 save && pm2 startup
```

Then put nginx in front, terminate TLS, proxy `/` → `:3000` and (if needed)
`/api` → `:5000`, and add the nginx client IP to the `trust proxy` handling
(already enabled in production).

---

## Layout / scripts

| Path                              | Purpose                                        |
|-----------------------------------|------------------------------------------------|
| `package.json` (root)             | Convenience scripts (build/start/dev)          |
| `ecosystem.config.js`             | PM2 config (VPS path)                          |
| `.env.example`                    | All env vars, annotated                        |
| `backend/.env.example`            | Backend env example                            |
| `backend/.env.production.example` | **Hostinger hPanel copy-paste template**       |
| `frontend/.env.example`           | Frontend env example                           |
| `frontend/.env.production.example`| **Frontend Hostinger build-time vars template**|
| `backend/prisma/seed.ts`          | Admin bootstrap (`ADMIN_*` env)                |
