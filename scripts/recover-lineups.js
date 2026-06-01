/**
 * recover-lineups.js
 *
 * Recovers ABL lineups wiped by the unscoped deleteMany({}) bug in the draft creation route.
 *
 * Strategy:
 *  1. For each ABL 2026 team, use the most recent lineup from the SOURCE DB (dev/abl_dev).
 *  2. For any team whose latest lineup pre-dates 4/12, reconstruct a 4/12 lineup from
 *     that team's homeTeamRoster / awayTeamRoster on a 4/12 game doc, adding acqType:
 *     rosterOrder 1-24 => 'draft', 25+ => 'fa'.
 *  3. Upserts all lineup docs into the TARGET DB (production) using effectiveDate + ablTeam
 *     as the unique key. Existing docs with the same key are NOT overwritten unless
 *     --force flag is passed.
 *
 * Usage:
 *   SOURCE_URI=<dev uri>  TARGET_URI=<prod uri>  node scripts/recover-lineups.js
 *
 * Both SOURCE_URI and TARGET_URI default to MONGODB_URI from .env.local if not set.
 * Pass --dry-run to preview without writing. Pass --force to overwrite existing docs.
 *
 * The TARGET_URI should be the production MongoDB connection string (from Vercel env vars).
 */

const { MongoClient, ObjectId } = require('mongodb');
const fs = require('fs');

