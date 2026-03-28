export const TOTAL_DRAFT_ROUNDS = 24;
export const STANDARD_SNAKE_ROUNDS = 18;
export const GROUPED_ROUND_SIZE = 3;

export const REQUIRED_POSITION_SLOTS = ['C', '1B', '2B', '3B', 'SS', 'OF', 'OF', 'OF'] as const;

export type DraftTeam = {
  _id: string;
  nickname: string;
  location?: string;
  owners?: Array<{
    name?: string;
    email?: string;
  }>;
};

export type DraftPlayer = {
  _id: string;
  name: string;
  team?: string;
  position?: string;
  eligible?: string[];
  mlbPosition?: string;
  status?: string;
  stats?: any;
};

export type DraftBoardPick = {
  overallPick: number;
  round: number;
  roundPick: number;
  teamId: string;
  grouped: boolean;
  groupStartRound: number | null;
  groupEndRound: number | null;
};

export type DraftedPlayerPick = {
  pick: DraftBoardPick;
  player: DraftPlayer & { abl?: number; eligible: string[] };
  draftedAt: string;
};

export function calculateDraftAblScore(stats: any): number {
  if (!stats || !stats.batting || stats.batting.atBats === 0) {
    return 0;
  }

  const b = stats.batting;
  const points =
    (b.hits || 0) * 25 +
    (b.doubles || 0) * 10 +
    (b.triples || 0) * 20 +
    (b.homeRuns || 0) * 30 +
    (b.baseOnBalls || 0) * 10 +
    (b.hitByPitch || 0) * 10 +
    (b.stolenBases || 0) * 7 +
    (b.caughtStealing || 0) * -7 +
    (b.pickoffs || 0) * -7 +
    ((b.sacBunts || 0) + (b.sacFlies || 0)) * 5;

  return points / b.atBats - 4.5;
}

export function getDraftEligiblePositions(player: DraftPlayer): string[] {
  // Primary source: eligible field from players_view
  if (Array.isArray(player.eligible) && player.eligible.length > 0) {
    return player.eligible;
  }

  // Fallback to position field
  if (player.position && typeof player.position === 'string' && player.position.length > 0) {
    return [player.position];
  }

  // Last resort: parse mlbPosition
  if (player.mlbPosition && typeof player.mlbPosition === 'string') {
    const pos = player.mlbPosition.toUpperCase();
    if (pos.includes('C')) return ['C'];
    if (pos.includes('1B')) return ['1B'];
    if (pos.includes('2B')) return ['2B'];
    if (pos.includes('3B')) return ['3B'];
    if (pos.includes('SS')) return ['SS'];
    if (pos.includes('OF')) return ['OF'];
    if (pos.includes('DH')) return ['DH'];
  }

  // Only return all positions if truly nothing is available
  console.warn(`Player ${player.name} has no eligibility data`);
  return [];
}

export function normalizeEligiblePositions(positions: string[]): string[] {
  const normalized = new Set<string>();
  for (const position of positions) {
    const upper = position.toUpperCase();
    if (upper === 'LF' || upper === 'CF' || upper === 'RF') {
      normalized.add('OF');
    }
    normalized.add(upper);
  }
  return Array.from(normalized);
}

export function canPlayerFillSlot(player: { eligible: string[] }, slot: string): boolean {
  const eligible = normalizeEligiblePositions(player.eligible);
  return eligible.includes(slot);
}

export function buildDraftBoard(teamIds: string[]): DraftBoardPick[] {
  const picks: DraftBoardPick[] = [];
  let overallPick = 1;

  for (let round = 1; round <= STANDARD_SNAKE_ROUNDS; round++) {
    const roundOrder = round % 2 === 1 ? teamIds : [...teamIds].reverse();
    roundOrder.forEach((teamId, index) => {
      picks.push({
        overallPick: overallPick++,
        round,
        roundPick: index + 1,
        teamId,
        grouped: false,
        groupStartRound: null,
        groupEndRound: null,
      });
    });
  }

  for (let blockStart = STANDARD_SNAKE_ROUNDS + 1; blockStart <= TOTAL_DRAFT_ROUNDS; blockStart += GROUPED_ROUND_SIZE) {
    const blockIndex = Math.floor((blockStart - (STANDARD_SNAKE_ROUNDS + 1)) / GROUPED_ROUND_SIZE);
    const blockEnd = Math.min(blockStart + GROUPED_ROUND_SIZE - 1, TOTAL_DRAFT_ROUNDS);
    const blockOrder = blockIndex % 2 === 0 ? teamIds : [...teamIds].reverse();

    blockOrder.forEach((teamId, index) => {
      for (let round = blockStart; round <= blockEnd; round++) {
        picks.push({
          overallPick: overallPick++,
          round,
          roundPick: index + 1,
          teamId,
          grouped: true,
          groupStartRound: blockStart,
          groupEndRound: blockEnd,
        });
      }
    });
  }

  return picks;
}

export function assignDraftSlots(teamPicks: DraftedPlayerPick[]) {
  const requiredSlots = REQUIRED_POSITION_SLOTS.map((slot, index) => ({
    slot,
    label: slot === 'OF' ? `OF${index - 4}` : slot,
    player: null as DraftedPlayerPick | null,
  }));

  const extras: DraftedPlayerPick[] = [];

  for (const pick of teamPicks) {
    const slotIndex = requiredSlots.findIndex((entry) => !entry.player && canPlayerFillSlot(pick.player, entry.slot));
    if (slotIndex >= 0) {
      requiredSlots[slotIndex].player = pick;
    } else {
      extras.push(pick);
    }
  }

  const filledRequiredCount = requiredSlots.filter((slot) => !!slot.player).length;

  return {
    requiredSlots,
    extras,
    filledRequiredCount,
    missingRequiredCount: requiredSlots.length - filledRequiredCount,
  };
}

export function getTeamDisplayName(team: DraftTeam): string {
  return [team.location, team.nickname].filter(Boolean).join(' ');
}

export function getOwnerDisplay(team: DraftTeam): string {
  const owners = team.owners || [];
  if (owners.length === 0) return 'No owner listed';
  return owners.map((owner) => owner.name || owner.email || 'Unknown').join(', ');
}
