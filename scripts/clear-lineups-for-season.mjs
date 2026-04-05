/**
 * clear-lineups-for-season.mjs
 * 
 * Removes all lineup documents for teams in a given season.
 * Safe to run — just deletes lineup docs so rosters show as empty.
 * 
 * Usage:
 *   node scripts/clear-lineups-for-season.mjs --season 2026
 *   node scripts/clear-lineups-for-season.mjs --seasonId 69c9e8e84fbcf737103cb0e1
 */

import { MongoClient, ObjectId } from 'mongodb';
import { readFileSync } from 'fs';
import { resolve, dirname } from 'path';
import { fileURLToPath } from 'url';

const __dirname = dirname(fileURLToPath(import.meta.url));
for (const line of readFileSync(resolve(__dirname, '..', '.env.local'), 'utf8').split(/\r?\n/)) {
  const m = line.match(/^([^#=\r]+)=(.*\S*)/);
  if (m) process.env[m[1].trim()] = m[2].trim();
}

const args = process.argv.slice(2);
const seasonYear = args.includes('--season') ? args[args.indexOf('--season') + 1] : null;
const seasonId = args.includes('--seasonId') ? args[args.indexOf('--seasonId') + 1] : null;

if (!seasonYear && !seasonId) {
  console.error('❌ Usage: node scripts/clear-lineups-for-season.mjs --season 2026');
  console.error('   or: node scripts/clear-lineups-for-season.mjs --seasonId <id>');
  process.exit(1);
}

const client = new MongoClient(process.env.MONGODB_URI);
await client.connect();
const db = client.db(process.env.MONGODB_DB || 'abl_dev');

try {
  // Find the season
  let season;
  if (seasonId) {
    season = await db.collection('seasons').findOne({ _id: new ObjectId(seasonId) });
  } else {
    season = await db.collection('seasons').findOne({ year: Number(seasonYear) });
  }

  if (!season) {
    console.error(`❌ Season not found: ${seasonYear || seasonId}`);
    process.exit(1);
  }

  console.log(`\n🔍 Found season: Year ${season.year}, ID: ${season._id}`);
  console.log(`   Teams in season: ${season.teamIds?.length ?? 0}`);

  // Get all lineups for this season's teams
  const teamIds = (season.teamIds ?? []).map((id) => new ObjectId(id));
  const lineupCount = await db.collection('lineups').countDocuments({
    ablTeam: { $in: teamIds },
  });

  console.log(`   Existing lineup docs: ${lineupCount}`);

  if (lineupCount === 0) {
    console.log('   ✅ No lineups to clear');
    await client.close();
    process.exit(0);
  }

  // Ask for confirmation
  console.log(`\n⚠️  This will DELETE ${lineupCount} lineup document(s).`);
  console.log('   After deletion, all players will appear as free agents.');

  if (!process.env.SKIP_CONFIRM) {
    console.log('\n❌ Add --confirm flag to proceed:');
    console.log('   node scripts/clear-lineups-for-season.mjs --season 2026 --confirm');
    await client.close();
    process.exit(0);
  }

  // Delete the lineups
  const result = await db.collection('lineups').deleteMany({
    ablTeam: { $in: teamIds },
  });

  console.log(`\n✅ Deleted ${result.deletedCount} lineup document(s)`);
  console.log('   All players for this season are now free agents.');

  await client.close();
} catch (error) {
  console.error('❌ Error:', error);
  process.exit(1);
}
