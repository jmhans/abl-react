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
const db = client.db();

const total = await db.collection('players_cache').countDocuments();
const noTeam = await db.collection('players_cache').countDocuments({ team: { $in: [null, '', undefined] } });
const sample = await db.collection('players_cache').find({ team: { $in: [null, ''] } }).limit(8).toArray();

console.log(`players_cache total: ${total},  no team: ${noTeam}`);
console.log('Sample no-team players:', sample.map(p => `${p.name} (mlbID=${p.mlbID})`));

// Also check players collection
const playersNoTeam = await db.collection('players').countDocuments({ team: { $in: [null, '', undefined] } });
console.log(`players collection no team: ${playersNoTeam}`);

await client.close();
