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

console.log('Searching for 656976 data on specific dates...\n');

// Check exact dates
const dates = ['2026-03-27', '2026-03-28'];

for (const date of dates) {
  const doc = await db.collection('statlines').findOne({ _id: date });
  if (!doc) {
    console.log(`${date}: NOT FOUND`);
    continue;
  }
  
  const playerKeys = Object.keys(doc.p || {}).filter(k => k.startsWith('656976_'));
  console.log(`${date}: ${playerKeys.length} entries for 656976`);
  
  for (const key of playerKeys) {
    console.log(`  ${key}: ${JSON.stringify(doc.p[key])}`);
  }
}

// Also check what 2026 dates exist
console.log('\n2026 statline dates in prod:');
const all2026 = await db.collection('statlines')
  .find({ _id: /^2026-/ })
  .project({ _id: 1 })
  .sort({ _id: 1 })
  .toArray();

console.log(`Total 2026 dates: ${all2026.length}`);
console.log('Dates:', all2026.map(d => d._id).join(', '));

await client.close();
