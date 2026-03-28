import { ReactNode } from 'react';
import { LeagueSeasonProvider } from '@/app/lib/league-season-context';

interface Props {
  children: ReactNode;
  params: Promise<{ league: string; season: string }>;
}

/**
 * Layout for all league-season-scoped pages.
 * Provides { league, season } to every page in this route tree
 * via LeagueSeasonProvider / useLeagueSeason().
 */
export default async function LeagueSeasonLayout({ children, params }: Props) {
  const { league, season } = await params;

  return (
    <LeagueSeasonProvider league={league} season={season}>
      {children}
    </LeagueSeasonProvider>
  );
}
