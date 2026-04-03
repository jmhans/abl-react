/**
 * POST /api/players/sync-batting
 *
 * Expands the player pool beyond players captured by boxscore stat refresh.
 * Seeds `players` and `position_log` from three sources (in priority order):
 *
 *   1. mlbrosters (already synced) – all non-pitcher 40-man members.
 *      Captures injured / IL players who have no batting stats yet.
 *
 *   2. MLB Stats API spring training batting stats (gameType=S, sportId=1).
 *      Any position player with at least one AB in spring — includes top
 *      prospects on MLB spring rosters who haven't made the 40-man yet.
 *
 *   3. MLB Stats API early regular-season batting stats (gameType=R, sportId=1).
 *      Players with ABs in regular season games to date.
 *
 *   4. AAA spring training (gameType=S, sportId=11) — optional, pass ?withAAA=1.
 *
 * position_log entries are written with $setOnInsert so that real game-derived
 * eligibility from update-positions-2026.mjs is never overwritten.
 */

import { NextRequest, NextResponse } from 'next/server';
import { connectToDatabase } from '@/app/lib/mongodb';
import { getAdminAuthState } from '@/app/lib/admin-auth';

const MLB_API = 'https://statsapi.mlb.com/api/v1';
const SEASON = 2026;

const OF_SUBS = new Set(['LF', 'CF', 'RF']);
function normalizePos(pos: string): string {
  return OF_SUBS.has(pos) ? 'OF' : pos;
}

const BATTING_FIELDS = [
  'gamesPlayed', 'atBats', 'hits', 'doubles', 'triples', 'homeRuns',
  'baseOnBalls', 'intentionalWalks', 'hitByPitch', 'stolenBases',
  'caughtStealing', 'sacBunts', 'sacFlies',
] as const;

function extractBattingStats(stat: any): Record<string, number> {
  const b: Record<string, number> = {};
  for (const f of BATTING_FIELDS) {
    const v = Number(stat?.[f]);
    if (Number.isFinite(v) && v > 0) b[f] = v;
  }
  return b;
}

async function fetchBattingSplits(url: string): Promise<any[]> {
  try {
    const res = await fetch(url, { cache: 'no-store' });
    if (!res.ok) return [];
    const data = await res.json();
    return data?.stats?.[0]?.splits ?? [];
  } catch {
    return [];
  }
}

function makePlayerStatOp(mlbId: string, split: any) {
  return {
    updateOne: {
      filter: { mlbID: mlbId },
      update: {
        $set: {
          name: split.player?.fullName ?? '',
          team: split.team?.abbreviation ?? '',
          'stats.batting': extractBattingStats(split.stat),
          lastStatUpdate: new Date(),
        },
        $setOnInsert: {
          mlbID: mlbId,
          lastUpdate: new Date(),
        },
      },
      upsert: true,
    },
  };
}

function makePosLogOp(mlbId: string, normalPos: string) {
  // $setOnInsert: only writes if no position_log entry exists for this player/season.
  // update-positions-2026.mjs uses $set and will overwrite with accurate data later.
  return {
    updateOne: {
      filter: { mlbId, season: SEASON },
      update: {
        $setOnInsert: {
          mlbId,
          season: SEASON,
          eligiblePositions: [normalPos],
          maxPosition: normalPos,
        },
      },
      upsert: true,
    },
  };
}

