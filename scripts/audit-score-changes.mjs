/**
 * scripts/audit-score-changes.mjs
 *
 * Compares game results between the prod DB (old scores, before fix) and the
 * local dev DB (new scores, after effectiveDate fix + recalculation) for all
 * ABL game dates in the affected range (April 16 – May 26, 2026).
 *
 * Prerequisites:
 *   1. Fix applied to local DB:  DRY_RUN=false node scripts/fix-effectivedate-bug.mjs
 *   2. Local scores recalculated: node scripts/recalculate-affected-dates.mjs
 *   3. PROD_MONGODB_URI set (in env or .env.local):
 *        PROD_MONGODB_URI=mongodb+srv://<user>:<pass>@<host>/<prod-db>
 *
 * Usage:
 *   node scripts/audit-score-changes.mjs
 *   PROD_MONGODB_URI="..." node scripts/audit-score-changes.mjs
 *
 * Output:
 *   - Console: human-readable report of all changed games
 *   - File:    scripts/audit-output/score-audit-<timestamp>.txt
 */

import { readFileSync, mkdirSync, writeFileSync } from 'fs';
import { resolve, dirname } from 'path';
import { fileURLToPath } from 'url';
import { MongoClient } from 'mongodb';

const __dirname = dirname(fileURLToPath(import.meta.url));

// --- Parse .env.local ---
const envPath = resolve(__dirname, '..', '.env.local');
const envVars = Object.fromEntries(
  readFileSync(envPath, 'utf8').split('\n')
    .filter(l => l.includes('=') && !l.startsWith('#'))
    .map(l => {
      const idx = l.indexOf('=');
      return [l.slice(0, idx).trim(), l.slice(idx + 1).trim()];
    })
);

function getEnv(key) {
  return process.env[key] || envVars[key] || '';
}

const LOCAL_URI = getEnv('MONGODB_URI');
const PROD_URI  = getEnv('PROD_MONGODB_URI');

if (!LOCAL_URI) {
  console.error('MONGODB_URI not found in .env.local');
  process.exit(1);
}
if (!PROD_URI) {
  console.error(
    'PROD_MONGODB_URI not set.\n' +
    'Add it to .env.local or pass it as:\n' +
    '  PROD_MONGODB_URI="mongodb+srv://..." node scripts/audit-score-changes.mjs'
  );
  process.exit(1);
}

function extractDbName(uri) {
  const match = uri.match(/\/([^/?]+)(\?|$)/);
  return match?.[1] ?? null;
}

const LOCAL_DB_NAME = extractDbName(LOCAL_URI);
const PROD_DB_NAME  = extractDbName(PROD_URI);

// Date range that covers all 58 affected lineups
const DATE_START = new Date('2026-04-16T00:00:00.000Z');
const DATE_END   = new Date('2026-05-27T00:00:00.000Z'); // exclusive

// -----------------------------------------------------------------------

function fmt(n) {
  if (n == null) return '    ?   ';
  return n.toFixed(4).padStart(8);
}

function winnerLabel(teamId, teamMap) {
  if (!teamId) return '???';
  return teamMap.get(teamId.toString()) || teamId.toString().slice(-6);
}

function getScore(result, location) {
  if (!result?.scores) return null;
  const s = result.scores.find(s => s.location === location);
  return s?.final ?? s?.regulation ?? null;
}

function getWinnerId(result) {
  return result?.winner?.toString?.() ?? null;
}

// -----------------------------------------------------------------------

console.log('ABL effectiveDate bug — Score Audit\n');
console.log(`  Local DB : ${LOCAL_DB_NAME}`);
console.log(`  Prod  DB : ${PROD_DB_NAME}`);
console.log(`  Date range: ${DATE_START.toISOString().slice(0,10)} → ${new Date(DATE_END - 1).toISOString().slice(0,10)}\n`);

const localClient = new MongoClient(LOCAL_URI);
const prodClient  = new MongoClient(PROD_URI);

await localClient.connect();
await prodClient.connect();

const localDb = localClient.db(LOCAL_DB_NAME);
const prodDb  = prodClient.db(PROD_DB_NAME);

