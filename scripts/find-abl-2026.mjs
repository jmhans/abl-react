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
    console.log(`\n📅 FINDING ABL 2026 SEASON\n`);

    const leagues = await db.collection('leagues').find({}).toArray();
    const ablLeague = leagues.find(l => l.slug === 'abl');
    console.log(`ABL League ID: ${ablLeague._id}\n`);

    const ablSeasons = await db.collection('seasons').find({ leagueId: ablLeague._id }).toArray();
    console.log(`ABL Seasons:`);
    ablSeasons.forEach(s => {
      console.log(`  - Year ${s.year}: ${s.teamIds.length} teams`);
      console.log(`    First team: ${s.teamIds[0]} (String)`);
    });

    const ablSeason2026 = ablSeasons.find(s => s.year === 2026);
    if (!ablSeason2026) {
      console.log(`\n❌ No ABL 2026 season found!`);
      return;
    }

    console.log(`\n✓ ABL 2026 has ${ablSeason2026.teamIds.length} teams:`);
    console.log(`  ${ablSeason2026.teamIds.join(', ')}\n`);

    // Now check if Machines is in there
    const machinesId = (await db.collection('ablteams').findOne({ nickname: 'Machines' }))?._id;
    console.log(`Machines team _id: ${machinesId}`);
    console.log(`Is Machines in ABL 2026? ${ablSeason2026.teamIds.includes(machinesId.toString()) ? '✓ YES' : '❌ NO'}`);

  } catch (err) {
    console.error('❌ Error:', err.message);
  } finally {
    await client.close();
  }
}

main();
