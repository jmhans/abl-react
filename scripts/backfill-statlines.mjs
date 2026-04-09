/**
 * backfill-statlines.mjs
 *
 * Fetches MLB boxscore data for a date range and writes compact statlines
 * to MongoDB in the same format used by the daily-stat-refresh service.
 *
 * Usage:
 *   node scripts/backfill-statlines.mjs                        # 2026-03-26 → yesterday
 *   node scripts/backfill-statlines.mjs --start 2026-03-26     # custom start
 *   node scripts/backfill-statlines.mjs --start 2026-03-26 --end 2026-04-15
 *   node scripts/backfill-statlines.mjs --dry                  # preview only, no writes
 */

import { MongoClient } from 'mongodb';
import { readFileSync } from 'fs';
import { resolve, dirname } from 'path';
import { fileURLToPath } from 'url';

const __dirname = dirname(fileURLToPath(import.meta.url));
for (const line of readFileSync(resolve(__dirname, '..', '.env.local'), 'utf8').split(/\r?\n/)) {
  const m = line.match(/^([^#=\r]+)=(.*\S*)/);
  if (m) process.env[m[1].trim()] = m[2].trim();
}

const MLB_API = 'https://statsapi.mlb.com/api/v1';

// ── CLI args ──────────────────────────────────────────────────────────────────
const args = process.argv.slice(2);
const argIdx = (flag) => args.indexOf(flag);
const getArg = (flag) => { const i = argIdx(flag); return i !== -1 ? args[i + 1] : null; };
const DRY = args.includes('--dry');
const PROD = args.includes('--prod');

const today = new Date();
const yesterday = new Date(Date.UTC(today.getUTCFullYear(), today.getUTCMonth(), today.getUTCDate() - 1));

const DEFAULT_START = '2026-03-26'; // 2026 MLB Opening Day
const startStr = getArg('--start') || DEFAULT_START;
const endStr   = getArg('--end')   || yesterday.toISOString().slice(0, 10);

// ── Helpers ───────────────────────────────────────────────────────────────────
const fmt = (d) => d.toISOString().slice(0, 10);

function dateRange(startStr, endStr) {
  const dates = [];
  const cur = new Date(startStr + 'T00:00:00.000Z');
  const end = new Date(endStr   + 'T00:00:00.000Z');
  while (cur <= end) { dates.push(fmt(new Date(cur))); cur.setUTCDate(cur.getUTCDate() + 1); }
  return dates;
}

async function fetchJson(url) {
  const r = await fetch(url);
  if (!r.ok) throw new Error(`HTTP ${r.status}: ${url}`);
  return r.json();
}

// Stat field short-names (mirrors stat-refresh-service.ts)
const BATTING_SHORT = {
  gamesPlayed:'g', atBats:'ab', hits:'h', doubles:'2b', triples:'3b',
  homeRuns:'hr', baseOnBalls:'bb', intentionalWalks:'ibb', hitByPitch:'hbp',
  stolenBases:'sb', caughtStealing:'cs', sacBunts:'sac', sacFlies:'sf', pickoffs:'po',
};

function toNum(v) { const n = Number(v); return Number.isFinite(n) ? n : 0; }

function encodeEntry(allPositions, batting, fielding, gameStatus) {
  const b = {};
  for (const [long, short] of Object.entries(BATTING_SHORT)) {
    const v = toNum(batting?.[long]);
    if (v) b[short] = v;
  }
  const e = toNum(fielding?.errors);
  const pb = toNum(fielding?.passedBall);
  if (e)  b.e  = e;
  if (pb) b.pb = pb;

  const entry = { b };
  if (allPositions?.length) entry.pos = allPositions;
  if (gameStatus) entry.t = gameStatus;
  return entry;
}

function isPositionPlayer(p) {
  const abbr = p?.position?.abbreviation;
  if (!abbr) return false;
  if (abbr !== 'P') return true;
  // Two-way: pitcher who batted
  return Object.values(p?.stats?.batting || {}).some(v => toNum(v) !== 0);
}

// ── Main ──────────────────────────────────────────────────────────────────────
const mongoUri = PROD ? process.env.MONGODB_URI.replace('/abl_dev', '/heroku_wm40bx9r') : process.env.MONGODB_URI;
const client = new MongoClient(mongoUri);
await client.connect();
const dbName = PROD ? 'heroku_wm40bx9r' : (process.env.MONGODB_DB || 'abl_dev');
const db = client.db(dbName);

const dates = dateRange(startStr, endStr);
console.log(`📅 Date range: ${startStr} → ${endStr}  (${dates.length} days)${DRY ? '  [DRY RUN]' : ''}`);

let totalGames = 0, totalStatlines = 0, totalPlayers = 0;

for (const dateStr of dates) {
  process.stdout.write(`  ${dateStr} … `);

  // 1. Get schedule for this date
  let schedule;
  try {
    schedule = await fetchJson(`${MLB_API}/schedule?sportId=1&date=${dateStr}&hydrate=game(content(editorial(recap)))&fields=dates,games,gamePk,gameDate,gameType,status,abstractGameState`);
  } catch (e) {
    console.log(`⚠️  schedule fetch failed: ${e.message}`);
    continue;
  }

  const games = schedule?.dates?.[0]?.games ?? [];
  const finalGames = games.filter(g => g?.status?.abstractGameState === 'Final' && g?.gameType === 'R');

  if (finalGames.length === 0) {
    console.log(`no final REGULAR SEASON games`);
    continue;
  }

  // 2. For each final regular-season game, fetch boxscore
  // Statlines for this date are stored as one doc keyed by date:
  //   { _id: "2026-03-26", p: { "mlbId_gamePk": { b, pos, t }, ... } }
  const pEntries = {};

  for (const game of finalGames) {
    const gamePk = game.gamePk;
    let boxscore;
    try {
      boxscore = await fetchJson(`${MLB_API}/game/${gamePk}/boxscore`);
    } catch (e) {
      process.stdout.write(`[boxscore ${gamePk} failed] `);
      continue;
    }

    const sides = ['away', 'home'];
    for (const side of sides) {
      const teamPlayers = Object.values(boxscore?.teams?.[side]?.players || {});
      for (const p of teamPlayers) {
        if (!isPositionPlayer(p)) continue;
        const mlbId = String(p?.person?.id || '');
        if (!mlbId) continue;

        const allPositions = (p?.allPositions || [])
          .map(pos => pos?.abbreviation)
          .filter(Boolean);

        const entry = encodeEntry(
          allPositions,
          p?.stats?.batting,
          p?.stats?.fielding,
          'Final'
        );

        const key = `${mlbId}_${gamePk}`;
        pEntries[key] = entry;
        totalPlayers++;
      }
    }
    totalGames++;
  }

  const entryCount = Object.keys(pEntries).length;
  if (entryCount === 0) {
    console.log(`no player entries`);
    continue;
  }

  // 3. Upsert into statlines (merge keys so re-running is safe)
  if (!DRY) {
    // Build a $set that only updates individual player-game keys (non-destructive)
    const setFields = {};
    for (const [k, v] of Object.entries(pEntries)) {
      setFields[`p.${k}`] = v;
    }
    await db.collection('statlines').updateOne(
      { _id: dateStr },
      { $set: setFields },
      { upsert: true }
    );
  }

  totalStatlines += entryCount;
  console.log(`✅ ${finalGames.length} games, ${entryCount} entries`);
}

console.log(`\n✅ Done. Games: ${totalGames}  Player-game statlines: ${totalStatlines}  Players touched: ${totalPlayers}`);

if (!DRY) {
  console.log('\nRun next to update CommishPos + position_log:');
  console.log('  node scripts/update-positions-2026.mjs');
}

await client.close();
