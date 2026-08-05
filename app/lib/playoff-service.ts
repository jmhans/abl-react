import { Db, ObjectId } from 'mongodb';
import { deriveAblDate, nextAblGameDay, nextAblGameDays } from '@/app/lib/abl-date';
import { getCachedStandings, computeStandingsForSeason } from '@/app/lib/standings-service';

const BRACKETS_COLLECTION = 'playoff_brackets';

// Home team per 2-3-2 series game number: higher seed hosts 1,2,6,7; lower seed hosts 3,4,5.
const HIGHER_SEED_HOME_GAMES = new Set([1, 2, 6, 7]);

function gameDateFromAblDate(ablDateStr: string): Date {
  // Matches the existing convention observed on real game docs (ABL date + 17:00Z).
  return new Date(`${ablDateStr}T17:00:00.000Z`);
}

// ── Bracket doc access ──────────────────────────────────────────────────────

async function getOrCreateBracket(db: Db, leagueId: ObjectId, seasonId: ObjectId) {
  // Keyed by seasonId as _id (mirrors standings_cache's convention) — this makes the
  // built-in unique _id index the uniqueness guarantee, no separate index needed, and
  // makes the upsert itself race-safe.
  const result = await db.collection(BRACKETS_COLLECTION).findOneAndUpdate(
    { _id: seasonId as any },
    {
      $setOnInsert: {
        leagueId,
        seasonId,
        createdAt: new Date(),
        status: 'awaiting_regular_season_end',
        seeds: null,
        tiebreaks: [],
        series: [],
      },
      $set: { updatedAt: new Date() },
    } as any,
    { upsert: true, returnDocument: 'after' }
  );
  return (result as any)?.value ?? result;
}

async function updateBracket(db: Db, bracketId: ObjectId, patch: Record<string, any>) {
  await db.collection(BRACKETS_COLLECTION).updateOne(
    { _id: bracketId },
    { $set: { ...patch, updatedAt: new Date() } }
  );
}

// ── Seeding / tie detection ──────────────────────────────────────────────────

/** Groups consecutive standings rows with identical (w, g) into rank-contiguous
 *  groups. Ties are keyed on (wins, games-played) rather than win% to avoid any
 *  floating-point/rounding ambiguity from the pre-formatted `wpct` string. */
function identifyTieGroups(standings: any[]): { startRank: number; endRank: number; teamIds: string[] }[] {
  const groups: { startRank: number; endRank: number; teamIds: string[] }[] = [];
  let i = 0;
  while (i < standings.length) {
    let j = i;
    while (
      j + 1 < standings.length &&
      standings[j + 1].w === standings[i].w &&
      standings[j + 1].g === standings[i].g
    ) {
      j++;
    }
    groups.push({
      startRank: i,
      endRank: j,
      teamIds: standings.slice(i, j + 1).map((s: any) => String(s.tm?._id ?? s._id)),
    });
    i = j + 1;
  }
  return groups;
}

function rangeArray(start: number, end: number): number[] {
  const out: number[] = [];
  for (let n = start; n <= end; n++) out.push(n);
  return out;
}

// ── Tiebreak game creation/evaluation ────────────────────────────────────────

/** Creates one neutral-site game per pair in the group (1 game for 2-way, N*(N-1)/2
 *  for N-way). Idempotent: if games already exist for this groupId, returns those
 *  instead of creating duplicates (defends against a crash between game creation and
 *  the bracket-doc write that records them). */
async function createTiebreakGamesForGroup(
  db: Db,
  leagueId: ObjectId,
  seasonId: ObjectId,
  groupId: string,
  teamIds: string[],
  ablDate: string,
): Promise<ObjectId[]> {
  const existing = await db.collection('games').find({ 'playoff.tiebreakGroupId': groupId }).toArray();
  if (existing.length > 0) return existing.map((g: any) => g._id);

  const gameDate = gameDateFromAblDate(ablDate);
  const pairs: [string, string][] = [];
  for (let i = 0; i < teamIds.length; i++) {
    for (let j = i + 1; j < teamIds.length; j++) {
      pairs.push([teamIds[i], teamIds[j]]);
    }
  }

  const docs = pairs.map(([homeId, awayId]) => ({
    leagueId,
    seasonId,
    homeTeam: new ObjectId(homeId),
    awayTeam: new ObjectId(awayId),
    gameDate,
    gameType: 'P',
    isNeutralSite: true,
    cancelled: false,
    playoff: { kind: 'tiebreak', tiebreakGroupId: groupId },
  }));

  const result = await db.collection('games').insertMany(docs as any[]);
  return Object.values(result.insertedIds) as unknown as ObjectId[];
}

