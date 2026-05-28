/**
 * fix-effectivedate-bug.mjs
 *
 * Finds lineup documents that were saved pre-lock on ABL date D but received
 * effectiveDate = D+1 (or later) due to the bug where getNextRosterGameDate
 * used `gameDate >= now` against ABL game records (midnight UTC timestamps),
 * causing the query to skip today and return tomorrow once the clock passed
 * midnight UTC — even though the roster lock (first MLB pitch) hadn't fired yet.
 *
 * For each affected lineup:
 *   1. Logs it (team, savedAt, wrong effectiveDate, correct effectiveDate)
 *   2. In DRY_RUN=false mode:
 *        a. If a document with the correct effectiveDate already exists for the
 *           same team, the bugged document's roster overwrites it (since it was
 *           the most recent save) and the bugged document is deleted.
 *        b. If no correct-date document exists, the effectiveDate field is
 *           updated in place.
 *
 * Usage:
 *   node scripts/fix-effectivedate-bug.mjs           # dry run (default)
 *   DRY_RUN=false node scripts/fix-effectivedate-bug.mjs   # apply fixes
 */

import { MongoClient } from 'mongodb';
import { readFileSync } from 'fs';
import { fileURLToPath } from 'url';
import { dirname, resolve } from 'path';

const __dirname = dirname(fileURLToPath(import.meta.url));
// Capture TARGET_MONGODB_URI before .env.local can overwrite it
const TARGET_MONGODB_URI_OVERRIDE = process.env.TARGET_MONGODB_URI;
for (const line of readFileSync(resolve(__dirname, '..', '.env.local'), 'utf8').split(/\r?\n/)) {
  const m = line.match(/^([^#=\r]+)=(.*)/);
  if (m) process.env[m[1].trim()] = m[2].trim();
}

// TARGET_MONGODB_URI (set before script runs) overrides .env.local MONGODB_URI
const MONGODB_URI = TARGET_MONGODB_URI_OVERRIDE || process.env.MONGODB_URI;
const DRY_RUN = process.env.DRY_RUN !== 'false';

if (!MONGODB_URI) {
  console.error('MONGODB_URI not set. Either set it in .env.local or pass TARGET_MONGODB_URI env var.');
  process.exit(1);
}

// Extract DB name from the URI path (e.g. .../abl_dev or .../abl_prod)
const DB_NAME = new URL(MONGODB_URI.replace('mongodb+srv://', 'https://')).pathname.replace('/', '') || 'abl_dev';

/**
 * Mirrors the server-side deriveAblDate: ABL day rolls over at 08:00 UTC.
 * A save at 01:30 UTC on May 27 belongs to the May 26 ABL day.
 */
function deriveAblDate(date) {
  const d = new Date(date);
  if (d.getUTCHours() < 8) {
    d.setUTCDate(d.getUTCDate() - 1);
  }
  return d.toISOString().slice(0, 10);
}

async function main() {
  const client = new MongoClient(MONGODB_URI);
  try {
    await client.connect();
    const db = client.db(DB_NAME);

    console.log(`[fix-effectivedate-bug] DRY_RUN=${DRY_RUN}  db=${DB_NAME}\n`);

    // ── Step 1: Find all lineups where effectiveDate > deriveAblDate(updatedAt) ──
    // Uses a MongoDB aggregation to compute the expected effective date server-side.
    // $hour in UTC: if >= 8 → same UTC date; if < 8 → subtract one day.
    const candidates = await db.collection('lineups').aggregate([
      {
        $match: {
          updatedAt: { $exists: true, $type: 'date' },
          effectiveDate: { $exists: true },
        },
      },
      {
        $addFields: {
          expectedEffectiveDate: {
            $dateToString: {
              format: '%Y-%m-%d',
              timezone: 'UTC',
              date: {
                $cond: {
                  if: { $gte: [{ $hour: { date: '$updatedAt', timezone: 'UTC' } }, 8] },
                  then: '$updatedAt',
                  else: { $subtract: ['$updatedAt', 86_400_000] }, // -1 day in ms
                },
              },
            },
          },
        },
      },
      {
        // Only keep docs where the stored effectiveDate is ahead of where it should be
        $match: {
          $expr: { $gt: ['$effectiveDate', '$expectedEffectiveDate'] },
        },
      },
      { $sort: { updatedAt: -1 } },
    ]).toArray();

    if (candidates.length === 0) {
      console.log('No candidate lineups found. Nothing to fix.');
      return;
    }

    console.log(`Found ${candidates.length} candidate lineup(s) with mismatched effectiveDate.\n`);

    // ── Step 2: Confirm each was truly pre-lock (updatedAt < first MLB pitch) ──
    const affected = [];

    for (const lineup of candidates) {
      const expectedDate = lineup.expectedEffectiveDate;

      // Look up the first MLB game start for that date
      const firstGame = await db.collection('mlbgameschemas').findOne(
        {
          officialDate: expectedDate,
          gameType: 'R',
          'status.startTimeTBD': { $ne: true },
        },
        { sort: { gameDate: 1 } },
      );

      // Fall back to 18:00 UTC (noon CT) if no schedule entry found
      const lockTime = firstGame ? new Date(firstGame.gameDate) : new Date(`${expectedDate}T18:00:00Z`);

      if (lineup.updatedAt < lockTime) {
        affected.push({
          doc: lineup,
          expectedDate,
          lockTime: lockTime.toISOString(),
        });
      } else {
        console.log(
          `  SKIP (post-lock save): _id=${lineup._id}  team=${lineup.ablTeam}` +
          `  savedAt=${lineup.updatedAt.toISOString()}  lockTime=${lockTime.toISOString()}`,
        );
      }
    }

    if (affected.length === 0) {
      console.log('\nAll candidates were post-lock saves — no bug-related fixes needed.');
      return;
    }

    console.log(`\n${affected.length} lineup(s) affected by the bug:\n`);

    // ── Step 3: Report (and optionally fix) each affected lineup ──
    for (const { doc, expectedDate, lockTime } of affected) {
      const teamStr = doc.ablTeam?.toString();
      console.log(
        `  _id=${doc._id}  team=${teamStr}\n` +
        `    savedAt          : ${doc.updatedAt.toISOString()}\n` +
        `    lockTime         : ${lockTime}\n` +
        `    storedEffDate    : ${doc.effectiveDate}  (WRONG)\n` +
        `    correctEffDate   : ${expectedDate}\n`,
      );

      if (DRY_RUN) continue;

      // Check whether a document with the correct effectiveDate already exists
      const existingCorrect = await db.collection('lineups').findOne({
        ablTeam: doc.ablTeam,
        effectiveDate: expectedDate,
      });

      if (existingCorrect) {
        // A lineup for the correct date already exists.
        // The bugged save is more recent, so overwrite the existing doc's roster,
        // then delete the bugged doc.
        await db.collection('lineups').updateOne(
          { _id: existingCorrect._id },
          {
            $set: {
              roster: doc.roster,
              updatedAt: doc.updatedAt, // preserve original save time
            },
          },
        );
        await db.collection('lineups').deleteOne({ _id: doc._id });
        console.log(
          `    FIXED (merged): updated existing doc ${existingCorrect._id}` +
          ` with roster from bugged doc, deleted bugged doc ${doc._id}`,
        );
      } else {
        // No conflict — simply correct the effectiveDate
        await db.collection('lineups').updateOne(
          { _id: doc._id },
          { $set: { effectiveDate: expectedDate } },
        );
        console.log(`    FIXED: effectiveDate ${doc.effectiveDate} → ${expectedDate}`);
      }
    }

    if (!DRY_RUN) {
      console.log('\nFixes applied. Re-run game recalculation for the affected dates to update scores.');
    } else {
      console.log('\n[DRY RUN] No changes written. Set DRY_RUN=false to apply.');
    }
  } finally {
    await client.close();
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
