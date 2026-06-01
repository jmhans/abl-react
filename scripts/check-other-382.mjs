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

// The 32 players with known position changes
const knownChangedIds = new Set([
  '545121', '593871', '596142', '605170', '621043', '655316', '656976', '663624',
  '663993', '664068', '664238', '666397', '668901', '669208', '669289', '669397',
  '671056', '676724', '677649', '678554', '679845', '681807', '683146', '686475',
  '690924', '690993', '694212', '694376', '694377', '695600', '807799', '808975',
]);

console.log('=== CHECKING OTHER 382 PLAYERS FOR CommishPos CHANGES ===\n');

// Get all 2026 position_log entries
const allPosLogs = await db.collection('position_log')
  .find({ season: 2026 })
  .toArray();

console.log(`Total 2026 position_log entries: ${allPosLogs.length}`);

// Exclude the 32 known changes, check the rest
const otherPlayers = allPosLogs.filter(p => !knownChangedIds.has(p.mlbId));
console.log(`Other players (2026): ${otherPlayers.length}\n`);

// Fetch their positions entries
const otherMlbIds = otherPlayers.map(p => p.mlbId);
const positionDocs = await db.collection('positions')
  .find({ mlbId: { $in: otherMlbIds } })
  .toArray();

const positionsMap = {};
positionDocs.forEach(p => {
  positionsMap[p.mlbId] = p.CommishPos;
});

// Check how many match
let matching = 0;
let mismatching = 0;
const mismatches = [];

for (const posLog of otherPlayers) {
  const commish = positionsMap[posLog.mlbId];
  const matches = posLog.maxPosition === commish;
  
  if (matches) {
    matching++;
  } else {
    mismatching++;
    mismatches.push({
      mlbId: posLog.mlbId,
      posLogMax: posLog.maxPosition,
      commish
    });
  }
}

console.log(`Results for OTHER 382 players:`);
console.log(`  Already matching: ${matching}`);
console.log(`  Need to update: ${mismatching}`);

if (mismatching > 0) {
  console.log(`\nSample of mismatches (first 20):`);
  console.log('| mlbId | position_log maxPosition | CommishPos |');
  console.log('|---|---|---|');
  mismatches.slice(0, 20).forEach(m => {
    console.log(`| ${m.mlbId} | ${m.posLogMax} | ${m.commish} |`);
  });
  if (mismatches.length > 20) {
    console.log(`... and ${mismatches.length - 20} more`);
  }
}

await client.close();