/** Recursively resolves a tiebreak lineage's final best-to-worst team order once every
 *  sub-round it depends on has played out. Returns null if any dependency is still
 *  pending (games not final, or a needed follow-up round hasn't been created/played). */
function resolveGroupOrder(group: any, allGroupsInLineage: any[]): ObjectId[] | null {
  if (group.status === 'scheduled') return null;
  if (group.status === 'complete') return group.resolvedOrder;

  // 'unresolved_advance_to_next_round' — splice in each still-tied cluster's own
  // follow-up group resolution.
  if (!group.clusters) return null;
  const result: ObjectId[] = [];
  for (const cluster of group.clusters as ObjectId[][]) {
    if (cluster.length === 1) {
      result.push(cluster[0]);
      continue;
    }
    const child = allGroupsInLineage.find(
      (g: any) =>
        g.round === group.round + 1 &&
        g.teamIds.length === cluster.length &&
        g.teamIds.every((id: ObjectId) => cluster.some((c) => c.equals(id)))
    );
    if (!child) return null;
    const childOrder = resolveGroupOrder(child, allGroupsInLineage);
    if (!childOrder) return null;
    result.push(...childOrder);
  }
  return result;
}

const MAX_TIEBREAK_ROUNDS = 5;

/** Evaluates every 'scheduled' tiebreak group whose games are all final: resolves it
 *  outright if the round-robin produced a clean order, or spins up a follow-up round
 *  scoped to just the still-tied subset(s) otherwise. Mutates and returns the updated
 *  tiebreaks array; caller persists it. */
async function evaluateTiebreakGroups(db: Db, leagueId: ObjectId, seasonId: ObjectId, tiebreaks: any[]): Promise<{ tiebreaks: any[]; changed: boolean }> {
  const updated = [...tiebreaks];
  let changed = false;
  const today = deriveAblDate(new Date());

  for (let idx = 0; idx < updated.length; idx++) {
    const group = updated[idx];
    if (group.status !== 'scheduled') continue;

    const games = await db.collection('games').find({ _id: { $in: group.gameIds } }).toArray();
    if (games.some((g: any) => !g.result?.isFinal)) continue; // not all played yet

    const wins = new Map<string, number>();
    for (const teamId of group.teamIds) wins.set(teamId.toString(), 0);
    for (const g of games) {
      const w = g.result?.winner?.toString();
      if (w && wins.has(w)) wins.set(w, (wins.get(w) ?? 0) + 1);
    }

    const ordered: ObjectId[] = [...group.teamIds].sort(
      (a: ObjectId, b: ObjectId) => (wins.get(b.toString()) ?? 0) - (wins.get(a.toString()) ?? 0)
    );
    const clusters: ObjectId[][] = [];
    for (const teamId of ordered) {
      const w = wins.get(teamId.toString()) ?? 0;
      const last = clusters[clusters.length - 1];
      if (last && (wins.get(last[0].toString()) ?? 0) === w) {
        last.push(teamId);
      } else {
        clusters.push([teamId]);
      }
    }

    if (clusters.every((c) => c.length === 1)) {
      updated[idx] = { ...group, status: 'complete', resolvedOrder: ordered, clusters: undefined };
      changed = true;
      continue;
    }

    if (group.round >= MAX_TIEBREAK_ROUNDS) {
      console.error(
        `[playoff-service] Tiebreak lineage ${group.lineageId} did not resolve after ${MAX_TIEBREAK_ROUNDS} rounds — parking for manual review.`
      );
      updated[idx] = { ...group, clusters };
      continue; // leave as 'scheduled' forever; do not spin further rounds
    }

    const nextRound = group.round + 1;
    const tiedClusters = clusters.filter((c) => c.length > 1);
    const newGroups: any[] = [];
    for (const [i, cluster] of tiedClusters.entries()) {
      const ablDate = nextAblGameDay(today, { inclusive: true });
      const suffix = tiedClusters.length > 1 ? `-${i}` : '';
      const newGroupId = `${group.lineageId}-r${nextRound}${suffix}`;
      const gameIds = await createTiebreakGamesForGroup(
        db, leagueId, seasonId, newGroupId, cluster.map((id) => id.toString()), ablDate
      );
      newGroups.push({
        groupId: newGroupId,
        lineageId: group.lineageId,
        round: nextRound,
        seedTargets: group.seedTargets,
        teamIds: cluster,
        gameIds,
        ablDate,
        status: 'scheduled',
        nextGroupId: null,
        resolvedOrder: null,
        createdAt: new Date(),
      });
    }

    updated[idx] = { ...group, status: 'unresolved_advance_to_next_round', clusters, nextGroupId: newGroups[0]?.groupId ?? null };
    updated.push(...newGroups);
    changed = true;
  }

  return { tiebreaks: updated, changed };
}

