import { NextResponse } from 'next/server';
import { connectToDatabase } from '@/app/lib/mongodb';
import { getAdminAuthState } from '@/app/lib/admin-auth';

const MLB_API_BASE = 'https://statsapi.mlb.com/api/v1';

async function fetchJson(url: string) {
  const res = await fetch(url, { cache: 'no-store' });
  if (!res.ok) throw new Error(`MLB API error ${res.status} for ${url}`);
  return res.json();
}

export async function POST() {
  try {
    const { isAdmin } = await getAdminAuthState();
    if (!isAdmin) {
      return NextResponse.json({ error: 'Admin access required' }, { status: 403 });
    }

    const db = await connectToDatabase();

    // 1. Get all MLB teams
    const teamsData = await fetchJson(`${MLB_API_BASE}/teams?sportId=1`);
    const teams: Array<{ id: number; abbreviation: string; name: string }> =
      teamsData?.teams || [];

    if (teams.length === 0) {
      return NextResponse.json({ error: 'No MLB teams returned from API' }, { status: 502 });
    }

    // 2. For each team fetch 40-man roster and upsert into mlbrosters
    //    players_view is defined to $lookup from mlbrosters and derive status
    //    from roster[].status.description — so we write here, not to players.
    let totalPlayers = 0;
    let teamsUpdated = 0;
    const errors: string[] = [];

    for (const team of teams) {
      try {
        const rosterData = await fetchJson(
          `${MLB_API_BASE}/teams/${team.id}/roster?rosterType=40Man`,
        );

        const roster: any[] = rosterData?.roster || [];
        totalPlayers += roster.length;

        // Store the full roster array (person + status + position) keyed by teamId.
        // This matches the structure the players_view pipeline expects:
        //   $unwind "$roster"  →  project roster.person, roster.status  →  match by mlbID
        await db.collection('mlbrosters').updateOne(
          { teamId: team.id },
          {
            $set: {
              teamId: team.id,
              teamAbbreviation: team.abbreviation,
              teamName: team.name,
              roster,
              lastUpdate: new Date(),
            },
          },
          { upsert: true },
        );

        teamsUpdated++;
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        errors.push(`Team ${team.abbreviation} (${team.id}): ${msg}`);
      }
    }

    return NextResponse.json({
      ok: true,
      teamsProcessed: teams.length,
      teamsUpdated,
      playersFound: totalPlayers,
      errors: errors.length > 0 ? errors : undefined,
    });
  } catch (error) {
    console.error('Error syncing rosters:', error);
    return NextResponse.json(
      { error: error instanceof Error ? error.message : 'Failed to sync rosters' },
      { status: 500 },
    );
  }
}
