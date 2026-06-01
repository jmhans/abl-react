import { readFileSync } from 'fs';
import { resolve, dirname } from 'path';
import { fileURLToPath } from 'url';

const __dirname = dirname(fileURLToPath(import.meta.url));

console.log('Comparing PROD before/after position data...\n');

// Load backup
const backup = JSON.parse(readFileSync(resolve(__dirname, '..', 'position_log_2026_backup_PROD.json'), 'utf8'));
console.log(`BEFORE (${backup.recordCount} entries):`);

// Create maps for before
const beforeMap = new Map(backup.data.map(p => [p.mlbId, p]));

// Show distribution before
const beforeDist = {};
for (const entry of backup.data) {
  const key = entry.maxPosition || 'unknown';
  beforeDist[key] = (beforeDist[key] || 0) + 1;
}
console.log('Position distribution BEFORE:', JSON.stringify(beforeDist, null, 2));

// Count players with questionable positions (high appearance counts at positions that seem like spring)
let suspiciousCount = 0;
let suspiciousExamples = [];
for (const entry of backup.data) {
  const posLog = entry.positionsLog || [];
  const topCount = posLog[0]?.ct || 0;
  // In early April with max 3-4 games, having "4 games" suggests spring training
  if (topCount >= 4) {
    suspiciousCount++;
    if (suspiciousExamples.length < 5) {
      suspiciousExamples.push({ mlbId: entry.mlbId, maxPos: entry.maxPosition, topCount });
    }
  }
}
console.log(`\nPlayers with suspicious appearance counts (≥4 before real season): ${suspiciousCount}`);
console.log('Examples:', JSON.stringify(suspiciousExamples, null, 2));

console.log('\n---\n⏳ Wait for update to complete, then run this again to see AFTER distribution\n');
