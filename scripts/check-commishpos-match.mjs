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

// The 32 players with position changes
const changedPlayers = [
  '545121', '593871', '596142', '605170', '621043', '655316', '656976', '663624',
  '663993', '664068', '664238', '666397', '668901', '669208', '669289', '669397',
  '671056', '676724', '677649', '678554', '679845', '681807', '683146', '686475',
  '690924', '690993', '694212', '694376', '694377', '695600', '807799', '808975',
];

console.log('=== CHECKING CommishPos vs position_log maxPosition FOR 32 CHANGED PLAYERS ===\n');

// Fetch position_log entries
const posLogs = await db.collection('position_log')
  .find({ mlbId: { $in: changedPlayers }, season: 2026 })
  .toArray();

const posLogsMap = {};
posLogs.forEach(p => {
  posLogsMap[p.mlbId] = p.maxPosition;
});

// Fetch positions entries
const positions = await db.collection('positions')
  .find({ mlbId: { $in: changedPlayers } })
  .toArray();

const positionsMap = {};
positions.forEach(p => {
  positionsMap[p.mlbId] = p.CommishPos;
});

// Also load the backup to show the before state
const backupFile = JSON.parse(readFileSync(resolve(__dirname, '..', 'position_log_2026_backup_PROD.json'), 'utf8'));
const backupMap = {};
backupFile.data.forEach(doc => {
  backupMap[doc.mlbId] = doc.maxPosition;
});

let matching = 0;
let mismatching = 0;

console.log('| mlbId | Before (Spring) | Current (Reg Season) | CommishPos | Match? |');
console.log('|---|---|---|---|---|');

const results = [];

for (const mlbId of changedPlayers) {
  const before = backupMap[mlbId] || '?';
  const current = posLogsMap[mlbId] || '?';
  const commish = positionsMap[mlbId] || 'NOT SET';
  const matches = current === commish;
  
  if (matches) matching++;
  else mismatching++;
  
  results.push({
    mlbId,
    before,
    current,
    commish,
    matches
  });
}

// Sort to show mismatches first
results.sort((a, b) => {
  if (a.matches !== b.matches) return a.matches ? 1 : -1;
  return a.mlbId.localeCompare(b.mlbId);
});

results.forEach(r => {
  const checkmark = r.matches ? '✓' : '✗';
  console.log(`| ${r.mlbId} | ${r.before} | ${r.current} | ${r.commish} | ${checkmark} |`);
});

console.log(`\n📊 SUMMARY:`);
console.log(`  Already matching: ${matching} / 32`);
console.log(`  Need to update: ${mismatching} / 32`);

await client.close();
