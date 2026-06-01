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

console.log('=== EXPLORING GAMES COLLECTION ===\n');

// Just get any game
const anyGames = await db.collection('games')
  .find()
  .limit(3)
  .toArray();

console.log('Sample games (any):');
anyGames.forEach((g, i) => {
  console.log(`\n${i}. Keys:`, Object.keys(g).filter(k => !k.startsWith('_')));
  if (g.gameType) console.log('   gameType:', g.gameType);
  if (g.date) console.log('   date:', g.date);
  if (g.season) console.log('   season:', g.season);
});

// Check total docs
const count = await db.collection('games').countDocuments();
console.log(`\nTotal docs in games collection: ${count}`);

// Get min/max dates
const minDate = await db.collection('games').find().sort({ date: 1 }).limit(1).toArray();
const maxDate = await db.collection('games').find().sort({ date: -1 }).limit(1).toArray();
console.log(`Date range: ${minDate[0]?.date} to ${maxDate[0]?.date}`);

await client.close();
