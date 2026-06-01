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

console.log('=== SAMPLE GAME STRUCTURE ===\n');

// Get one game entry from a few dates
const sample = await db.collection('statlines').findOne({ _id: '2026-03-20' });
if (sample && sample.p) {
  const [firstKey, firstVal] = Object.entries(sample.p)[0];
  console.log(`Sample game from 2026-03-20:`);
  console.log(JSON.stringify({ [firstKey]: firstVal }, null, 2));
}

// Check if there's a 'g_type' or similar field
const sample2 = await db.collection('statlines').findOne({ _id: '2026-03-28' });
if (sample2 && sample2.p) {
  const [key, val] = Object.entries(sample2.p)[0];
  console.log(`\nSample game from 2026-03-28:`);
  console.log(JSON.stringify({ [key]: val }, null, 2));
}

// Check for a game_info or games collection
const collections = await db.listCollections().toArray();
const gameCollections = collections.filter(c => c.name.includes('game'));
console.log(`\nCollections with 'game' in name:`, gameCollections.map(c => c.name));

await client.close();
