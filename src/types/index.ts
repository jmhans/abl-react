// Type definitions for ABL app based on MongoDB models

export interface Team {
  _id: string;
  nickname: string;
  city?: string;
  owner?: Owner;
  roster?: RosterPlayer[];
  wins?: number;
  losses?: number;
  ablRuns?: number;
}

export interface Owner {
  _id: string;
  name: string;
  email?: string;
  auth0Id?: string;
}

export interface Player {
  _id: string;
  name: string;
  mlbId?: number;
  team?: string;
  position?: string;
  stats?: PlayerStats;
  ablstatus?: {
    acqType?: 'draft' | 'pickup' | 'supp_draft';
    pending_drop?: boolean;
  };
}

export interface PlayerStats {
  batting?: {
    gamesPlayed?: number;
    atBats?: number;
    hits?: number;
    doubles?: number;
    triples?: number;
    homeRuns?: number;
    baseOnBalls?: number;
    hitByPitch?: number;
    stolenBases?: number;
    caughtStealing?: number;
  };
}

export interface RosterPlayer {
  _id: string;
  player: Player;
  lineupPosition?: string;
  rosterOrder?: number;
  ablstatus?: string;
}

export interface Game {
  _id: string;
  gameDate: string;
  mlbGameId?: number;
  awayTeam?: Team;
  homeTeam?: Team;
  status?: string;
  results?: GameResult[];
  summary?: GameSummary;
}

export interface GameResult {
  location: 'away' | 'home';
  attester?: string;
  score?: GameScore;
}

export interface GameScore {
  regulation: GameTotals;
  final: GameTotals;
}

export interface GameTotals {
  abl_runs: number;
  abl_points: number;
  e: number;
  ab: number;
  g: number;
  h: number;
  '2b': number;
  '3b': number;
  hr: number;
  bb: number;
  hbp: number;
  sac: number;
  sf: number;
  sb: number;
  cs: number;
  po: number;
  pb: number;
}

export interface GameSummary {
  awayTeam: string;
  homeTeam: string;
  status: boolean;
  score: {
    away: number;
    home: number;
  };
  winner?: Team;
  loser?: Team;
}

export interface Standing {
  team: Team;
  wins: number;
  losses: number;
  ablRuns: number;
  rank: number;
}
