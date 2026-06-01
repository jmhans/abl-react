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
    console.log(`\n🔍 CHECKING MISMATCH BETWEEN season.teamIds AND ablteams._id\n`);

    // Get the 2026 ABL season
    const season = await db.collection('seasons').findOne({ year: 2026, slug: '2026', isActive: true });
    
    console.log(`Season 2026 has ${season.teamIds.length} teamIds:`);
    console.log(`  ${season.teamIds.slice(0, 3).map(id => id.toString()).join('\n  ')}...\n`);

    // Get actual teams
    const actualTeamIds = await db.collection('ablteams').find({}).project({ _id: 1 }).toArray();
    console.log(`ablteams collection has ${actualTeamIds.length} teams with these IDs:`);
    console.log(`  ${actualTeamIds.slice(0, 3).map(t => t._id.toString()).join('\n  ')}...\n`);

    // Compare
    console.log(`First team in season.teamIds: ${season.teamIds[0]}`);
    console.log(`First team in ablteams: ${actualTeamIds[0]._id}\n`);

    // Check if any match
    const seasonTeamIdStrings = season.teamIds.map(id => id.toString());
    const actualTeamIdStrings = actualTeamIds.map(t => t._id.toString());
    
    const matching = seasonTeamIdStrings.filter(id => actualTeamIdStrings.includes(id));
    console.log(`Matching IDs: ${matching.length} / ${season.teamIds.length}`);
    
    if (matching.length === 0) {
      console.log(`\n⚠️  NO MATCHES - season.teamIds don't reference any actual teams!`);
      console.log(`\nThis is why the teams list is empty.`);
    }

  } catch (err) {
    console.error('❌ Error:', err);
    process.exit(1);
  } finally {
    await client.close();
  }
}

main();
