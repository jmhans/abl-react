# MongoDB Collection Cleanup Audit
_Generated: 2026-04-12 (corrected after re-run)_

## Current state
- **DEV (`abl_dev`):** 19 collections, 15 views
- **PROD (`heroku_wm40bx9r`):** 24 collections, 12 views

---

## PROD collections with no code references (cleanup candidates)

| Collection | Notes |
|---|---|
| `draftpicks` | No references anywhere in app code |
| `drops` | No references anywhere in app code |
| `teams` | Distinct from `ablteams` (which IS used); no code references |

---

## PROD-only collections that ARE referenced in code (possible legacy)

| Collection | Referenced in | Notes |
|---|---|---|
| `owners` | `app/api/owners/[id]/route.ts`, `app/api/owners/route.ts` | Prod-only; may be legacy, superseded by user info embedded in `ablteams` |
| `rosters` | `app/api/games/[id]/rosters/route.ts` | Prod-only write path; may be legacy |

---

## DEV-only views (not in prod)

| View | Notes |
|---|---|
| `2022Standings` | Old season view, dev-only |
| `standings2` | Dev-only, purpose unclear |
| `initial_lineup_populater` | Dev-only, purpose unclear |

---

## System collections (do not touch)
| Collection | Notes |
|---|---|
| `objectlabs-system` | MongoDB Compass / Studio internal metadata |
| `objectlabs-system.admin.collections` | Same |

---

## Recommended next steps
1. **Investigate before dropping (prod):** Check document count and shape of `draftpicks`, `drops`, `teams` before removing.
2. **Review legacy routes:** Determine if `owners` API and `rosters` write path are still needed or can be removed alongside their prod collections.
3. **Dev-only views:** Decide whether `2022Standings`, `standings2`, `initial_lineup_populater` should be kept for historical reference or dropped.
