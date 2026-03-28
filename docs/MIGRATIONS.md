# Database Migrations & Schema Changes

Track of all schema changes, data migrations, and DB structure updates — and their status in each environment.

| Status | Dev | Prod |
|--------|-----|------|

---

## 1. `games.results[]` → `games.result` (singular)

**Date:** March 2026  
**Why:** The legacy schema stored game results in an array to support "challenge" alternate results. Each recalculation pushed a new entry to the front of the array instead of replacing the existing one, which inflated standings (some games had 10 entries, causing a team to show 350 "games played" instead of ~162).

### Schema change

```
// Before
games: { results: [ { winner, loser, scores, status, calculatedAt, ... }, ... ] }

// After
games: { result: { winner, loser, scores, status, calculatedAt, ... } }
```

### Dev status: ✅ Complete
- Ran `node scripts/migrate-results-to-singular.js`
- 831 game docs migrated (most recent entry kept as canonical)
- All MongoDB views patched (see below)

### Prod status: ⬜ TODO
**Steps to migrate prod:**
1. Run: `node scripts/migrate-results-to-singular.js --prod`
   - This migrates the `games` collection in `heroku_wm40bx9r`
2. Update prod MongoDB views via Atlas UI — apply the same pipeline patches:
   - **Views using `$unwind "$results"`** (`standings_view`, `Standings`, `StandingsHelper`, `standings2`, `gameResults`):
     - Before the `$unwind: { path: "$results", ... }` stage, **insert two stages**:
       ```json
       { "$match": { "result": { "$exists": true, "$ne": null } } },
       { "$set": { "results": ["$result"] } }
       ```
   - **Views using `"$results.scores"` directly** (`AdvancedStandings`, `advanced_standings_view`):
     - Replace all field path references `"$results."` → `"$result."` in the pipeline
     - e.g., `"$results.scores"` → `"$result.scores"`
3. Alternatively, run `scripts/fix-all-standings-views.js` if it's ever adapted to target prod.

### App code changes made
- `app/lib/game-calculation-service.ts` — `saveCalculatedResult()` uses `$set: { result }` instead of `$pull` + `$push`
- `app/api/games/route.ts` — removed `$cond/isArray` normalization pipeline; uses `game.result`
- `app/api/games/[id]/route.ts` — same cleanup
- `app/api/games/[id]/rosters/route.ts` — `game.result` (singular) instead of `game.results[0]`
- `app/api/games/batch/route.ts` — `$set: { result }` on save; `skipAlreadyProcessed` checks `result: { $exists: false }`
- `app/api/games/recalculate/route.ts` — comparison functions use `game.result` instead of `game.results[0]`
- `app/games/page.tsx` — `game.result` (singular interface)

---

## 2. `mlbrosters` collection (new)

**Date:** March 2026  
**Why:** `players_view` derives `status` from a `$lookup` on `mlbrosters`. Previously, roster data was either missing or stored differently. Created a sync route to populate it from the MLB Stats API.

### Schema
```
mlbrosters collection, one doc per MLB team:
{
  teamId: Number,          // MLB team ID
  teamAbbreviation: String,
  teamName: String,
  roster: [
    {
      person: { id, fullName, link },
      jerseyNumber: String,
      position: { code, name, type, abbreviation },
      status: { code, description },   // "Active", "10-Day Injured List", etc.
      parentTeamId: Number
    }
  ],
  lastUpdate: Date
}
```

### Dev status: ✅ Populated
- Run "Sync Roster Statuses" from `/admin` page to refresh
- Or `POST /api/players/sync-rosters` (admin only)

### Prod status: ⬜ TODO
- Has not been synced yet. Run "Sync Roster Statuses" from prod admin page once the app is deployed to prod.
- Note: `players_view` in prod already contains the correct `$lookup` pipeline — syncing `mlbrosters` is all that's needed.

---

## 3. Dev views recreated as live views

**Date:** March 2026  
**Why:** `scripts/copy-prod-to-dev.ts` was calling `find().toArray()` on MongoDB views, which executed the pipeline and stored a static snapshot instead of a live view. All 12 views in dev were materialized/dead.

### Dev status: ✅ Fixed
- Ran `node scripts/recreate-dev-views.js` to drop and recreate all 12 views as live views
- Fixed `scripts/copy-prod-to-dev.ts` to skip view collections during copy

### Prod status: ✅ Not affected (prod views were always live)

---

## 4. `scripts/copy-prod-to-dev.ts` — skip views during copy

**Date:** March 2026  
**Why:** Was copying MongoDB views as if they were regular collections, materializing them.

### Status: ✅ Fixed in code
- Now filters `type === 'view'` before copying collections
- Prints a reminder to run `recreate-dev-views.js` after copying

---

## Helper Scripts

| Script | Purpose |
|--------|---------|
| `node scripts/migrate-results-to-singular.js` | Migrate dev games + patch dev views |
| `node scripts/migrate-results-to-singular.js --prod` | Migrate prod games (views still need manual Atlas update) |
| `node scripts/migrate-results-to-singular.js --dryrun` | Preview changes without writing |
| `node scripts/fix-all-standings-views.js` | Patch views: restores from prod and applies correct strategy |
| `node scripts/recreate-dev-views.js` | Recreate all dev views from prod definitions |
| `node scripts/verify-migration.js` | Check game counts and standings totals post-migration |
| `node scripts/check-results-duplication.js` | Diagnose duplicate results entries |
