'use client';

import { createContext, useContext, ReactNode } from 'react';

export interface LeagueSeasonCtx {
  /** e.g. "abl" */
  league: string;
  /** e.g. "2025" */
  season: string;
}

const LeagueSeasonContext = createContext<LeagueSeasonCtx | null>(null);

export function LeagueSeasonProvider({
  league,
  season,
  children,
}: LeagueSeasonCtx & { children: ReactNode }) {
  return (
    <LeagueSeasonContext.Provider value={{ league, season }}>
      {children}
    </LeagueSeasonContext.Provider>
  );
}

/**
 * Returns the current league + season context.
 * Must be used inside app/[league]/[season]/ route tree.
 */
export function useLeagueSeason(): LeagueSeasonCtx {
  const ctx = useContext(LeagueSeasonContext);
  if (!ctx) {
    throw new Error('useLeagueSeason must be used within a [league]/[season] route segment');
  }
  return ctx;
}

/** Build a query string fragment from the current context, e.g. "league=abl&season=2025" */
export function leagueSeasonQuery(ctx: LeagueSeasonCtx): string {
  return `league=${encodeURIComponent(ctx.league)}&season=${encodeURIComponent(ctx.season)}`;
}
