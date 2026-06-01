/**
 * Supplemental Draft (Supp Draft) utilities.
 *
 * The supp draft runs once per year per league. Key rules:
 *  - Draft order: reverse standings (lower W-L first), tiebreak = lower avg ABL runs
 *  - No snake: picks go 1-N every round in the same order
 *  - Min 3 rounds; extra rounds are added so that (original draft picks - drops indicated + supp picks) = 27 per team
 *  - acqType for picks: 'supp_draft' — behaves like 'draft' (no drop allowed)
 */

import { TOTAL_DRAFT_ROUNDS } from '@/app/lib/draft-utils';

export const SUPP_DRAFT_TARGET_ROSTER = 27;
export const SUPP_DRAFT_MIN_ROUNDS = 3;

// Regular draft picks each team gets
const REGULAR_DRAFT_PICKS_PER_TEAM = TOTAL_DRAFT_ROUNDS;

/**
 * Calculate how many supp draft rounds are needed given the maximum number
 * of drop indications any single team has made.
 *
 * Each drop indication means a team will lose one player at finalization,
 * so they need one extra supp draft pick to stay at 27 total.
 *
 * rounds = max(MIN_ROUNDS, MIN_ROUNDS + maxDropsForAnyTeam)
 */
export function calculateSuppDraftRounds(dropCountByTeamId: Record<string, number>): number {
  const maxDrops = Object.values(dropCountByTeamId).reduce((max, n) => Math.max(max, n), 0);
  return Math.max(SUPP_DRAFT_MIN_ROUNDS, SUPP_DRAFT_MIN_ROUNDS + maxDrops);
}

export type SuppDraftBoardPick = {
  overallPick: number;
  round: number;
  roundPick: number;
  teamId: string;
};

/**
 * Build the supp draft board.
 * No snake — each round uses the same team order.
 * Teams only get slots up to their individual pick limit:
 *   limit = SUPP_DRAFT_MIN_ROUNDS + dropCount for that team.
 * Pass dropCountByTeamId to apply per-team limits; omit to give all teams
 * the full `rounds` worth of slots (used for board display only).
 */
export function buildSuppDraftBoard(
  teamIds: string[],
  rounds: number,
  dropCountByTeamId?: Record<string, number>,
): SuppDraftBoardPick[] {
  const picks: SuppDraftBoardPick[] = [];
  let overallPick = 1;
  for (let round = 1; round <= rounds; round++) {
    for (let i = 0; i < teamIds.length; i++) {
      const teamId = teamIds[i];
      const limit = dropCountByTeamId !== undefined
        ? SUPP_DRAFT_MIN_ROUNDS + (dropCountByTeamId[teamId] ?? 0)
        : rounds;
      if (round > limit) continue; // this team doesn't pick in this round
      picks.push({
        overallPick: overallPick++,
        round,
        roundPick: i + 1,
        teamId,
      });
    }
  }
  return picks;
}

export type SuppDraftDropIndication = {
  teamId: string;
  playerId: string;
  indicatedAt: string; // ISO date string
};

export type SuppDraftPickEntry = {
  pick: SuppDraftBoardPick;
  playerId: string;
  draftedAt: string;
};

export type SuppDraftStatus = 'pending' | 'active' | 'completed' | 'finalized' | 'abandoned';

// ---------------------------------------------------------------------------
// Pick timer / quiet-hours utilities
// ---------------------------------------------------------------------------

/** Quiet hours: timer won't expire between 10pm and 8am US Central Time. */
export const PICK_TIMER_TZ = 'America/Chicago';
export const QUIET_START_HOUR = 22; // 10 pm
export const QUIET_END_HOUR = 8;   // 8 am
export const DEFAULT_PICK_TIME_MINUTES = 120;

/** Returns true if `date` falls within the quiet-hours window (10pm–8am CT). */
export function isQuietTime(date: Date): boolean {
  const hour = parseInt(
    new Intl.DateTimeFormat('en-US', {
      timeZone: PICK_TIMER_TZ,
      hour: 'numeric',
      hour12: false,
    }).format(date),
    10
  );
  return hour >= QUIET_START_HOUR || hour < QUIET_END_HOUR;
}