// ── Series game creation/evaluation ──────────────────────────────────────────

/** Creates the 7 games for a series on the given dates (idempotent, same guard
 *  pattern as tiebreak games). Home team follows the 2-3-2 pattern. */
async function createSeriesGamesOnDates(
  db: Db,
  leagueId: ObjectId,
  seasonId: ObjectId,
  seriesId: string,
  higherSeedTeamId: ObjectId,
  lowerSeedTeamId: ObjectId,
  dates: string[],
): Promise<ObjectId[]> {
  const existing = await db.collection('games')
    .find({ 'playoff.seriesId': seriesId })
    .sort({ 'playoff.seriesGameNumber': 1 })
    .toArray();
  if (existing.length > 0) return existing.map((g: any) => g._id);

  const docs = dates.map((d, i) => {
    const gameNumber = i + 1;
    const higherIsHome = HIGHER_SEED_HOME_GAMES.has(gameNumber);
    return {
      leagueId,
      seasonId,
      homeTeam: higherIsHome ? higherSeedTeamId : lowerSeedTeamId,
      awayTeam: higherIsHome ? lowerSeedTeamId : higherSeedTeamId,
      gameDate: gameDateFromAblDate(d),
      gameType: 'P',
      isNeutralSite: false,
      cancelled: false,
      playoff: { kind: 'series', seriesId, seriesGameNumber: gameNumber },
    };
  });

  const result = await db.collection('games').insertMany(docs as any[]);
  return Object.values(result.insertedIds) as unknown as ObjectId[];
}

/** Evaluates every incomplete series of the given round: tallies wins from final,
 *  non-cancelled games, and on a 4th win, records the winner/loser and cancels any
 *  not-yet-final slots beyond the clinching game. Returns the updated series array
 *  and whether every series in this round is now complete. */
async function evaluateSeriesRound(db: Db, series: any[], round: 'first' | 'second'): Promise<{ series: any[]; changed: boolean; allComplete: boolean }> {
  const updated = [...series];
  let changed = false;

  for (let idx = 0; idx < updated.length; idx++) {
    const s = updated[idx];
    if (s.round !== round || s.status === 'complete') continue;

    const games = await db.collection('games')
      .find({ _id: { $in: s.gameIds }, cancelled: { $ne: true } })
      .sort({ 'playoff.seriesGameNumber': 1 })
      .toArray();

    const finalGames = games.filter((g: any) => g.result?.isFinal);
    const wins = new Map<string, number>();
    let winnerId: string | null = null;
    let clinchedAtGameNumber: number | null = null;

    for (const g of finalGames) {
      const w = g.result?.winner?.toString();
      if (!w) continue;
      const count = (wins.get(w) ?? 0) + 1;
      wins.set(w, count);
      if (count >= 4) {
        winnerId = w;
        clinchedAtGameNumber = g.playoff?.seriesGameNumber ?? null;
        break;
      }
    }

    if (winnerId) {
      const loserId = winnerId === s.higherSeedTeamId.toString() ? s.lowerSeedTeamId.toString() : s.higherSeedTeamId.toString();
      updated[idx] = {
        ...s,
        status: 'complete',
        winnerTeamId: new ObjectId(winnerId),
        loserTeamId: new ObjectId(loserId),
        clinchedAtGameNumber,
      };
      changed = true;

      await db.collection('games').updateMany(
        {
          _id: { $in: s.gameIds },
          'playoff.seriesGameNumber': { $gt: clinchedAtGameNumber },
          'result.isFinal': { $ne: true },
        },
        { $set: { cancelled: true, cancelledAt: new Date(), cancelledReason: 'series_clinched' } }
      );
    } else if (s.status !== 'in_progress' && finalGames.length > 0) {
      updated[idx] = { ...s, status: 'in_progress' };
      changed = true;
    }
  }

  const allComplete = updated.filter((s) => s.round === round).every((s) => s.status === 'complete');
  return { series: updated, changed, allComplete };
}

