import { MongoClient } from 'mongodb';
import { readFileSync } from 'fs';
import { resolve, dirname } from 'path';
import { fileURLToPath } from 'url';

const __dirname = dirname(fileURLToPath(import.meta.url));
for (const line of readFileSync(resolve(__dirname, '..', '.env.local'), 'utf8').split(/\r?\n/)) {
  const m = line.match(/^([^#=\r]+)=(.*\S*)/);
  if (m) process.env[m[1].trim()] = m[2].trim();
}

const client = new MongoClient(process.env.MONGODB_URI);
await client.connect();
const db = client.db('abl_dev');

// positions_view
console.log('=== positions_view (sample 3) ===');
const pv = await db.collection('positions_view').find({}).limit(3).toArray();
console.log(JSON.stringify(pv, null, 2));

// position_log
console.log('\n=== position_log (sample 3) ===');
const pl = await db.collection('position_log').find({}).limit(3).toArray();
console.log(JSON.stringify(pl, null, 2));

// Player with CommishPos
console.log('\n=== players with CommishPos (sample 3) ===');
const withCP = await db.collection('players').find({ CommishPos: { $exists: true } }).limit(3).toArray();
console.log(JSON.stringify(withCP.map(p => ({ _id: p._id, name: p.name, mlbID: p.mlbID, CommishPos: p.CommishPos, eligible: p.eligible, position: p.position })), null, 2));
console.log('Total with CommishPos:', await db.collection('players').countDocuments({ CommishPos: { $exists: true } }));

// statlines - see what years are present
console.log('\n=== statlines date range ===');
const dates = await db.collection('statlines').distinct('_id');
const sorted = dates.sort();
console.log('Earliest:', sorted[0], '  Latest:', sorted[sorted.length - 1], '  Count:', sorted.length);
// How many 2026 dates?
const dates2026 = sorted.filter(d => d.startsWith('2026'));
console.log('2026 dates:', dates2026.length, dates2026.slice(0, 5));

await client.close();