try {
  // --- Load team nicknames from both DBs (prefer local, fall back to prod) ---
  const [localTeams, prodTeams] = await Promise.all([
    localDb.collection('ablteams').find({}, { projection: { _id: 1, nickname: 1, name: 1 } }).toArray(),
    prodDb.collection('ablteams').find({},  { projection: { _id: 1, nickname: 1, name: 1 } }).toArray(),
  ]);
  const teamMap = new Map();
  for (const t of [...prodTeams, ...localTeams]) {
    teamMap.set(t._id.toString(), t.nickname || t.name || t._id.toString());
  }

  // --- Load all games in the affected range from both DBs ---
  const gameFilter = {
    gameDate: { $gte: DATE_START, $lt: DATE_END },
    gameType: 'R',
  };

  const [localGames, prodGames] = await Promise.all([
    localDb.collection('games').find(gameFilter).sort({ gameDate: 1 }).toArray(),
    prodDb.collection('games').find(gameFilter).sort({ gameDate: 1 }).toArray(),
  ]);

  console.log(`  Local games found: ${localGames.length}`);
  console.log(`  Prod  games found: ${prodGames.length}\n`);

  // Index prod games by _id for quick lookup
  const prodById = new Map(prodGames.map(g => [g._id.toString(), g]));

  // -----------------------------------------------------------------------
  // Compare each local game against its prod counterpart
  // -----------------------------------------------------------------------

  const lines = [];
  const outcomeChanges = [];
  const scoreChanges = [];

  // Group games by ABL date
  function ablDate(gameDate) {
    const d = new Date(gameDate);
    const shifted = new Date(d.getTime() - 8 * 60 * 60 * 1000);
    return shifted.toISOString().slice(0, 10);
  }

  const gamesByDate = new Map();
  for (const g of localGames) {
    const d = ablDate(g.gameDate);
    if (!gamesByDate.has(d)) gamesByDate.set(d, []);
    gamesByDate.get(d).push(g);
  }

  let totalGames = 0;
  let totalScoreChanges = 0;
  let totalOutcomeChanges = 0;
  let totalNoProdResult = 0;
  let totalNoLocalResult = 0;

  for (const [date, games] of [...gamesByDate.entries()].sort()) {
    const dateLines = [];
    let dateHasChanges = false;

    for (const localGame of games) {
      const prodGame = prodById.get(localGame._id.toString());
      const homeId   = (localGame.homeTeam ?? localGame.homeTeamId)?.toString?.();
      const awayId   = (localGame.awayTeam ?? localGame.awayTeamId)?.toString?.();
      const homeName = teamMap.get(homeId) || homeId?.slice(-6) || '???';
      const awayName = teamMap.get(awayId) || awayId?.slice(-6) || '???';

      totalGames++;

      const prodResult  = prodGame?.result;
      const localResult = localGame?.result;

      if (!prodResult) {
        totalNoProdResult++;
        dateLines.push(`  GAME: ${homeName} (H) vs ${awayName} (A)`);
        dateLines.push(`    ⚠️  No prod result found — skipping`);
        dateLines.push('');
        continue;
      }
      if (!localResult) {
        totalNoLocalResult++;
        dateLines.push(`  GAME: ${homeName} (H) vs ${awayName} (A)`);
        dateLines.push(`    ⚠️  No local result — recalculation may not have run yet`);
        dateLines.push('');
        continue;
      }

      const prodHome  = getScore(prodResult,  'H');
      const prodAway  = getScore(prodResult,  'A');
      const localHome = getScore(localResult, 'H');
      const localAway = getScore(localResult, 'A');

      const prodWinnerId  = getWinnerId(prodResult);
      const localWinnerId = getWinnerId(localResult);

      const homeRunsProd  = prodHome?.abl_runs  ?? null;
      const awayRunsProd  = prodAway?.abl_runs  ?? null;
      const homeRunsLocal = localHome?.abl_runs ?? null;
      const awayRunsLocal = localAway?.abl_runs ?? null;

      // Check for score changes (meaningful = more than floating-point noise)
      const homeChanged = homeRunsProd != null && homeRunsLocal != null &&
                          Math.abs(homeRunsProd - homeRunsLocal) > 0.00001;
      const awayChanged = awayRunsProd != null && awayRunsLocal != null &&
                          Math.abs(awayRunsProd - awayRunsLocal) > 0.00001;

      const outcomeChanged = prodWinnerId && localWinnerId && prodWinnerId !== localWinnerId;

      if (!homeChanged && !awayChanged) continue; // no difference, skip

      dateHasChanges = true;
      totalScoreChanges++;
      if (outcomeChanged) totalOutcomeChanges++;

      const prodWinnerName  = winnerLabel(prodWinnerId,  teamMap);
      const localWinnerName = winnerLabel(localWinnerId, teamMap);

      const gameLine = `  GAME: ${homeName} (H) vs ${awayName} (A)`;
      const prodLine = [
        `    PROD  (old):  ${homeName}${fmt(homeRunsProd)}  |  ${awayName}${fmt(awayRunsProd)}`,
        `  →  winner: ${prodWinnerName}`,
      ].join('');
      const newLine = [
        `    LOCAL (new):  ${homeName}${fmt(homeRunsLocal)}  |  ${awayName}${fmt(awayRunsLocal)}`,
        `  →  winner: ${localWinnerName}`,
        outcomeChanged ? `  ⚠️  OUTCOME CHANGED (${prodWinnerName} → ${localWinnerName})` : '',
      ].join('');

      // Stat breakdown for home if changed
      const breakdownLines = [];
      if (homeChanged) {
        const ph = prodHome;  const lh = localHome;
        breakdownLines.push(`    ${homeName}: AB ${ph?.ab??'?'}→${lh?.ab??'?'}  pts ${ph?.abl_points?.toFixed(1)??'?'}→${lh?.abl_points?.toFixed(1)??'?'}  H ${ph?.h??'?'}→${lh?.h??'?'}  HR ${ph?.hr??'?'}→${lh?.hr??'?'}  BB ${ph?.bb??'?'}→${lh?.bb??'?'}`);
      }
      if (awayChanged) {
        const pa = prodAway;  const la = localAway;
        breakdownLines.push(`    ${awayName}: AB ${pa?.ab??'?'}→${la?.ab??'?'}  pts ${pa?.abl_points?.toFixed(1)??'?'}→${la?.abl_points?.toFixed(1)??'?'}  H ${pa?.h??'?'}→${la?.h??'?'}  HR ${pa?.hr??'?'}→${la?.hr??'?'}  BB ${pa?.bb??'?'}→${la?.bb??'?'}`);
      }

      dateLines.push(gameLine);
      dateLines.push(prodLine);
      dateLines.push(newLine);
      if (breakdownLines.length) dateLines.push(...breakdownLines);
      dateLines.push('');

      scoreChanges.push({ date, homeName, awayName, prodWinnerName, localWinnerName, outcomeChanged });
      if (outcomeChanged) {
        outcomeChanges.push({ date, homeName, awayName, prodWinnerName, localWinnerName });
      }
    }

    if (dateHasChanges) {
      lines.push(`=== ${date} ===`);
      lines.push(...dateLines);
    }
  }

  // -----------------------------------------------------------------------
  // Summary
  // -----------------------------------------------------------------------

  const summaryLines = [
    '================================================================',
    'SUMMARY',
    '================================================================',
    `Total games in range   : ${totalGames}`,
    `Games with score diff  : ${totalScoreChanges}`,
    `Outcome changes        : ${totalOutcomeChanges}`,
    `No prod result (skip)  : ${totalNoProdResult}`,
    `No local result (skip) : ${totalNoLocalResult}`,
    '',
  ];

  if (outcomeChanges.length) {
    summaryLines.push('OUTCOME CHANGES (winner flipped):');
    for (const oc of outcomeChanges) {
      summaryLines.push(`  ${oc.date}  ${oc.homeName} (H) vs ${oc.awayName} (A)  :  ${oc.prodWinnerName} → ${oc.localWinnerName}`);
    }
    summaryLines.push('');
  } else {
    summaryLines.push('No outcome changes — only score magnitudes shifted.');
    summaryLines.push('');
  }

  if (scoreChanges.length && !outcomeChanges.length) {
    summaryLines.push('Games with score changes (no outcome flip):');
    for (const sc of scoreChanges) {
      summaryLines.push(`  ${sc.date}  ${sc.homeName} (H) vs ${sc.awayName} (A)  winner unchanged: ${sc.prodWinnerName}`);
    }
    summaryLines.push('');
  }

  const header = [
    '================================================================',
    'ABL SCORE AUDIT — effectiveDate bug fix',
    `Generated : ${new Date().toISOString()}`,
    `Local DB  : ${LOCAL_DB_NAME}`,
    `Prod  DB  : ${PROD_DB_NAME}`,
    `Date range: ${DATE_START.toISOString().slice(0,10)} → ${new Date(DATE_END - 1).toISOString().slice(0,10)}`,
    '================================================================',
    '',
  ];

  const fullReport = [...header, ...summaryLines, ...lines].join('\n');

  // Print to console
  console.log(fullReport);

  // Write to file
  const outDir = resolve(__dirname, 'audit-output');
  mkdirSync(outDir, { recursive: true });
  const ts = new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19);
  const outPath = resolve(outDir, `score-audit-${ts}.txt`);
  writeFileSync(outPath, fullReport, 'utf8');
  console.log(`\nReport saved to: ${outPath}`);

} finally {
  await localClient.close();
  await prodClient.close();
}
