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
    console.log(`\n🔍 CHECKING WHICH SEASON EACH TEAM IS IN\n`);

    const seasons = await db.collection('seasons').find({ year: { $in: [2025, 2026] } }).toArray();
    
    seasons.forEach(s => {
      console.log(`Season ${s.year} (${s.slug}) - ${s.isActive ? 'ACTIVE' : 'inactive'}`);
      if (s.teamIds && s.teamIds.length > 0) {
        console.log(`  Teams (${s.teamIds.length}):`);
        s.teamIds.slice(0, 5).forEach(tid => console.log(`    - ${tid}`));
        if (s.teamIds.length > 5) console.log(`    ... and ${s.teamIds.length - 5} more`);
      }
    });

    console.log(`\n🔍 WHERE IS TEAM 5cb0a459b3a023003331261f (Psychos)?\n`);

    const team = await db.collection('ablteams').findOne({ _id: '5cb0a459b3a023003331261f' });
    if (!team) {
      console.log(`  ❌ Team not found`);
    } else {
      console.log(`  Team: ${team.nickname}`);
      console.log(`  Owners: ${team.owners?.map(o => o.userId).join(', ')}\n`);
      
      const inSeasons = await db.collection('seasons').find({
        teamIds: '5cb0a459b3a023003331261f'
      }).toArray();
      
      console.log(`  In ${inSeasons.length} seasons:`);
      inSeasons.forEach(s => {
        console.log(`    - Year ${s.year} (${s.isActive ? 'ACTIVE' : 'inactive'})`);
      });
    }

  } catch (err) {
    console.error('❌ Error:', err);
  } finally {
    await client.close();
  }
}

main();
