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

// 1. Check what positions_view looks like
console.log('=== positions_view (sample 3) ===');
const pvSample = await db.collection('positions_view').find({}).limit(3).toArray();
console.log(JSON.stringify(pvSample, null, 2));

// 2. Check what position_log looks like
console.log('\n=== position_log (sample 3) ===');
const plSample = await db.collection('position_log').find({}).limit(3).toArray();
console.log(JSON.stringify(plSample, null, 2));

// 3. Check mlbrosters for year field
console.log('\n=== mlbrosters (sample 2) ===');
const mrSample = await db.collection('mlbrosters').find({}).limit(2).toArray();
console.log(JSON.stringify(mrSample, null, 2));

// 4. Check statlines for structure
console.log('\n=== statlines (sample 1) ===');
const slSample = await db.collection('statlines').find({}).limit(1).toArray();
console.log(JSON.stringify(slSample, null, 2));

// 5. Check player doc for CommishPos and eligible fields
console.log('\n=== players (sample 2 - key fields) ===');
const pSample = await db.collection('players').find({}).limit(2).toArray();
console.log(JSON.stringify(pSample.map(p => ({
  _id: p._id, name: p.name, CommishPos: p.CommishPos, eligible: p.eligible,
  position: p.position, POS: p.POS
})), null, 2));

await client.close();
