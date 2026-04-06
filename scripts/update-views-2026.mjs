/**
 * update-views-2026.mjs
 *
 * Updates players_view and positions_view to use 2026 as the current year
 * and 2025 as the prior/fallback year.
 *
 * Also clears the `positions` collection (CommishPos overrides) since those
 * were derived from 2025 data. CommishPos will be empty until 2026 game data
 * is loaded — run update-positions-2026.mjs after statlines are available.
 *
 * Eligibility becomes: 2025 maxPosition (fallback) until 2026 data exists.
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

const client = new MongoClient(process.env.MONGODB_URI);
await client.connect();
const DB_NAME = process.env.MONGODB_DB || 'abl_dev';
const db = client.db(DB_NAME);

const CURR_YEAR = 2026;
const PRIOR_YEAR = 2025;

// Shared pipeline fragment: the part that computes eligible from position_log + positions
function buildEligiblePipeline() {
  return [
    // Join all position_log entries for this player
    {
      $lookup: {
        from: 'position_log',
        let: { plyrId: '$mlbID' },
        pipeline: [
          { $match: { $expr: { $and: [{ $eq: ['$mlbId', '$$plyrId'] }] } } }
        ],
        as: 'newPosLog',
      },
    },
    // Reduce to just curr-year and prior-year data
    {
      $addFields: {
        newPosLog: {
          $reduce: {
            input: '$newPosLog',
            initialValue: {},
            in: {
              $switch: {
                branches: [
                  {
                    case: { $eq: ['$$this.season', CURR_YEAR] },
                    then: {
                      curr: '$$this.eligiblePositions',
                      curr_max: '$$this.maxPosition',
                      prior: '$$value.prior',
                    },
                  },
                  {
                    case: { $eq: ['$$this.season', PRIOR_YEAR] },
                    then: {
                      curr: '$$value.curr',
                      curr_max: '$$value.curr_max',
                      prior: '$$this.maxPosition',
                    },
                  },
                ],
                default: '$$value',
              },
            },
          },
        },
      },
    },
    // CommishPos from positions collection
    {
      $lookup: {
        from: 'positions',
        localField: 'mlbID',
        foreignField: 'mlbId',
        as: 'tempCommish',
      },
    },
    {
      $addFields: {
        allPos: {
          $cond: [
            { $gt: [{ $size: { $ifNull: ['$newPosLog.curr', []] } }, 0] },
            { $ifNull: ['$newPosLog.curr', []] },
            [
              {
                $ifNull: [
                  { $first: '$tempCommish.CommishPos' },
                  { $ifNull: ['$newPosLog.prior', '$newPosLog.curr_max'] },
                ],
              },
            ],
          ],
        },
      },
    },
    {
      $addFields: {
        eligible: {
          $filter: {
            input: {
              $reduce: {
                input: '$allPos',
                initialValue: [],
                in: {
                  $cond: [
                    { $in: ['$$this', '$$value'] },
                    '$$value',
                    { $concatArrays: ['$$value', ['$$this']] },
                  ],
                },
              },
            },
            as: 'pos',
            cond: { $ne: ['$$pos', null] },
          },
        },
      },
    },
  ];
}

// ─── positions_view ───────────────────────────────────────────────────────────
const posViewPipeline = [
  {
    $unset: ['stats', 'rst', 'ablstatus', 'team', 'lastUpdate', 'status', 'mlbTeamID'],
  },
  ...buildEligiblePipeline(),
  {
    $project: {
      commishPos: 0,
      posLog: 0,
      newPosLog: 0,
      tempCommish: 0,
      allPos: 0,
      currentYearElig: 0,
      priorYearElig: 0,
      position: 0,
      rosterStatus: 0,
    },
  },
];

// ─── players_view ─────────────────────────────────────────────────────────────
const playersViewPipeline = [
  {
    $unset: ['stats.pitching', 'rst', 'status'],
  },
  // Status from mlbrosters
  {
    $lookup: {
      pipeline: [
        { $unwind: { preserveNullAndEmptyArrays: true, path: '$roster' } },
        { $project: { player: '$roster.person', status: '$roster.status', teamId: 1 } },
        { $match: { $expr: { $eq: ['$$plyrId', { $toString: '$player.id' }] } } },
      ],
      as: 'rosterStatus',
      from: 'mlbrosters',
      let: { plyrId: '$mlbID' },
    },
  },
  {
    $addFields: { status: { $first: '$rosterStatus.status.description' } },
  },
  ...buildEligiblePipeline(),
  // ablTeam lookup
  {
    $lookup: {
      from: 'ablteams',
      localField: 'ablstatus.ablTeam',
      foreignField: '_id',
      as: 'ablstatus.ablTeam',
    },
  },
  { $unwind: { path: '$ablstatus.ablTeam', preserveNullAndEmptyArrays: true } },
  // drops lookup
  {
    $lookup: {
      from: 'drops',
      localField: '_id',
      foreignField: 'player',
      as: 'ablstatus.dropInd',
    },
  },
  {
    $addFields: {
      'ablstatus.pending_drop': { $gt: [{ $size: '$ablstatus.dropInd' }, 0] },
    },
  },
  {
    $project: {
      priorYearElig: 0,
      position: 0,
      posLog: 0,
      newPosLog: 0,
      allPos: 0,
      currentYearElig: 0,
      rosterStatus: 0,
      commishPos: 0,
      tempCommish: 0,
    },
  },
];

// ─── Apply updates ────────────────────────────────────────────────────────────

console.log(`\nUpdating views in database: ${DB_NAME}`);
console.log(`Current year: ${CURR_YEAR}, Prior year: ${PRIOR_YEAR}\n`);

// Drop and recreate positions_view
await db.collection('positions_view').drop().catch(() => {});
await db.createCollection('positions_view', { viewOn: 'players', pipeline: posViewPipeline });
console.log('✅ positions_view updated (curr=' + CURR_YEAR + ', prior=' + PRIOR_YEAR + ')');

// Drop and recreate players_view
await db.collection('players_view').drop().catch(() => {});
await db.createCollection('players_view', { viewOn: 'players', pipeline: playersViewPipeline });
console.log('✅ players_view updated (curr=' + CURR_YEAR + ', prior=' + PRIOR_YEAR + ')');

// Clear positions collection (CommishPos overrides from prior season)
const posCount = await db.collection('positions').countDocuments();
await db.collection('positions').deleteMany({});
console.log('✅ positions collection cleared (' + posCount + ' old CommishPos overrides removed)');
console.log('   CommishPos will be recomputed from 2026 statlines via update-positions-2026.mjs');

// Verify
const ffCheck = await db.collection('players_view').findOne({ mlbID: '666023' });
console.log('\nVerify Freddy Fermin eligible:', ffCheck?.eligible);
// Should be ["C"] from 2025 prior fallback

await client.close();
