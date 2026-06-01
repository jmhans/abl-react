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

console.log('=== CHECK GAME TYPES IN STATLINES ===\n');

const allDates = await db.collection('statlines')
  .find({ _id: { $regex: `^2026-` } })
  .toArray();

const typeDistribution = {};
const gamesByDate = {};

for (const doc of allDates) {
  gamesByDate[doc._id] = {};
  const entries = doc.p || {};
  for (const [key, val] of Object.entries(entries)) {
    const type = val.t || 'UNKNOWN';
    typeDistribution[type] = (typeDistribution[type] || 0) + 1;
    gamesByDate[doc._id][type] = (gamesByDate[doc._id][type] || 0) + 1;
  }
}

console.log('Game types found in 2026 statlines:');
Object.entries(typeDistribution).sort((a, b) => b[1] - a[1]).forEach(([type, count]) => {
  console.log(`  ${type}: ${count} games`);
});

console.log('\nGame type by date:');
Object.entries(gamesByDate).sort().forEach(([date, types]) => {
  const typeStr = Object.entries(types).map(([t, c]) => `${t}:${c}`).join(', ');
  console.log(`  ${date}: ${typeStr}`);
});

// Specifically check 656976 with game types
console.log('\nPlayer 656976 games with types:');
for (const doc of allDates) {
  const entries = doc.p || {};
  for (const [key, val] of Object.entries(entries)) {
    if (key.split('_')[0] === '656976') {
      console.log(`  ${doc._id}: pos=${val.pos}, type=${val.t || 'UNKNOWN'}`);
    }
  }
}

await client.close();
