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
    console.log(`\n🔍 CHECKING ALL SEASONS AND THEIR TEAMS\n`);

    const seasons = await db.collection('seasons').find({ year: 2026, isActive: true }).toArray();
    
    for (const season of seasons) {
      const leagueId = season.leagueId;
      const league = await db.collection('leagues').findOne({ _id: leagueId });
      
      console.log(`Season: ${league.slug} (${season.year})`);
      console.log(`  leagueId: ${leagueId}`);
      console.log(`  teamIds (${season.teamIds.length}):`);
      
      // Check what type teamIds[0] is
      const firstId = season.teamIds[0];
      console.log(`    Type of teamIds[0]: ${firstId.constructor.name}`);
      console.log(`    Value: ${firstId}`);
      
      // Try to find teams
      const found = await db.collection('ablteams').find({ _id: { $in: season.teamIds } }).toArray();
      console.log(`  ✓ Found ${found.length} matching teams\n`);
      
      if (found.length > 0) {
        console.log(`  Team samples:`);
        found.slice(0, 2).forEach(t => {
          console.log(`    - ${t.location || ''} ${t.nickname}`);
        });
      } else {
        console.log(`  ⚠️  NO TEAMS FOUND!`);
        console.log(`  Checking if teamIds are valid ObjectIds...`);
        
        // Check backend: get all ablteams IDs
        const allTeams = await db.collection('ablteams').find({}).project({ _id: 1 }).toArray();
        console.log(`  Total teams in ablteams: ${allTeams.length}`);
        console.log(`  All team IDs in ablteams:\n    ${allTeams.slice(0, 5).map(t => `${t._id} (${t._id.constructor.name})`).join('\n    ')}`);
      }
      console.log();
    }

  } catch (err) {
    console.error('❌ Error:', err);
    process.exit(1);
  } finally {
    await client.close();
  }
}

main();
