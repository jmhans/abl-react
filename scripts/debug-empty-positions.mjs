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

// Look at the empty-position players
const testIds = ['434378', '445276', '453286'];

console.log('Checking what positions these empty-data players actually played ...\n');

for (const mlbId of testIds) {
  // Find all their statline entries
  const entries = await db.collection('statlines')
    .find({ _id: { $regex: `^2026-(?:0[1-3]|04-0[0-5])` }, [`p.${mlbId}_`]: { $exists: true } })
    .project({ _id: 1, [`p.${mlbId}_`]: 1 })
    .toArray();
  
  if (entries.length > 0) {
    console.log(`mlbId ${mlbId}: ${entries.length} game entry`);
    for (const entry of entries) {
      const gameData = Object.values(entry.p || {}).find(v => v);
      console.log(`  ${entry._id}: ${JSON.stringify(gameData)}`);
    }
  } else {
    console.log(`mlbId ${mlbId}: NO statline entries`);
  }
}

await client.close();