// Load .env.local
for (const l of fs.readFileSync('.env.local', 'utf8').split(/\r?\n/)) {
  const m = l.match(/^([^#=\r]+)=(.+)/);
  if (m) process.env[m[1].trim()] = m[2].trim();
}

const DRY_RUN = process.argv.includes('--dry-run');
const FORCE   = process.argv.includes('--force');

const SOURCE_URI = process.env.SOURCE_URI || process.env.MONGODB_URI;
const TARGET_URI = process.env.TARGET_URI || process.env.MONGODB_URI;

// Extract DB name from URI
function dbNameFromUri(uri) {
  const m = uri.match(/\/([^/?]+)(\?|$)/);
  return m ? m[1] : null;
}

async function main() {
  console.log('SOURCE:', SOURCE_URI.replace(/:\/\/[^@]+@/, '://***@'), '→ db:', dbNameFromUri(SOURCE_URI));
  console.log('TARGET:', TARGET_URI.replace(/:\/\/[^@]+@/, '://***@'), '→ db:', dbNameFromUri(TARGET_URI));
  console.log('DRY_RUN:', DRY_RUN, '  FORCE:', FORCE);
  console.log('');

  const sourceClient = new MongoClient(SOURCE_URI);
  const targetClient = SOURCE_URI === TARGET_URI ? sourceClient : new MongoClient(TARGET_URI);

  await sourceClient.connect();
  if (SOURCE_URI !== TARGET_URI) await targetClient.connect();

  const srcDb = sourceClient.db();
  const tgtDb = SOURCE_URI === TARGET_URI ? srcDb : targetClient.db();

  // === 1. Get all ABL teams from the target (prod) 2026 season ===
  const abl2026Season = await tgtDb.collection('seasons').findOne({
    year: 2026,
    leagueId: 'aaaaaa000000000000000001',
  });
  // Fallback: try ObjectId leagueId
  const abl2026SeasonOid = abl2026Season || await tgtDb.collection('seasons').findOne({ year: 2026 });
  if (!abl2026SeasonOid) {
    console.error('Could not find ABL 2026 season in target DB');
    process.exit(1);
  }
  console.log('ABL 2026 season:', abl2026SeasonOid._id.toString(), 
              'leagueId:', abl2026SeasonOid.leagueId,
              'teams:', abl2026SeasonOid.teamIds?.length);

  const teamIds = (abl2026SeasonOid.teamIds || []).map(id => id.toString());
  console.log('Teams to recover:', teamIds.length, '\n');

  // === 2. Load all existing lineups from SOURCE ===
  const sourceLineups = await srcDb.collection('lineups').find({}).toArray();
  // Build map: teamId -> latest lineup doc
  const latestByTeam = new Map();
  for (const doc of sourceLineups) {
    const tid = doc.ablTeam?.toString();
    if (!tid) continue;
    if (!latestByTeam.has(tid) || doc.effectiveDate > latestByTeam.get(tid).effectiveDate) {
      latestByTeam.set(tid, doc);
    }
  }

  // === 3. Load 4/12 game docs from TARGET (prod has game docs) ===
  const games412 = await tgtDb.collection('games').find({
    gameDate: { $gte: new Date('2026-04-12'), $lt: new Date('2026-04-13') },
  }).toArray();
  console.log('4/12 game docs in target:', games412.length);

  // Build map: teamId -> roster array from game doc
  const rosterFromGame = new Map();
  for (const g of games412) {
    if (g.homeTeam && g.homeTeamRoster?.length) {
      rosterFromGame.set(g.homeTeam.toString(), g.homeTeamRoster);
    }
    if (g.awayTeam && g.awayTeamRoster?.length) {
      rosterFromGame.set(g.awayTeam.toString(), g.awayTeamRoster);
    }
  }

  // === 4. Build the lineup docs to upsert ===
  const docsToWrite = [];

  for (const teamId of teamIds) {
    const existing = latestByTeam.get(teamId);

    if (existing && existing.effectiveDate >= '2026-04-12') {
      // Dev has a 4/12 lineup — use it directly
      const doc = {
        ablTeam: existing.ablTeam,
        effectiveDate: existing.effectiveDate,
        roster: existing.roster,
      };
      docsToWrite.push({ teamId, source: 'dev-4/12', doc });
    } else if (rosterFromGame.has(teamId)) {
      // Reconstruct from game's locked roster, adding acqType
      const gameRoster = rosterFromGame.get(teamId);
      const reconstructed = gameRoster.map(item => ({
        player: item.player,          // already stored as string or ObjectId
        lineupPosition: item.lineupPosition,
        rosterOrder: item.rosterOrder ?? 0,
        acqType: (item.rosterOrder ?? 0) <= 24 ? 'draft' : 'fa',
      }));
      const doc = {
        ablTeam: typeof existing?.ablTeam === 'object'
          ? existing.ablTeam
          : new ObjectId(teamId),
        effectiveDate: '2026-04-12',
        roster: reconstructed,
      };
      docsToWrite.push({ teamId, source: 'game-roster-reconstructed', doc });
    } else if (existing) {
      // Have an older dev lineup but no game doc — use the older one, note it
      const doc = {
        ablTeam: existing.ablTeam,
        effectiveDate: existing.effectiveDate,
        roster: existing.roster,
      };
      docsToWrite.push({ teamId, source: `dev-${existing.effectiveDate}-FALLBACK`, doc });
    } else {
      console.warn(`WARNING: no data for team ${teamId} — skipping`);
    }
  }

  // === 5. Preview ===
  console.log('\n=== RECOVERY PLAN ===');
  for (const { teamId, source, doc } of docsToWrite) {
    console.log(`  Team ${teamId}: source=${source}, effectiveDate=${doc.effectiveDate}, roster=${doc.roster?.length}`);
  }

  if (DRY_RUN) {
    console.log('\nDRY RUN — nothing written. Remove --dry-run to execute.');
    await sourceClient.close();
    if (SOURCE_URI !== TARGET_URI) await targetClient.close();
    return;
  }

  // === 6. Upsert into target DB ===
  console.log('\n=== WRITING TO TARGET DB ===');
  let written = 0, skipped = 0;

  for (const { teamId, source, doc } of docsToWrite) {
    // Check if this exact date already exists in target
    const exists = await tgtDb.collection('lineups').findOne({
      ablTeam: doc.ablTeam,
      effectiveDate: doc.effectiveDate,
    });

    if (exists && !FORCE) {
      console.log(`  SKIP team ${teamId} ${doc.effectiveDate} (already exists, use --force to overwrite)`);
      skipped++;
      continue;
    }

    if (exists && FORCE) {
      await tgtDb.collection('lineups').replaceOne(
        { ablTeam: doc.ablTeam, effectiveDate: doc.effectiveDate },
        doc
      );
      console.log(`  REPLACED team ${teamId} ${doc.effectiveDate} [${source}]`);
    } else {
      await tgtDb.collection('lineups').insertOne(doc);
      console.log(`  INSERTED team ${teamId} ${doc.effectiveDate} [${source}]`);
    }
    written++;
  }

  console.log(`\nDone. Written: ${written}, Skipped: ${skipped}`);

  await sourceClient.close();
  if (SOURCE_URI !== TARGET_URI) await targetClient.close();
}

main().catch(err => { console.error(err); process.exit(1); });
