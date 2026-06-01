import { MongoClient } from 'mongodb';
import { readFileSync } from 'fs';

for (const line of readFileSync('.env.local', 'utf8').split(/\r?\n/)) {
  const m = line.match(/^([^#=\r]+)=(.*\S*)/);
  if (m) process.env[m[1].trim()] = m[2].trim();
}

const prodUri = process.env.MONGODB_URI.replace('/abl_dev', '/heroku_wm40bx9r');
const client = new MongoClient(prodUri);
await client.connect();
const db = client.db('heroku_wm40bx9r');

console.log('=== VERIFY 656976 IN STATLINES (through 04-05) ===\n');

// Count total statline entries for 656976 through 04-05
const statDates = await db.collection('statlines')
  .find({ _id: { $regex: `^2026-(?:0[1-3]|04-0[0-5])` } })
  .toArray();

let totalFound = 0;
const datesWithPlayer = [];

for (const doc of statDates) {
  const entries = doc.p || {};
  for (const [key, val] of Object.entries(entries)) {
    const mlbId = key.split('_')[0];
    if (mlbId === '656976') {
      totalFound++;
      datesWithPlayer.push({
        date: doc._id,
        key,
        pos: val.pos,
        games: val.g,
        ab: val.b?.ab || 0,
        h: val.b?.h || 0
      });
    }
  }
}

console.log(`Statlines scanned: ${statDates.length} date documents`);
console.log(`Player 656976 total game entries in statlines (through 04-05): ${totalFound}`);

if (datesWithPlayer.length > 0) {
  console.log('\nGames found:');
  datesWithPlayer.forEach(g => {
    console.log(`  ${g.date}: pos=${g.pos}, g=${g.games}, ab=${g.ab}, h=${g.h}`);
  });
} else {
  console.log('\n❌ NO games found for 656976 in any 2026 statlines through 04-05');
  console.log('This means the update script correctly did NOT create a 2026 entry for this player.');
  console.log('The old stale document with ID 69d7029943396f870d80e1eb should have been deleted but was not.');
}

await client.close();
