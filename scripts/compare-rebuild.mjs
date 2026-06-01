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

console.log('=== POSITION_LOG CHANGES (Before → After Rebuild) ===\n');

// Load backup
const backupFile = JSON.parse(readFileSync(resolve(__dirname, '..', 'position_log_2026_backup_PROD.json'), 'utf8'));
const backupJson = backupFile.data || backupFile;
const backupByMlbId = {};
backupJson.forEach(doc => {
  backupByMlbId[doc.mlbId] = doc;
});

console.log(`Backup entries: ${backupJson.length}`);

// Get current
const current = await db.collection('position_log').find({ season: 2026 }).toArray();
const currentByMlbId = {};
current.forEach(doc => {
  currentByMlbId[doc.mlbId] = doc;
});

console.log(`Current entries: ${current.length}\n`);

const changes = {
  positionChanged: [],
  removed: [],
  added: [],
  eligibilityChanged: []
};

// Check all backup entries
for (const [mlbId, backupDoc] of Object.entries(backupByMlbId)) {
  const currentDoc = currentByMlbId[mlbId];
  
  if (!currentDoc) {
    changes.removed.push({
      mlbId,
      wasMaxPosition: backupDoc.maxPosition,
      wasPositions: backupDoc.positionsLog
    });
  } else if (backupDoc.maxPosition !== currentDoc.maxPosition) {
    changes.positionChanged.push({
      mlbId,
      before: backupDoc.maxPosition,
      beforePositions: backupDoc.positionsLog,
      after: currentDoc.maxPosition,
      afterPositions: currentDoc.positionsLog
    });
  } else if (JSON.stringify(backupDoc.eligiblePositions) !== JSON.stringify(currentDoc.eligiblePositions)) {
    changes.eligibilityChanged.push({
      mlbId,
      maxPosition: currentDoc.maxPosition,
      beforeEligible: backupDoc.eligiblePositions,
      afterEligible: currentDoc.eligiblePositions
    });
  }
}

// Check for new entries
for (const [mlbId, currentDoc] of Object.entries(currentByMlbId)) {
  if (!backupByMlbId[mlbId]) {
    changes.added.push({
      mlbId,
      maxPosition: currentDoc.maxPosition,
      positions: currentDoc.positionsLog
    });
  }
}

// Show results
if (changes.positionChanged.length > 0) {
  console.log(`\n🔴 PLAYERS WITH CHANGED maxPosition (${changes.positionChanged.length}):\n`);
  changes.positionChanged.sort((a, b) => a.mlbId.localeCompare(b.mlbId));
  changes.positionChanged.forEach(c => {
    console.log(`  ${c.mlbId}:`);
    console.log(`    ${c.before} → ${c.after}`);
    console.log(`    Before: ${JSON.stringify(c.beforePositions.slice(0, 3))}`);
    console.log(`    After:  ${JSON.stringify(c.afterPositions.slice(0, 3))}`);
  });
}

if (changes.removed.length > 0) {
  console.log(`\n🗑️  PLAYERS REMOVED FROM 2026 (${changes.removed.length}):\n`);
  changes.removed.sort((a, b) => a.mlbId.localeCompare(b.mlbId));
  changes.removed.slice(0, 20).forEach(c => {
    console.log(`  ${c.mlbId}: was ${c.wasMaxPosition} (${c.wasPositions.map(p => p.pos).join('/')})`);
  });
  if (changes.removed.length > 20) {
    console.log(`  ... and ${changes.removed.length - 20} more`);
  }
}

if (changes.eligibilityChanged.length > 0) {
  console.log(`\n🔵 PLAYERS WITH CHANGED eligiblePositions (${changes.eligibilityChanged.length}):\n`);
  changes.eligibilityChanged.sort((a, b) => a.mlbId.localeCompare(b.mlbId));
  changes.eligibilityChanged.slice(0, 10).forEach(c => {
    console.log(`  ${c.mlbId} (${c.maxPosition}): ${JSON.stringify(c.beforeEligible)} → ${JSON.stringify(c.afterEligible)}`);
  });
  if (changes.eligibilityChanged.length > 10) {
    console.log(`  ... and ${changes.eligibilityChanged.length - 10} more`);
  }
}

if (changes.added.length > 0) {
  console.log(`\n✨ NEW PLAYERS ADDED TO 2026 (${changes.added.length}):\n`);
  console.log('  (Players who had no 2026 entry in backup but appear in current)');
}

console.log(`\n📊 SUMMARY:`);
console.log(`  Position changed: ${changes.positionChanged.length}`);
console.log(`  Removed: ${changes.removed.length}`);
console.log(`  Added: ${changes.added.length}`);
console.log(`  Eligibility changed: ${changes.eligibilityChanged.length}`);

await client.close();
