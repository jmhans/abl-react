import { MongoClient } from 'mongodb';
import * as fs from 'fs';
import * as path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

let mongoUri = process.env.MONGODB_URI;
if (!mongoUri) {
  try {
    const envPath = path.resolve(__dirname, '../.env.local');
    const envLocal = fs.readFileSync(envPath, 'utf-8');
    const match = envLocal.match(/^MONGODB_URI=(.+)$/m);
    if (match) mongoUri = match[1].trim().replace(/^['"]|['"]$/g, '');
  } catch (e) {
    process.exit(1);
  }
}

const client = new MongoClient(mongoUri);
const db = client.db('abl_dev');

async function main() {
  try {
    console.log(`\n🔍 CHECKING DATA TYPES AFTER RESTORE\n`);

    const season = await db.collection('seasons').findOne({ year: 2026 });
    console.log(`Season 2026:`);
    console.log(`  teamIds[0]: ${season.teamIds[0]} (${season.teamIds[0].constructor.name})`);
    if (season.teamIds.length > 1) {
      console.log(`  teamIds[1]: ${season.teamIds[1]} (${season.teamIds[1].constructor.name})`);
    }

    const team = await db.collection('ablteams').findOne({});
    console.log(`\nTeam sample:`);
    console.log(`  _id: ${team._id} (${team._id.constructor.name})`);
    console.log(`  nickname: ${team.nickname}\n`);

    // Try the direct query
    console.log(`Query 1: { _id: { $in: season.teamIds } }`);
    const result1 = await db.collection('ablteams').find({ _id: { $in: season.teamIds } }).toArray();
    console.log(`  Found: ${result1.length} teams\n`);

    // Try with converted IDs
    const converted = season.teamIds.map(id => 
      typeof id === 'string' ? id : id.toString()
    );
    console.log(`Query 2: { _id: { $in: converted } }`);
    const result2 = await db.collection('ablteams').find({ _id: { $in: converted } }).toArray();
    console.log(`  Found: ${result2.length} teams\n`);

  } catch (err) {
    console.error('❌ Error:', err.message);
  } finally {
    await client.close();
  }
}

main();
