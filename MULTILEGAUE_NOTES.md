# Multi-League Architecture — Work in Progress

Last updated: 2026-03-27

## Committed Phases

| Phase | Commit | Description |
|---|---|---|
| 1 | `6996098` | `leagues` + `seasons` collections seeded; all collections backfilled (games, drafts, draftpicks, lineups) |
| 2 | `b914bdc` | `/api/leagues`, `/api/leagues/[slug]`, `/api/seasons` routes; `app/lib/league-context.ts` helper |
| 3 | `8593986` | Full URL restructure → `app/[league]/[season]/` route tree; root redirect; nav links dynamic |

---

## Architecture Summary

### New Collections
- `leagues` — `{ slug: "abl", name: "ABL", ... }` with stable ObjectId `aaaaaa000000000000000001`
- `seasons` — `{ leagueId, year, slug: "2025", teamIds: [...], isActive: true }` with stable ObjectIds:
  - 2023: `bbbbbb000000000000002023`
  - 2024: `bbbbbb000000000000002024`
  - 2025: `bbbbbb000000000000002025`

### URL Structure
`/[leagueSlug]/[seasonYear]/[page]`  e.g. `/abl/2025/standings`

Root `/` redirects to `/abl/2025` (server-side, `app/page.tsx`).

### Context Pattern
- `app/[league]/[season]/layout.tsx` — server component reads params, injects `LeagueSeasonProvider`
- `app/lib/league-season-context.tsx` — `useLeagueSeason()` hook, `leagueSeasonQuery()` helper
- `app/ui/navigation.tsx` — `useLeagueSeasonBase()` reads current `/[league]/[season]` from `usePathname()` (defaults to `/abl/2025`)

### API Scoping
- `app/lib/league-context.ts` has `resolveLeagueContext(db, leagueSlug, seasonSlug)`
- `/api/games` accepts optional `?league=&season=` — uses `resolveLeagueContext` to add `{ leagueId, seasonId }` as first `$match` stage
- `/api/standings` — does NOT yet filter by league/season. OK for now since all 2025 data is ABL. `standings_view` is a MongoDB view and would need to be recreated/updated to support scoping.

### What Is/Isn't Scoped
- **Scoped**: games (via `leagueId`/`seasonId` on game docs)
- **Not yet scoped**: standings, draft, lineups (all ABL 2025 data, works fine for now)
- **Not scoped by design**: players, statlines (shared MLB data)
- **League-wide (no season scope needed)**: teams (`ablteams` — franchise identity stable across seasons)

---

## Remaining Phases

### Phase 4 — Admin UX for leagues/seasons
- New pages: `/admin/leagues`, `/admin/seasons`
- Ability to create a league, create a season, assign teams to a season
- API endpoints: `POST /api/leagues`, `POST /api/seasons`
- Could also add team-to-season assignment UI

### Phase 5 — ABML League Setup
- Create ABML teams
- Seed `leagues` entry for ABML + `seasons` entry for first ABML season
- Can copy/adapt `scripts/seed-leagues-and-seasons.js`
- Verify `/abml/[year]/` routing works automatically (no new pages needed — same route tree)

### Phase 6 — League Switcher (deferred)
- Profile dropdown showing user's available leagues
- Auto-route on login based on team membership (`seasons.teamIds[]`)

---

## Known TODOs / Follow-ups

1. **Old routes still exist** — `/standings`, `/games`, `/teams`, etc. are no longer linked but still work. Safe to delete once confident new routes are stable.
2. **`standings_view` scoping** — to filter standings per league/season, the MongoDB view needs a `leagueId`/`seasonId` field added (or the view dropped and replaced with a regular aggregation in the API).
3. **Draft scoping** — `/api/draft/*` routes don't accept `?league=&season=` yet. Fine for current use.
4. **`seasons.teamIds[]`** — team-to-season membership is stored here. The admin UI (Phase 4) should manage this.
5. **`/abl/2025` hardcoded default** — if ABML goes live, the default redirect in `app/page.tsx` may need to be user-aware (redirect to their active league).
