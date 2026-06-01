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

console.log('Looking for 656976 statlines in prod (through 04-05):\n');

const entries = await db.collection('statlines')
  .find({ _id: { $regex: '^2026-(?:0[1-3]|04-0[0-5])' }, 'p.656976_': { $exists: true } })
  .toArray();

console.log(`Found ${entries.length} statline documents with this player:`);

for (const doc of entries) {
  const playerKey = Object.keys(doc.p || {}).find(k => k.startsWith('656976_'));
  if (playerKey) {
    const data = doc.p[playerKey];
    console.log(`  ${doc._id}: positions=${JSON.stringify(data.pos)}, batting=${JSON.stringify(data.b)}`);
  }
}

// Also check position_log now to see what was calculated
const posLog = await db.collection('position_log').findOne({ mlbId: '656976', season: 2026 });
console.log('\nCurrent position_log for 656976:');
console.log(JSON.stringify({
  maxPosition: posLog?.maxPosition,
  eligiblePositions: posLog?.eligiblePositions,
  positionsLog: posLog?.positionsLog
}, null, 2));

await client.close();
