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

// players_view definition
const pvDef = await db.listCollections({ name: 'players_view' }).toArray();
console.log('=== players_view definition ===');
console.log(JSON.stringify(pvDef, null, 2));

// players_view sample - key fields
console.log('\n=== players_view sample (3, key fields) ===');
const pv = await db.collection('players_view').find({}).limit(3).toArray();
console.log(JSON.stringify(pv.map(p => ({
  name: p.name, mlbID: p.mlbID, eligible: p.eligible, position: p.position, status: p.status, CommishPos: p.CommishPos
})), null, 2));

// players_view count with non-empty eligible
console.log('\nplayers_view with eligible:', await db.collection('players_view').countDocuments({ eligible: { $exists: true, $ne: [] } }));
console.log('players_view total:', await db.collection('players_view').countDocuments());

// players_view for mlbID 666023 (Freddy Fermin - we know his position_log is C)
console.log('\n=== players_view Freddy Fermin (666023) ===');
const ff = await db.collection('players_view').findOne({ mlbID: '666023' });
console.log(JSON.stringify({ name: ff?.name, mlbID: ff?.mlbID, eligible: ff?.eligible, CommishPos: ff?.CommishPos }, null, 2));

await client.close();