// ── Per-status handlers ───────────────────────────────────────────────────────

async function handleRegularSeasonEndCheck(db: Db, league: any, season: any, bracket: any) {
  const pendingRegular = await db.collection('games').countDocuments({
    leagueId: league._id,
    seasonId: season._id,
    gameType: 'R',
    cancelled: { $ne: true },
    'result.isFinal': { $ne: true },
  });
  if (pendingRegular > 0) return { status: bracket.status, action: 'waiting_for_regular_season' };

  const cached = await getCachedStandings(db, league.slug, season.slug).catch(() => null);
  const standings = cached?.standings ?? (await computeStandingsForSeason(db, league.slug, season.slug)).standings;
  if (!standings || standings.length < 4) {
    return { status: bracket.status, action: 'not_enough_teams' };
  }

  const tieGroups = identifyTieGroups(standings);
  const contendingGroups = tieGroups.filter((g) => g.startRank <= 3 && g.teamIds.length > 1);

  if (contendingGroups.length === 0) {
    const seeds = standings.slice(0, 4).map((s: any, i: number) => ({
      seed: i + 1,
      teamId: new ObjectId(s.tm?._id ?? s._id),
    }));
    await updateBracket(db, bracket._id, { seeds, status: 'seeded' });
    return { status: 'seeded', action: 'seeded_no_ties' };
  }

  const today = deriveAblDate(new Date());
  const newTiebreaks: any[] = [];
  for (const group of contendingGroups) {
    // inclusive: true — the cron runs well before that evening's games, so today is a
    // legitimate first candidate, not just the day after.
    const ablDate = nextAblGameDay(today, { inclusive: true });
    const groupId = `seed${group.startRank + 1}-r1`;
    const gameIds = await createTiebreakGamesForGroup(db, league._id, season._id, groupId, group.teamIds, ablDate);
    newTiebreaks.push({
      groupId,
      lineageId: groupId,
      round: 1,
      seedTargets: rangeArray(group.startRank + 1, group.endRank + 1),
      teamIds: group.teamIds.map((id) => new ObjectId(id)),
      gameIds,
      ablDate,
      status: 'scheduled',
      nextGroupId: null,
      resolvedOrder: null,
      createdAt: new Date(),
    });
  }

  await updateBracket(db, bracket._id, { tiebreaks: newTiebreaks, status: 'seeding_in_progress' });
  return { status: 'seeding_in_progress', action: 'tiebreaks_created' };
}

