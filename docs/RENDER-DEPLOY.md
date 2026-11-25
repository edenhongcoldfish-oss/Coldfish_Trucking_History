# Free demo on Render

## Purpose

This guide puts Trip Log online on Render's free plan as a **demo only**. It runs with sample data and demo accounts so people can try the app from any phone or PC. **Never enter real drivers, trips, hours or pay here.**

## What you get

- A public `https://<name>.onrender.com` link that works on phones and PCs.
- Demo-account buttons on the sign-in page (no typing passwords). Demo accounts: `admin`, `driver1`-`driver4`, `scheduler`, `logistics`, `payer`, `accounting` / password `demo1234!!`.
- **Admin > Reset demo data** to put the sample data back at any time.

## Free plan limits

- The app **sleeps after about 15 minutes** with no visitors. The next visit wakes it in about 30-60 seconds.
- **Data resets** on every sleep, restart or redeploy. Anything entered during a test is lost.
- About **750 free instance hours per month** and **512 MB** of memory.
- Web Push (phone alerts) may stop working after a restart, because its keys are stored in the demo database.
- **Do not share the link publicly.** Anyone with the link can sign in with the demo buttons.
- A real launch needs the company NAS (see the README) or paid hosting with a paid database. If `DEPLOYMENT-GUIDE.md` exists in this repo, follow it for the real launch.

## Steps

1. Add `render.yaml` (repo root) and this guide, then commit and push to `main`.
2. Create a free account at [render.com](https://render.com) and sign in with GitHub.
3. Click **New +** > **Blueprint**, pick the `Coldfish_Trucking_History` repo, then **Apply**. Wait 3-6 minutes for the first build.
4. If Render asks for a card for the Blueprint, use **New +** > **Web Service** instead and pick the repo with these settings:
   - Runtime: **Node**
   - Instance type: **Free**
   - Build command: `npm ci --omit=dev`
   - Start command: `node src/server.js`
   - Health check path: `/healthz`
   - Environment variables: the table below
5. When the service shows **Live**, open its `onrender.com` link.

## Environment variables

| Key | Value | Why |
|---|---|---|
| `NODE_VERSION` | `22` | Runs a current Node.js version (the app needs 20 or newer). |
| `HOST` | `0.0.0.0` | Listens on all interfaces so Render can reach the app. |
| `TRUST_PROXY` | `1` | Trusts Render's proxy so HTTPS and visitor IPs are detected correctly. |
| `DEMO_LOGIN` | `true` | Shows the demo-account buttons and enables Reset demo data. |
| `SEED_DEMO` | `true` | Loads the demo accounts and sample trips on start. |
| `TZ` | `America/Toronto` | Uses the company time zone for dates and times. |

- **Do not set `DATABASE_URL`.** Without it the app uses its built-in demo database, which is what this demo needs (Reset demo data only works that way).
- **Do not set `COOKIE_SECURE=false`.** Render serves HTTPS, so secure cookies must stay on.
- `PORT` is set by Render automatically.

## Add the link to a phone home screen

- **iPhone (Safari):** open the link, tap **Share** > **Add to Home Screen**.
- **Android (Chrome):** open the link, tap the **menu** (⋮) > **Install app**.

## Quick first test

1. Sign in as **Scheduler** and create a trip in **Dispatch**.
2. On a phone, sign in as **Driver 1**, accept the trip and finish it.
3. Check the trip in **Pay History**.
4. To start over, sign in as **Admin** and use **Reset demo data**.

## Updating or stopping

- Every push to `main` redeploys the demo automatically, which also resets the data.
- To stop it: Render dashboard > the service > **Settings** > **Suspend** (pause) or **Delete** (remove).
