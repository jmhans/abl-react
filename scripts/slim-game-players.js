/**
 * slim-game-players.js
 *
 * Strips excess fields from the embedded player objects inside
 * games.result.scores[].players[].player.
 *
 * Before: each player entry contains a full hydrated player document
 *   (player.stats = seasonStats, player.team, player.mlbID, player.status,
 *    player.lastStatUpdate, player.ablstatus, …)
 *
 * After: player object contains only { _id, name, eligible } — just enough
 *   for display and for re-calculation (populateRosterPlayers looks up by _id).
 *
 * Usage:
 *   node scripts/slim-game-players.js             # dev only
 *   node scripts/slim-game-players.js --prod      # dev + prod
 *   node scripts/slim-game-players.js --dryrun    # count only, no writes
 */

const { MongoClient } = require('mongodb');
const fs = require('fs'), path = require('path');

const ep = path.resolve(__dirname, '..', '.env.local');
if (fs.existsSync(ep)) {
  for (const l of fs.readFileSync(ep, 'utf8').split(/\r?\n/)) {
    const m = l.match(/^([^#=\r]+)=(.*\S*)/);
    if (m) process.env[m[1].trim()] = m[2].trim();
  }
}

const uri = process.env.MONGODB_URI_DIRECT || process.env.MONGODB_URI;
const includeProd = process.argv.includes('--prod');
const dryRun = process.argv.includes('--dryrun');

const DEV_DB = 'abl_dev';
const PROD_DB = 'heroku_wm40bx9r';

// Fields to KEEP on the embedded player object. Everything else is dropped.
const PLAYER_KEEP_FIELDS = new Set(['_id', 'name', 'eligible']);

function slimPlayer(player) {
  if (!player || typeof player !== 'object') return player;
  const slim = {};
  for (const key of PLAYER_KEEP_FIELDS) {
    if (key in player) slim[key] = player[key];
  }
  return slim;
}

function slimScores(scores) {
  return scores.map((score) => ({
    ...score,
    players: Array.isArray(score.players)
      ? score.players.map((entry) => ({
          ...entry,
          player: slimPlayer(entry.player),
        }))
      : score.players,
  }));
}

// Handles both result (singular) and results (array) shapes
function slimGameResult(game) {
  if (game.result?.scores) {
    return { result: { ...game.result, scores: slimScores(game.result.scores) } };
  }
  if (Array.isArray(game.results) && game.results.length > 0) {
    return {
      results: game.results.map((r) =>
        r?.scores ? { ...r, scores: slimScores(r.scores) } : r
      ),
    };
  }
  return null;
}

function playerNeedsSlimming(player) {
  if (!player || typeof player !== 'object') return false;
  return Object.keys(player).some((k) => !PLAYER_KEEP_FIELDS.has(k));
}

function scoresNeedSlimming(scores) {
  if (!Array.isArray(scores)) return false;
  return scores.some((score) =>
    Array.isArray(score.players) &&
    score.players.some((entry) => playerNeedsSlimming(entry.player))
  );
}

function gameNeedsSlimming(game) {
  if (game.result?.scores) return scoresNeedSlimming(game.result.scores);
  if (Array.isArray(game.results)) {
    return game.results.some((r) => scoresNeedSlimming(r?.scores));
  }
  return false;
}

async function slimDb(db, dbName) {
  console.log(`\n=== Slimming game players in ${dbName} ===`);

  const total = await db.collection('games').countDocuments({
    $or: [
      { 'result.scores': { $exists: true } },
      { 'results.0.scores': { $exists: true } },
    ],
  });
  console.log(`  Total games with scores: ${total}`);

  if (total === 0) {
    console.log('  Nothing to do.');
    return;
  }

  const cursor = db.collection('games').find({
    $or: [
      { 'result.scores': { $exists: true } },
      { 'results.0.scores': { $exists: true } },
    ],
  });

  let checked = 0, slimmed = 0, alreadySlim = 0;
  const bulk = [];

  for await (const game of cursor) {
    checked++;

    if (!gameNeedsSlimming(game)) {
      alreadySlim++;
      continue;
    }

    const slimmedUpdate = slimGameResult(game);

    if (dryRun) {
      slimmed++;
      continue;
    }

    bulk.push({
      updateOne: {
        filter: { _id: game._id },
        update: { $set: slimmedUpdate },
      },
    });
    slimmed++;

    if (bulk.length === 200) {
      await db.collection('games').bulkWrite(bulk, { ordered: false });
      bulk.length = 0;
      process.stdout.write('.');
    }
  }

  if (bulk.length > 0) {
    await db.collection('games').bulkWrite(bulk, { ordered: false });
  }

  console.log(`\n  Checked: ${checked}, Slimmed: ${slimmed}, Already slim: ${alreadySlim}`);
  if (dryRun && slimmed > 0) {
    console.log(`  [dryrun] Would slim ${slimmed} game documents.`);
  }
}

async function main() {
  if (!uri) throw new Error('MONGODB_URI not set in .env.local');

  const client = new MongoClient(uri);
  await client.connect();
  console.log('Connected to MongoDB');
  if (dryRun) console.log('[DRY RUN — no writes]');

  try {
    await slimDb(client.db(DEV_DB), DEV_DB);

    if (includeProd) {
      await slimDb(client.db(PROD_DB), PROD_DB);
    } else {
      console.log('\n💡 To also slim prod, run with --prod flag.');
    }

    console.log('\n✅ Done.');
  } finally {
    await client.close();
  }
}

main().catch((e) => {
  console.error('Fatal:', e);
  process.exit(1);
});