async function handleTiebreakEvaluation(db: Db, league: any, season: any, bracket: any) {
  const cached = await getCachedStandings(db, league.slug, season.slug).catch(() => null);
  const standings = cached?.standings ?? (await computeStandingsForSeason(db, league.slug, season.slug)).standings;

  const { tiebreaks, changed } = await evaluateTiebreakGroups(db, league._id, season._id, bracket.tiebreaks);
  if (!changed) return { status: bracket.status, action: 'none' };

  // Check whether every lineage now has a fully resolved order.
  const lineageIds = Array.from(new Set(tiebreaks.map((g: any) => g.lineageId)));
  const rootGroups = lineageIds.map((id) => tiebreaks.find((g: any) => g.lineageId === id && g.round === 1));
  const lineageOrders = rootGroups.map((root: any) => (root ? resolveGroupOrder(root, tiebreaks) : null));

  if (lineageOrders.some((o) => o === null)) {
    await updateBracket(db, bracket._id, { tiebreaks });
    return { status: 'seeding_in_progress', action: 'tiebreaks_progressed' };
  }

  // Every lineage resolved — splice each resolved order back into the season standings
  // order (each lineage's root group covers a contiguous rank range) and take the top 4.
  const combinedOrder = standings.map((s: any) => String(s.tm?._id ?? s._id));
  rootGroups.forEach((root: any, i: number) => {
    if (!root) return;
    const order = lineageOrders[i] as ObjectId[];
    combinedOrder.splice(root.startRank ?? root.seedTargets[0] - 1, order.length, ...order.map((id) => id.toString()));
  });

  const seeds = combinedOrder.slice(0, 4).map((teamId, i) => ({ seed: i + 1, teamId: new ObjectId(teamId) }));
  await updateBracket(db, bracket._id, { tiebreaks, seeds, status: 'seeded' });
  return { status: 'seeded', action: 'seeding_resolved' };
}

async function handleFirstRoundCreation(db: Db, league: any, season: any, bracket: any) {
  const bySeed = new Map<number, ObjectId>((bracket.seeds ?? []).map((s: any) => [s.seed, s.teamId]));
  const today = deriveAblDate(new Date());
  const dates = nextAblGameDays(today, 7, { inclusive: true });

  const defs = [
    { seriesId: 'R1-1v4', higherSeed: 1, lowerSeed: 4 },
    { seriesId: 'R1-2v3', higherSeed: 2, lowerSeed: 3 },
  ];

  const newSeries: any[] = [];
  for (const def of defs) {
    const higherSeedTeamId = bySeed.get(def.higherSeed)!;
    const lowerSeedTeamId = bySeed.get(def.lowerSeed)!;
    const gameIds = await createSeriesGamesOnDates(db, league._id, season._id, def.seriesId, higherSeedTeamId, lowerSeedTeamId, dates);
    newSeries.push({
      seriesId: def.seriesId,
      round: 'first',
      higherSeedTeamId,
      lowerSeedTeamId,
      higherSeedOriginalSeed: def.higherSeed,
      lowerSeedOriginalSeed: def.lowerSeed,
      gameIds,
      status: 'scheduled',
      winnerTeamId: null,
      loserTeamId: null,
      clinchedAtGameNumber: null,
      createdAt: new Date(),
    });
  }

  await updateBracket(db, bracket._id, { series: newSeries, status: 'first_round_in_progress' });
  return { status: 'first_round_in_progress', action: 'first_round_created' };
}

async function handleFirstRoundCompletionCheck(db: Db, bracket: any) {
  const { series, changed, allComplete } = await evaluateSeriesRound(db, bracket.series, 'first');
  const newStatus = allComplete ? 'first_round_complete' : bracket.status;
  if (changed || newStatus !== bracket.status) {
    await updateBracket(db, bracket._id, { series, status: newStatus });
  }
  return { status: newStatus, action: changed ? 'series_updated' : 'none' };
}

