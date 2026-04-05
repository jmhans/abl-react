#!/usr/bin/env node

/**
 * Cleanup orphaned season data (teams, lineups, drafts, games) after accidental season deletion.
 * Usage: node scripts/cleanup-orphaned-season-data.mjs --league abl --year 2026
 */

import { MongoClient } from 'mongodb';
import process from 'process';

const MONGODB_URL = process.env.MONGODB_DB_URL || 'mongodb://localhost:27017';
const DB_NAME = process.env.MONGODB_DB || 'abl_dev';

async function main() {
  const args = process.argv.slice(2);
  const leagueIdx = args.indexOf('--league');
  const yearIdx = args.indexOf('--year');
  const confirmIdx = args.indexOf('--confirm');

  const league = leagueIdx >= 0 ? args[leagueIdx + 1] : null;
  const year = yearIdx >= 0 ? parseInt(args[yearIdx + 1]) : null;
  const confirmed = confirmIdx >= 0;

  if (!league || !year) {
    console.log('Usage: node scripts/cleanup-orphaned-season-data.mjs --league abl --year 2026 [--confirm]');
    process.exit(1);
  }

  const client = new MongoClient(MONGODB_URL);

  try {
    await client.connect();
    const db = client.db(DB_NAME);

    // Find the league
    const leagueDoc = await db.collection('leagues').findOne({ slug: league });
    if (!leagueDoc) {
      console.error(`League not found: ${league}`);
      process.exit(1);
    }

    console.log(`\n[${league} ${year}] Cleanup orphaned season data`);
    console.log(`League: ${leagueDoc.name}`);

    // Find teams for this league + year (by checking if season still exists)
    const season = await db.collection('seasons').findOne({
      leagueId: leagueDoc._id,
      year: year,
    });

    let teamIds = [];
    if (season) {
      console.log('Season still exists. Getting teamIds from season...');
      teamIds = (season.teamIds || []).map((id) =>
        typeof id === 'string' ? id : id.toString()
      );
    } else {
      console.log('Season deleted. Finding orphaned teams for this league...');
      // Find ALL teams for this league and check which year they belong to
      const allTeams = await db
        .collection('ablteams')
        .find({ leagueId: leagueDoc._id.toString() })
        .toArray();

      console.log(`Found ${allTeams.length} teams total for league ${league}`);

      // Try to infer which teams belong to 2026 by checking drafts/lineups
      const draftsForYear = await db
        .collection('drafts')
        .find({ year: year, leagueId: leagueDoc._id.toString() })
        .toArray();

      if (draftsForYear.length > 0) {
        // Get teamIds from draft orderIds
        const tempTeamIds = new Set();
        draftsForYear.forEach((d) => {
          (d.orderIds || []).forEach((tid) => tempTeamIds.add(tid));
        });
        teamIds = Array.from(tempTeamIds);
        console.log(`Found ${teamIds.length} teams in drafts for ${year}`);
      }

      if (teamIds.length === 0) {
        console.log('Could not find teams for this year. Checking lineups...');
        const lineups = await db.collection('lineups').find({}).toArray();
        const tempTeamIds = new Set();
        lineups.forEach((lu) => {
          tempTeamIds.add(lu.ablTeam.toString());
        });
        teamIds = Array.from(tempTeamIds);
        console.log(`Found ${teamIds.length} teams in lineups`);
      }
    }

    if (teamIds.length === 0) {
      console.log('No teams found for cleanup');
      process.exit(0);
    }

    // Count what will be deleted
    const lineupCount = await db.collection('lineups').countDocuments({
      ablTeam: { $in: teamIds.map((id) => (typeof id === 'string' ? id : id.toString())) },
    });

    const draftCount = await db.collection('drafts').countDocuments({
      year: year,
      leagueId: leagueDoc._id.toString(),
    });

    const gameCount = await db.collection('games').countDocuments({
      year: year,
      leagueId: leagueDoc._id.toString(),
    });

    const teamCount = teamIds.length;
    const seasonCount = season ? 1 : 0;

    console.log(`\nWill delete:`);
    console.log(`  - ${lineupCount} lineups`);
    console.log(`  - ${draftCount} drafts`);
    console.log(`  - ${gameCount} games`);
    console.log(`  - ${teamCount} teams`);
    if (seasonCount > 0) console.log(`  - ${seasonCount} season`);

    if (!confirmed) {
      console.log('\nRun with --confirm to actually delete');
      process.exit(0);
    }

    console.log('\n[Deleting...]');

    // Convert teamIds to ObjectId for query
    const { ObjectId } = await import('mongodb');
    const teamObjectIds = teamIds.map((id) =>
      typeof id === 'string' ? new ObjectId(id) : id
    );

    const r1 = await db.collection('lineups').deleteMany({
      ablTeam: { $in: teamObjectIds },
    });
    console.log(`✓ Deleted ${r1.deletedCount} lineups`);

    const r2 = await db.collection('drafts').deleteMany({
      year: year,
      leagueId: leagueDoc._id.toString(),
    });
    console.log(`✓ Deleted ${r2.deletedCount} drafts`);

    const r3 = await db.collection('games').deleteMany({
      year: year,
      leagueId: leagueDoc._id.toString(),
    });
    console.log(`✓ Deleted ${r3.deletedCount} games`);

    const r4 = await db.collection('ablteams').deleteMany({
      _id: { $in: teamObjectIds },
    });
    console.log(`✓ Deleted ${r4.deletedCount} teams`);

    if (season) {
      const r5 = await db.collection('seasons').deleteOne({
        _id: season._id,
      });
      console.log(`✓ Deleted ${r5.deletedCount} season`);
    }

    console.log('\n✅ Cleanup complete');
  } catch (error) {
    console.error('Error:', error.message);
    process.exit(1);
  } finally {
    await client.close();
  }
}

main();
