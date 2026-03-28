# ABL React - Actuarial Baseball League (React Migration)

This is the new React/Next.js version of the ABL fantasy baseball application, migrating from the Angular version.

## Tech Stack

- **Next.js 16** with App Router
- **React 19**
- **TypeScript** (strict mode)
- **Tailwind CSS 4**
- **Shared Express/MongoDB backend** (from the Angular app)

## Getting Started

### 1. Make sure the Express backend is running

```bash
# In the abl/ directory
cd ../abl
node server.js
# Should start on http://localhost:3000
```

### 2. Start the React dev server

```bash
# In this directory (abl-react/)
npm run dev
# Runs on http://localhost:3001
```

Visit [http://localhost:3001](http://localhost:3001)

## Daily Stat Refresh (Now in `abl-react`)

`abl-react` now supports its own daily stat refresh pipeline, so it no longer needs the Angular app to trigger recalculation.

- Endpoint: `/api/jobs/daily-stat-refresh`
- Schedule: configured in [vercel.json](vercel.json) at `0 8 * * *` (08:00 UTC)
- Default target date: previous UTC day
- Job actions:
	- Pull MLB schedule + boxscores from Stats API
	- Upsert `players` and `statlines`
	- Recalculate ABL game results for that date

### Admin-triggered Manual Run

Admin users can run the same job from the Admin Tools page via the **MLB Stat Download** widget.

- Route uses admin session auth for manual runs.
- Supports optional date override and optional game recalculation toggle.
- Uses the exact same backend service as the nightly cron.

### Required Environment Variables

- `MONGODB_URI`
- `MONGODB_DB` (optional, defaults to `abl_dev`)
- `CRON_SECRET` (required for scheduled job auth)

Vercel Cron automatically sends `Authorization: Bearer <CRON_SECRET>`.

### Setting the Nightly Time

Change the cron expression in [vercel.json](vercel.json) (UTC):

- Current: `0 8 * * *` (08:00 UTC daily)
- Example 3am Central (during CDT): `0 8 * * *`
- Example 3am Central (during CST): `0 9 * * *`

If you need a fixed local-time trigger across DST changes, use an external scheduler (GitHub Actions, Cloud Scheduler, etc.) and call `/api/jobs/daily-stat-refresh`.

### Manual Run

Use either GET with query params or POST with JSON body:

- `GET /api/jobs/daily-stat-refresh?date=2026-03-21`
- `POST /api/jobs/daily-stat-refresh` body: `{ "date": "2026-03-21", "recalculate": true }`

Include `Authorization: Bearer <CRON_SECRET>` (or `x-cron-secret`) when calling directly.

## Migration Status

### ✅ Completed
- [x] Initial Next.js setup with TypeScript
- [x] API client for backend communication
- [x] TypeScript interfaces (Team, Game, Player, etc.)
- [x] Home page with navigation
- [x] Games list page

### 📋 To Do
- [ ] Teams page
- [ ] Team detail/roster page  
- [ ] Standings page
- [ ] Game detail page
- [ ] Authentication (Auth0)
- [ ] Admin functionality
- [ ] Draft system
- [ ] Real-time updates

## Development Notes

- React app: **port 3001** | Backend: **port 3000**
- Both apps share the same Express/MongoDB backend
- Angular version continues on Heroku during migration
- API calls proxied to backend via `next.config.ts`