async function handleSecondRoundCreation(db: Db, league: any, season: any, bracket: any) {
  const r1 = bracket.series.find((s: any) => s.seriesId === 'R1-1v4');
  const r2 = bracket.series.find((s: any) => s.seriesId === 'R1-2v3');

  const seedOf = (series: any, teamId: ObjectId) =>
    teamId.equals(series.higherSeedTeamId) ? series.higherSeedOriginalSeed : series.lowerSeedOriginalSeed;

  const champCandidates = [
    { teamId: r1.winnerTeamId as ObjectId, seed: seedOf(r1, r1.winnerTeamId) },
    { teamId: r2.winnerTeamId as ObjectId, seed: seedOf(r2, r2.winnerTeamId) },
  ].sort((a, b) => a.seed - b.seed);

  const thirdCandidates = [
    { teamId: r1.loserTeamId as ObjectId, seed: seedOf(r1, r1.loserTeamId) },
    { teamId: r2.loserTeamId as ObjectId, seed: seedOf(r2, r2.loserTeamId) },
  ].sort((a, b) => a.seed - b.seed);

  const today = deriveAblDate(new Date());
  const dates = nextAblGameDays(today, 7, { inclusive: true });

  const champGameIds = await createSeriesGamesOnDates(db, league._id, season._id, 'CHAMP', champCandidates[0].teamId, champCandidates[1].teamId, dates);
  const thirdGameIds = await createSeriesGamesOnDates(db, league._id, season._id, 'THIRD', thirdCandidates[0].teamId, thirdCandidates[1].teamId, dates);

  const newSeries = [
    ...bracket.series,
    {
      seriesId: 'CHAMP', round: 'second',
      higherSeedTeamId: champCandidates[0].teamId, lowerSeedTeamId: champCandidates[1].teamId,
      higherSeedOriginalSeed: champCandidates[0].seed, lowerSeedOriginalSeed: champCandidates[1].seed,
      gameIds: champGameIds, status: 'scheduled', winnerTeamId: null, loserTeamId: null, clinchedAtGameNumber: null,
      createdAt: new Date(),
    },
    {
      seriesId: 'THIRD', round: 'second',
      higherSeedTeamId: thirdCandidates[0].teamId, lowerSeedTeamId: thirdCandidates[1].teamId,
      higherSeedOriginalSeed: thirdCandidates[0].seed, lowerSeedOriginalSeed: thirdCandidates[1].seed,
      gameIds: thirdGameIds, status: 'scheduled', winnerTeamId: null, loserTeamId: null, clinchedAtGameNumber: null,
      createdAt: new Date(),
    },
  ];

  await updateBracket(db, bracket._id, { series: newSeries, status: 'second_round_in_progress' });
  return { status: 'second_round_in_progress', action: 'second_round_created' };
}

async function handleSecondRoundCompletionCheck(db: Db, bracket: any) {
  const { series, changed, allComplete } = await evaluateSeriesRound(db, bracket.series, 'second');
  const newStatus = allComplete ? 'complete' : bracket.status;
  if (changed || newStatus !== bracket.status) {
    await updateBracket(db, bracket._id, { series, status: newStatus });
  }
  return { status: newStatus, action: changed ? 'series_updated' : 'none' };
}

// ── Entry points ──────────────────────────────────────────────────────────────

export async function processPlayoffsForSeason(
  db: Db,
  league: { _id: ObjectId; slug: string },
  season: { _id: ObjectId; slug: string; leagueId: ObjectId },
) {
  const bracket = await getOrCreateBracket(db, league._id, season._id);

  switch (bracket.status) {
    case 'awaiting_regular_season_end':
      return handleRegularSeasonEndCheck(db, league, season, bracket);
    case 'seeding_in_progress':
      return handleTiebreakEvaluation(db, league, season, bracket);
    case 'seeded':
      return handleFirstRoundCreation(db, league, season, bracket);
    case 'first_round_in_progress':
      return handleFirstRoundCompletionCheck(db, bracket);
    case 'first_round_complete':
      return handleSecondRoundCreation(db, league, season, bracket);
    case 'second_round_in_progress':
      return handleSecondRoundCompletionCheck(db, bracket);
    case 'complete':
    default:
      return { status: bracket.status, action: 'none' };
  }
}

export async function processPlayoffsForAllSeasons(db: Db) {
  const seasons = await db.collection('seasons').find({}).toArray();
  const leagues = await db.collection('leagues').find({}).toArray();
  const leagueById = new Map(leagues.map((l: any) => [l._id.toString(), l]));

  const results: { league: string; season: string; status?: string; action?: string; ok: boolean; error?: string }[] = [];

  for (const season of seasons) {
    const league = leagueById.get(season.leagueId?.toString());
    if (!league?.slug || !season?.slug) continue;

    try {
      const outcome = await processPlayoffsForSeason(db, league as any, season as any);
      results.push({ league: league.slug, season: season.slug, ok: true, ...outcome });
    } catch (error) {
      results.push({
        league: league.slug,
        season: season.slug,
        ok: false,
        error: error instanceof Error ? error.message : 'Unknown error',
      });
    }
  }

  return results;
}
