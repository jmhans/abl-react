import { NextRequest, NextResponse } from 'next/server';
import { connectToDatabase } from '@/app/lib/mongodb';
import { ObjectId } from 'mongodb';
import { resolveLeagueContext } from '@/app/lib/league-context';

interface CSVRow {
  team1: string;
  team2: string;
  gameDate: string;
}

interface GameToCreate {
  awayTeam: string;
  homeTeam: string;
  gameDate: string;
}

/**
 * POST /api/games/import-schedule
 * 
 * Imports games from CSV with format: team1 | team2 | gameDate
 * 
 * Query params:
 *   - league: league slug (required)
 *   - season: season year (required)
 * 
 * Body:
 *   - csv: string with pipe-delimited rows (team1 | team2 | gameDate)
 *   - games: array of { team1, team2, gameDate } (alternative format)
 */
export async function POST(request: NextRequest) {
  try {
    const db = await connectToDatabase();
    const { searchParams } = new URL(request.url);
    const leagueParam = searchParams.get('league');
    const seasonParam = searchParams.get('season');

    if (!leagueParam || !seasonParam) {
      return NextResponse.json(
        { error: 'league and season query params required' },
        { status: 400 }
      );
    }

    // Resolve league context
    const ctx = await resolveLeagueContext(db, leagueParam, seasonParam);

    // Parse request
    const body = await request.json();
    let rows: CSVRow[] = [];

    if (body.csv) {
      // Parse CSV format: team1 | team2 | gameDate
      const lines = body.csv.trim().split('\n');
      for (const line of lines) {
        const parts = line.split('|').map((p: string) => p.trim());
        if (parts.length >= 3) {
          rows.push({
            team1: parts[0],
            team2: parts[1],
            gameDate: parts[2],
          });
        }
      }
    } else if (body.games) {
      // Direct format
      rows = body.games;
    }

    if (rows.length === 0) {
      return NextResponse.json(
        { error: 'No valid games found in CSV' },
        { status: 400 }
      );
    }

    // Get all teams in the season
    const teamIds = ctx.season.teamIds.map((id: any) => 
      typeof id === 'string' ? new ObjectId(id) : id
    );
    const teams = await db.collection('ablteams')
      .find({ _id: { $in: teamIds } })
      .toArray();

    // Build team lookup by name, abbrev, and various aliases
    const teamMap = new Map<string, string>();
    for (const team of teams) {
      const key = (s: string) => s.toLowerCase().trim();
      teamMap.set(key(team.name), team._id.toString());
      teamMap.set(key(team.abbrev ?? ''), team._id.toString());
      if (team.aliases) {
        for (const alias of team.aliases) {
          teamMap.set(key(alias), team._id.toString());
        }
      }
    }

    // Process games
    const gamesToCreate: any[] = [];
    const errors: string[] = [];

    for (let i = 0; i < rows.length; i++) {
      const row = rows[i];
      const lineNum = i + 1;

      const team1Id = teamMap.get(row.team1.toLowerCase().trim());
      const team2Id = teamMap.get(row.team2.toLowerCase().trim());

      if (!team1Id) {
        errors.push(`Line ${lineNum}: Team "${row.team1}" not found`);
        continue;
      }
      if (!team2Id) {
        errors.push(`Line ${lineNum}: Team "${row.team2}" not found`);
        continue;
      }

      const gameDate = new Date(row.gameDate);
      if (isNaN(gameDate.getTime())) {
        errors.push(`Line ${lineNum}: Invalid date "${row.gameDate}"`);
        continue;
      }

      gamesToCreate.push({
        leagueId: ctx.league._id,
        seasonId: ctx.season._id,
        awayTeam: new ObjectId(team1Id),
        homeTeam: new ObjectId(team2Id),
        gameDate,
        gameType: 'R',
        status: 'pending',
      });
    }

    if (errors.length > 0) {
      return NextResponse.json(
        { 
          error: 'Some rows had errors',
          errors,
          validGames: gamesToCreate.length,
        },
        { status: 400 }
      );
    }

    // Check for duplicates
    const duplicateErrors: string[] = [];
    for (const game of gamesToCreate) {
      const existing = await db.collection('games').findOne({
        awayTeam: game.awayTeam,
        homeTeam: game.homeTeam,
        gameDate: game.gameDate,
        seasonId: game.seasonId,
      });
      if (existing) {
        duplicateErrors.push(
          `Duplicate: ${teams.find(t => t._id.equals(game.awayTeam))?.abbrev ?? '?'} @ ${teams.find(t => t._id.equals(game.homeTeam))?.abbrev ?? '?'} on ${game.gameDate.toDateString()}`
        );
      }
    }

    if (duplicateErrors.length > 0) {
      return NextResponse.json(
        {
          error: 'Some games already exist',
          duplicates: duplicateErrors,
          validGames: gamesToCreate.length,
        },
        { status: 400 }
      );
    }

    // Insert games
    const result = await db.collection('games').insertMany(gamesToCreate);
    const gameIds = Object.values(result.insertedIds);
    const createdGames = await db.collection('games')
      .find({ _id: { $in: gameIds } })
      .toArray();

    return NextResponse.json({
      created: createdGames.length,
      games: createdGames,
    }, { status: 201 });
  } catch (error) {
    console.error('Error importing schedule:', error);
    return NextResponse.json(
      { error: error instanceof Error ? error.message : 'Failed to import schedule' },
      { status: 500 }
    );
  }
}
