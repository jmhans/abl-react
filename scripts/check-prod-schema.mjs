import { MongoClient } from 'mongodb';
import { readFileSync } from 'fs';
import { resolve, dirname } from 'path';
import { fileURLToPath } from 'url';

const __dirname = dirname(fileURLToPath(import.meta.url));

for (const line of readFileSync(resolve(__dirname, '..', '.env.local'), 'utf8').split(/\r?\n/)) {
  const m = line.match(/^([^#=\r]+)=(.*\S*)/);
  if (m) process.env[m[1].trim()] = m[2].trim();
}

const prodUri = process.env.MONGODB_URI.replace('/abl_dev', '/heroku_wm40bx9r');
const client = new MongoClient(prodUri);
await client.connect();
const db = client.db('heroku_wm40bx9r');

// Check if position_log has different field structure in prod
console.log('Checking position_log structure in prod...\n');

const sample = await db.collection('position_log').findOne({ season: 2026 });
console.log('Sample position_log doc:');
console.log(JSON.stringify(sample, null, 2));

// Check how many have season: 2026
const count2026 = await db.collection('position_log').countDocuments({ season: 2026 });
console.log(`\nDocuments with season: 2026: ${count2026}`);

// Check if there are docs with integer vs string season
const sampleNoMatch = await db.collection('position_log')
  .find({ mlbId: '656976' })
  .toArray();
console.log(`\nAll position_log docs for mlbId 656976:`);
console.log(JSON.stringify(sampleNoMatch, null, 2));

await client.close();
