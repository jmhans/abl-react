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

console.log('=== FINAL VERIFICATION ===\n');

// Check the statline dates range
const allDates = await db.collection('statlines')
  .find({ _id: { $regex: `^2026-` } })
  .project({ _id: 1 })
  .sort({ _id: 1 })
  .toArray();

console.log(`Total 2026 statline dates: ${allDates.length}`);
if (allDates.length > 0) {
  console.log(`  Range: ${allDates[0]._id} to ${allDates[allDates.length - 1]._id}`);
}

// Show which ones go through 04-05
const through405 = allDates.filter(d => /^2026-(?:0[1-3]|04-0[0-5])/.test(d._id));
console.log(`  Through 2026-04-05: ${through405.length} dates`);

// Show ALL 656976 games across entire 2026, not just through 04-05
const allStatDates = await db.collection('statlines')
  .find({ _id: { $regex: `^2026-` } })
  .toArray();

let all656976Games = [];
for (const doc of allStatDates) {
  const entries = doc.p || {};
  for (const [key, val] of Object.entries(entries)) {
    if (key.split('_')[0] === '656976') {
      all656976Games.push({ date: doc._id, pos: val.pos });
    }
  }
}
all656976Games.sort((a, b) => a.date.localeCompare(b.date));

console.log(`\nPlayer 656976 games (ALL 2026 dates):  ${all656976Games.length}`);
all656976Games.forEach(g => {
  const cut = /^2026-(?:0[1-3]|04-0[0-5])/.test(g.date) ? '✓' : '✗';
  console.log(`  ${cut} ${g.date}: ${g.pos}`);
});

await client.close();
