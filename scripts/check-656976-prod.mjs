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

console.log('=== PLAYER 656976 STATLINES (PROD) ===\n');

const statDates = await db.collection('statlines')
  .find({ _id: { $regex: '^2026-' } })
  .toArray();

let games = [];
for (const doc of statDates) {
  const entries = doc.p || {};
  for (const [key, val] of Object.entries(entries)) {
    if (key.split('_')[0] === '656976') {
      games.push({
        date: doc._id,
        gameId: key.split('_')[1],
        pos: val.pos,
        b: val.b
      });
    }
  }
}

games.sort((a, b) => a.date.localeCompare(b.date));

console.log(`Found ${games.length} games for 656976:\n`);
games.forEach(g => {
  console.log(`  ${g.date}: ${g.gameId}, pos=${g.pos}, b=${JSON.stringify(g.b)}`);
});

await client.close();
