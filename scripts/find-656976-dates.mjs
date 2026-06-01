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

console.log('All statline dates with player 656976 in PROD (all 2026):');

const allEntries = await db.collection('statlines')
  .find({ _id: /^2026-/, 'p.656976_': { $exists: true } })
  .project({ _id: 1 })
  .toArray();

console.log(`Found ${allEntries.length} total dates with this player in 2026:`);
allEntries.forEach(doc => console.log(`  ${doc._id}`));

// Check dates AFTER 04-05
const afterFilter = allEntries.filter(doc => !/^2026-(?:0[1-3]|04-0[0-5])/.test(doc._id));
console.log(`\nDates AFTER 04-05 filter threshold: ${afterFilter.length}`);
afterFilter.slice(0, 10).forEach(doc => console.log(`  ${doc._id}`));

await client.close();
