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

console.log('=== 34 PLAYERS NEEDING CommishPos UPDATES ===\n');

// 32 known changed positions + 2 with missing CommishPos
const allToUpdate = [
  { mlbId: '545121', before: '2B', after: 'DH' },
  { mlbId: '593871', before: '1B', after: 'DH' },
  { mlbId: '596142', before: 'C', after: '1B' },
  { mlbId: '605170', before: 'C', after: '1B' },
  { mlbId: '621043', before: 'SS', after: '3B' },
  { mlbId: '655316', before: 'SS', after: '2B' },
  { mlbId: '656976', before: '1B', after: 'DH' },
  { mlbId: '663624', before: 'DH', after: '1B' },
  { mlbId: '663993', before: '1B', after: 'DH' },
  { mlbId: '664068', before: '2B', after: 'DH' },
  { mlbId: '664238', before: '1B', after: 'DH' },
  { mlbId: '666397', before: '1B', after: 'DH' },
  { mlbId: '668901', before: 'DH', after: '1B' },
  { mlbId: '669208', before: '2B', after: 'DH' },
  { mlbId: '669289', before: '1B', after: '3B' },
  { mlbId: '669397', before: '3B', after: 'SS' },
  { mlbId: '671056', before: 'C', after: 'DH' },
  { mlbId: '676724', before: '1B', after: 'OF' },
  { mlbId: '677649', before: 'SS', after: '2B' },
  { mlbId: '678554', before: '3B', after: '1B' },
  { mlbId: '679845', before: '3B', after: '2B' },
  { mlbId: '681807', before: 'C', after: 'OF' },
  { mlbId: '683146', before: 'OF', after: '1B' },
  { mlbId: '686475', before: 'OF', after: '2B' },
  { mlbId: '690924', before: 'C', after: 'DH' },
  { mlbId: '690993', before: '1B', after: '3B' },
  { mlbId: '694212', before: 'C', after: 'DH' },
  { mlbId: '694376', before: '3B', after: '1B' },
  { mlbId: '694377', before: 'OF', after: '3B' },
  { mlbId: '695600', before: 'C', after: 'DH' },
  { mlbId: '807799', before: 'DH', after: 'OF' },
  { mlbId: '808975', before: 'SS', after: '2B' },
  { mlbId: '642207', before: 'undefined', after: 'DH' },
  { mlbId: '678218', before: 'undefined', after: 'C' },
];

console.log(`${allToUpdate.length} players need CommishPos updates\n`);

// Fetch player names
const mlbIds = allToUpdate.map(p => p.mlbId);
const players = await db.collection('players')
  .find({ mlbID: { $in: mlbIds } })
  .project({ mlbID: 1, name: 1 })
  .toArray();

const nameMap = {};
players.forEach(p => {
  nameMap[p.mlbID] = p.name || 'Unknown';
});

console.log('| # | Player Name | mlbID | Current CommishPos → New CommishPos |');
console.log('|---|---|---|---|');

allToUpdate.forEach((p, idx) => {
  const name = nameMap[p.mlbId] || 'Unknown';
  const before = p.before === 'undefined' ? '-' : p.before;
  console.log(`| ${idx + 1} | ${name} | ${p.mlbId} | ${before} → ${p.after} |`);
});

console.log('\n✅ Now updating CommishPos in prod...\n');

// Prepare bulk operations
const ops = allToUpdate.map(p => ({
  updateOne: {
    filter: { mlbId: p.mlbId },
    update: { $set: { CommishPos: p.after } },
    upsert: false,
  },
}));

// Execute updates
const BATCH = 500;
let totalUpdated = 0;

for (let i = 0; i < ops.length; i += BATCH) {
  const r = await db.collection('positions').bulkWrite(ops.slice(i, i + BATCH), { ordered: false });
  console.log(`  batch ${Math.floor(i / BATCH) + 1}: matched=${r.matchedCount}, modified=${r.modifiedCount}`);
  totalUpdated += r.modifiedCount;
}

console.log(`\n✅ Updated ${totalUpdated} / 34 CommishPos values in prod`);

await client.close();