export async function POST(request: NextRequest) {
  try {
    const { isAdmin } = await getAdminAuthState();
    if (!isAdmin) {
      return NextResponse.json({ error: 'Admin access required' }, { status: 403 });
    }

    const db = await connectToDatabase();
    const withAAA = request.nextUrl.searchParams.get('withAAA') === '1';

    const playerOps: any[] = [];
    const posLogOps: any[] = [];
    let fromRosters = 0;
    let fromSpringMlb = 0;
    let fromRegularMlb = 0;
    let fromAAA = 0;
    const errors: string[] = [];

    // ── 1. Seed from mlbrosters (40-man non-pitchers) ─────────────────────────
    try {
      const rosters = await db.collection('mlbrosters').find({}).toArray();
      for (const teamDoc of rosters) {
        for (const entry of (teamDoc.roster ?? [])) {
          const posAbbr: string = entry.position?.abbreviation ?? '';
          if (!posAbbr || posAbbr === 'P') continue;
          const mlbId = String(entry.person?.id ?? '');
          if (!mlbId) continue;

          const normalPos = normalizePos(posAbbr);

          playerOps.push({
            updateOne: {
              filter: { mlbID: mlbId },
              update: {
                $set: { team: teamDoc.teamAbbreviation },
                $setOnInsert: {
                  mlbID: mlbId,
                  name: entry.person?.fullName ?? '',
                  lastUpdate: new Date(),
                },
              },
              upsert: true,
            },
          });
          posLogOps.push(makePosLogOp(mlbId, normalPos));
          fromRosters++;
        }
      }
    } catch (err) {
      errors.push(`mlbrosters: ${err instanceof Error ? err.message : String(err)}`);
    }

    // ── 2. MLB spring training batting stats ──────────────────────────────────
    try {
      const splits = await fetchBattingSplits(
        `${MLB_API}/stats?stats=season&group=hitting&gameType=S&season=${SEASON}&sportId=1&limit=5000`,
      );
      for (const split of splits) {
        const mlbId = String(split.player?.id ?? '');
        const posAbbr: string = split.position?.abbreviation ?? 'DH';
        if (!mlbId || posAbbr === 'P') continue;
        playerOps.push(makePlayerStatOp(mlbId, split));
        posLogOps.push(makePosLogOp(mlbId, normalizePos(posAbbr)));
        fromSpringMlb++;
      }
    } catch (err) {
      errors.push(`spring training: ${err instanceof Error ? err.message : String(err)}`);
    }

    // ── 3. MLB regular-season batting stats ───────────────────────────────────
    try {
      const splits = await fetchBattingSplits(
        `${MLB_API}/stats?stats=season&group=hitting&gameType=R&season=${SEASON}&sportId=1&limit=5000`,
      );
      for (const split of splits) {
        const mlbId = String(split.player?.id ?? '');
        const posAbbr: string = split.position?.abbreviation ?? 'DH';
        if (!mlbId || posAbbr === 'P') continue;
        playerOps.push(makePlayerStatOp(mlbId, split));
        posLogOps.push(makePosLogOp(mlbId, normalizePos(posAbbr)));
        fromRegularMlb++;
      }
    } catch (err) {
      errors.push(`regular season: ${err instanceof Error ? err.message : String(err)}`);
    }

    // ── 4. AAA spring training (optional) ─────────────────────────────────────
    if (withAAA) {
      try {
        const splits = await fetchBattingSplits(
          `${MLB_API}/stats?stats=season&group=hitting&gameType=S&season=${SEASON}&sportId=11&limit=5000`,
        );
        for (const split of splits) {
          const mlbId = String(split.player?.id ?? '');
          const posAbbr: string = split.position?.abbreviation ?? 'DH';
          if (!mlbId || posAbbr === 'P') continue;
          playerOps.push(makePlayerStatOp(mlbId, split));
          posLogOps.push(makePosLogOp(mlbId, normalizePos(posAbbr)));
          fromAAA++;
        }
      } catch (err) {
        errors.push(`AAA spring: ${err instanceof Error ? err.message : String(err)}`);
      }
    }

    // ── Apply in batches ──────────────────────────────────────────────────────
    const BATCH = 500;
    let playersUpserted = 0;
    for (let i = 0; i < playerOps.length; i += BATCH) {
      const r = await db
        .collection('players')
        .bulkWrite(playerOps.slice(i, i + BATCH), { ordered: false });
      playersUpserted += r.upsertedCount + r.modifiedCount;
    }

    let posLogUpserted = 0;
    for (let i = 0; i < posLogOps.length; i += BATCH) {
      const r = await db
        .collection('position_log')
        .bulkWrite(posLogOps.slice(i, i + BATCH), { ordered: false });
      posLogUpserted += r.upsertedCount + r.modifiedCount;
    }

    return NextResponse.json({
      ok: true,
      sources: {
        fromRosters,
        fromSpringMlb,
        fromRegularMlb,
        ...(withAAA ? { fromAAA } : {}),
      },
      playerOpsTotal: playerOps.length,
      playersUpserted,
      posLogUpserted,
      ...(errors.length > 0 ? { errors } : {}),
    });
  } catch (error) {
    console.error('sync-batting error:', error);
    return NextResponse.json(
      { error: error instanceof Error ? error.message : 'Failed to sync batting data' },
      { status: 500 },
    );
  }
}
