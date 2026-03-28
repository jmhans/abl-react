import { Db, ObjectId } from 'mongodb';

export interface LeagueContext {
  league: { _id: ObjectId; slug: string; name: string; shortName: string };
  season: { _id: ObjectId; year: number; slug: string; status: string; teamIds: ObjectId[] };
}

/**
 * Resolve a league + season from slug params.
 * seasonSlug = "2025" (year string) | "active" (current active season)
 * Throws with a message if not found — callers should return 404.
 */
export async function resolveLeagueContext(
  db: Db,
  leagueSlug: string,
  seasonSlug: string | 'active' = 'active'
): Promise<LeagueContext> {
  const league = await db.collection('leagues').findOne({ slug: leagueSlug });
  if (!league) throw new Error(`League not found: ${leagueSlug}`);

  const seasonFilter: Record<string, any> = { leagueId: league._id };
  if (seasonSlug === 'active') {
    seasonFilter.status = 'active';
  } else {
    seasonFilter.year = Number(seasonSlug);
  }

  const season = await db.collection('seasons').findOne(seasonFilter, { sort: { year: -1 } });
  if (!season) throw new Error(`Season not found: ${seasonSlug} in ${leagueSlug}`);

  return { league, season } as LeagueContext;
}

/**
 * Get the active season for a league. Returns null if none active.
 * Lightweight version for contexts where a missing season isn't an error.
 */
export async function getActiveSeason(db: Db, leagueSlug: string) {
  const league = await db.collection('leagues').findOne({ slug: leagueSlug });
  if (!league) return null;
  return db.collection('seasons').findOne({ leagueId: league._id, status: 'active' });
}

/**
 * Build a MongoDB filter fragment for scoping a collection query
 * to a specific league + season.
 */
export function seasonFilter(ctx: LeagueContext) {
  return { leagueId: ctx.league._id, seasonId: ctx.season._id };
}
