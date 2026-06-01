import { MongoClient } from 'mongodb';
import * as fs from 'fs';
import * as path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

// Load MONGODB_URI from env or .env.local
let mongoUri = process.env.MONGODB_URI;
if (!mongoUri) {
  try {
    const envPath = path.resolve(__dirname, '../.env.local');
    const envLocal = fs.readFileSync(envPath, 'utf-8');
    const match = envLocal.match(/^MONGODB_URI=(.+)$/m);
    if (match) {
      mongoUri = match[1].trim().replace(/^['"]|['"]$/g, '');
    }
  } catch (e) {
    console.error('❌ Could not find MONGODB_URI');
    process.exit(1);
  }
}

const client = new MongoClient(mongoUri);
const db = client.db('abl_dev');

async function main() {
  try {
    console.log(`\n🔍 CHECKING LEAGUES & SEASONS in DEV\n`);

    // Get leagues
    const leagues = await db.collection('leagues').find({}).toArray();
    console.log(`📚 LEAGUES (${leagues.length}):`);
    leagues.forEach(l => {
      console.log(`  - ${l.slug}: ${l.name} (id: ${l._id})`);
    });

    // Get seasons
    const seasons = await db.collection('seasons').find({}).toArray();
    console.log(`\n📅 SEASONS (${seasons.length}):`);
    seasons.forEach(s => {
      console.log(`  - Year ${s.year}, slug: ${s.slug}`);
      console.log(`    leagueId: ${s.leagueId}`);
      console.log(`    isActive: ${s.isActive}`);
      console.log(`    status: ${s.status}`);
      console.log(`    teamIds: ${s.teamIds ? s.teamIds.length : 0} teams`);
      if (s.teamIds && s.teamIds.length > 0) {
        console.log(`      ${s.teamIds.slice(0, 3).join(', ')}${s.teamIds.length > 3 ? '...' : ''}`);
      }
    });

    // Get teams
    const teams = await db.collection('ablteams').find({}).limit(5).toArray();
    console.log(`\n👥 TEAMS (first 5 of ${await db.collection('ablteams').countDocuments()}):`);
    teams.forEach(t => {
      console.log(`  - ${t.nickname} (id: ${t._id})`);
    });

  } catch (err) {
    console.error('❌ Error:', err);
    process.exit(1);
  } finally {
    await client.close();
  }
}

main();
