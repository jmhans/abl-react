/**
 * scripts/recalculate-affected-dates.mjs
 *
 * Triggers game-score recalculation for all dates affected by the
 * effectiveDate bug (April 16 – May 26, 2026) via the local Next.js app.
 *
 * Prerequisites:
 *   1. Run: DRY_RUN=false node scripts/fix-effectivedate-bug.mjs
 *   2. Start the local server: pnpm dev
 *   3. .env.local must contain CRON_SECRET=abl-dev-cron (already added)
 *      — restart the dev server after adding it
 *
 * Usage:
 *   node scripts/recalculate-affected-dates.mjs
 *   APP_URL=http://localhost:3001 node scripts/recalculate-affected-dates.mjs
 */

import { readFileSync } from 'fs';
import { resolve, dirname } from 'path';
import { fileURLToPath } from 'url';

const __dirname = dirname(fileURLToPath(import.meta.url));

// --- Parse .env.local ---
const envPath = resolve(__dirname, '..', '.env.local');
const env = Object.fromEntries(
  readFileSync(envPath, 'utf8').split('\n')
    .filter(l => l.includes('=') && !l.startsWith('#'))
    .map(l => {
      const idx = l.indexOf('=');
      return [l.slice(0, idx).trim(), l.slice(idx + 1).trim()];
    })
);

const CRON_SECRET = process.env.CRON_SECRET || env.CRON_SECRET;
if (!CRON_SECRET) {
  console.error('CRON_SECRET not found in .env.local. Add CRON_SECRET=abl-dev-cron and restart pnpm dev.');
  process.exit(1);
}

// The full range covering all 58 affected lineups found in the dry run.
// Dates outside this range had no bug-affected games.
const DATE_START = '2026-04-16';
const DATE_END = '2026-05-26';

const APP_URL = process.env.APP_URL || 'http://localhost:3000';
// Uses /api/games/recalculate — only re-locks rosters + recalculates scores.
// Does NOT re-fetch MLB stats from the external API.
const ENDPOINT = `${APP_URL}/api/games/recalculate`;

console.log(`ABL effectiveDate fix — recalculating game scores (no MLB stat refresh)`);
console.log(`  Endpoint   : ${ENDPOINT}`);
console.log(`  Date range : ${DATE_START} → ${DATE_END}`);
console.log(`  (Processes all ABL games in range; may take 1–3 minutes)\n`);

let resp;
try {
  resp = await fetch(ENDPOINT, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Authorization': `Bearer ${CRON_SECRET}`,
    },
    body: JSON.stringify({
      dateStart: `${DATE_START}T00:00:00.000Z`,
      dateEnd:   `${DATE_END}T23:59:59.999Z`,
      save: true,
      isFinal: true,
    }),
  });
} catch (err) {
  console.error(`\nFailed to reach ${ENDPOINT}. Is pnpm dev running?\n`, err.message);
  process.exit(1);
}

if (!resp.ok) {
  const text = await resp.text();
  console.error(`\nAPI returned ${resp.status}:\n${text}`);
  process.exit(1);
}

const data = await resp.json();

console.log('Recalculation complete.\n');
console.log(JSON.stringify(data, null, 2));

console.log(`\nSummary:`);
console.log(`  Games recalculated : ${data.processed ?? '?'}`);
console.log(`  Skipped            : ${data.skipped   ?? '?'}`);
console.log(`  Errors             : ${data.errors    ?? '?'}`);
console.log(`\nNext step: node scripts/audit-score-changes.mjs`);
console.log(`  (Requires PROD_MONGODB_URI in environment or .env.local)`);