/**
 * Compute the wall-clock deadline for a pick given its start time and the
 * allowed number of minutes.  Quiet-hours windows (10pm–8am CT) are skipped:
 * only minutes where `isQuietTime` is false count toward the limit.
 *
 * Works by advancing 1-minute steps and only counting non-quiet minutes.
 * Worst case iterations ≈ pickTimeMinutes + (quiet hours in window) which
 * is well under 1 000 for any reasonable timer setting.
 */
export function computePickDeadline(startedAt: Date, pickTimeMinutes: number): Date {
  let current = new Date(startedAt.getTime());
  let activeAccumulated = 0;
  // Cap iterations to prevent infinite loops on absurd inputs
  const MAX_ITER = pickTimeMinutes + 60 * 24 * 2; // 2 days max
  let iter = 0;
  while (activeAccumulated < pickTimeMinutes && iter < MAX_ITER) {
    if (!isQuietTime(current)) {
      activeAccumulated++;
    }
    current = new Date(current.getTime() + 60_000);
    iter++;
  }
  return current;
}

/** Shape of the supp_drafts document as returned from the API. */
export type SuppDraftApiState = {
  _id: string;
  leagueId: string;
  seasonId: string;
  status: SuppDraftStatus;
  scheduledAt: string | null;
  rounds: number;
  orderIds: string[];
  picks: HydratedSuppDraftPick[];
  dropIndications: SuppDraftDropIndication[];
  skippedTeams: string[];
  /** When a team resumes from a skip, the `overallPick` of the slot that was on the
   *  clock at resume time is stored here.  The clock is held at that slot until it is
   *  filled, then natural board-order takes over (which will jump back to the resumed
   *  team's earliest missed slot).  Self-healing: once the slot is filled the condition
   *  `!filledSlotKeys.has(...)` is false, so the lock is automatically ignored. */
  lockedUntilOverallPick?: number | null;
  /** Minutes allowed per pick (default 120). */
  pickTimeMinutes: number;
  /** Wall-clock deadline for the current pick, accounting for quiet-hours pauses. */
  pickDeadlineAt: string | null;
  /** Map of teamId → ordered list of player IDs the owner wants to draft. */
  draftQueues: Record<string, string[]>;
  /** Team IDs that have opted into auto-draft (pick from queue/algo immediately on their turn). */
  autoDraftTeams: string[];
  createdAt: string;
  startedAt: string | null;
  completedAt: string | null;
};

export type SuppDraftPlayer = {
  _id: string;
  name: string;
  team?: string;
  position?: string;
  eligible?: string[];
  mlbPosition?: string;
  mlbID?: string | number;
  status?: string;
  stats?: any;
  abl?: number;
  ablProjected?: number | null;
  projSystem?: string | null;
  projStats?: any;
  // Supp draft specific
  onRosterTeamId?: string | null;  // null = free agent / pickup
  onRosterAcqType?: 'draft' | 'supp_draft' | 'pickup' | string | null;
  isDropIndicated?: boolean;
};

export type HydratedSuppDraftPick = {
  pick: SuppDraftBoardPick;
  player: SuppDraftPlayer;
  draftedAt: string;
};

/**
 * Returns the number of picks a team needs from the supp draft to reach the
 * target roster size (SUPP_DRAFT_TARGET_ROSTER), accounting for drops.
 */
export function getSuppDraftPicksNeeded(
  regularDraftPickCount: number,
  dropCount: number,
): number {
  return Math.max(0, SUPP_DRAFT_TARGET_ROSTER - (regularDraftPickCount - dropCount));
}

/**
 * Given a drop-count map and the board, build a per-team summary of
 * how many supp draft picks they need.
 */
export function buildSuppDraftNeedsMap(
  teamIds: string[],
  dropCountByTeamId: Record<string, number>,
  regularPickCountByTeamId?: Record<string, number>,
): Record<string, number> {
  return Object.fromEntries(
    teamIds.map((teamId) => {
      const regularPicks = regularPickCountByTeamId?.[teamId] ?? REGULAR_DRAFT_PICKS_PER_TEAM;
      const drops = dropCountByTeamId[teamId] ?? 0;
      return [teamId, getSuppDraftPicksNeeded(regularPicks, drops)];
    }),
  );
}

export const MAX_DROP_INDICATIONS = 3;
