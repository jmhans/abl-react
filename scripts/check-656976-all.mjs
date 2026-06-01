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

console.log('=== CHECK IF 656976 UPDATE FAILED ===\n');

// Find ALL documents for 656976
const all656976 = await db.collection('position_log')
  .find({ mlbId: '656976' })
  .toArray();

console.log(`Total 656976 entries: ${all656976.length}`);
all656976.forEach((doc, i) => {
  console.log(`\n${i}. Season: ${doc.season}`);
  console.log(`   maxPosition: ${doc.maxPosition}`);
  console.log(`   eligiblePositions: ${JSON.stringify(doc.eligiblePositions)}`);
  console.log(`   positionsLog: ${JSON.stringify(doc.positionsLog)}`);
  console.log(`   _id: ${doc._id}`);
});

// Also check if position_log even exists in prod (might be named differently)
const collections = await db.listCollections().toArray();
const hasPositionLog = collections.some(c => c.name === 'position_log');
console.log(`\n✓ Collection 'position_log' exists: ${hasPositionLog}`);

await client.close();
