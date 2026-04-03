/**
 * backfill-lineups-from-draft.mjs
 *
 * One-time migration: populate the `lineups` collection from completed draft picks
 * for leagues/seasons that were set up manually and never ran the /api/draft/finalize route.
 *
 * Safe to re-run — uses upsert so it won't duplicate docs.
 */
import { MongoClient, ObjectId } from 'mongodb';
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
const db = client.db();

// Find all completed drafts
const completedDrafts = await db.collection('drafts')
  .find({ status: 'completed' })
  .toArray();

console.log(`Found ${completedDrafts.length} completed draft(s)`);

for (const draft of completedDrafts) {
  console.log(`\nDraft ${draft._id} leagueId=${draft.leagueId} seasonId=${draft.seasonId} picks=${draft.picks?.length ?? 0}`);

  const picks = draft.picks ?? [];
  if (picks.length === 0) {
    console.log('  No picks — skipping');
    continue;
  }

  // Check how many lineups already exist for this draft's teams
  const teamIds = [...new Set(picks.map(p => String(p.pick?.teamId)).filter(Boolean))];
  const existingLineups = await db.collection('lineups')
    .countDocuments({ ablTeam: { $in: teamIds.map(id => new ObjectId(id)) } });

  if (existingLineups >= teamIds.length) {
    console.log(`  Already has ${existingLineups} lineup docs for ${teamIds.length} teams — skipping`);
    continue;
  }

  // Use draft completedAt as effectiveDate (fallback to now)
  const effectiveDate = draft.completedAt ? new Date(draft.completedAt) : new Date();

  // Group picks by team
  const byTeam = new Map();
  for (const entry of picks) {
    const teamId = String(entry.pick?.teamId || '');
    if (!teamId) continue;
    if (!byTeam.has(teamId)) byTeam.set(teamId, []);
    byTeam.get(teamId).push(entry);
  }

  const ops = [];
  for (const [teamId, teamPicks] of byTeam.entries()) {
    const sorted = [...teamPicks].sort((a, b) => a.pick.overallPick - b.pick.overallPick);
    const roster = sorted.map((entry, i) => ({
      player: new ObjectId(entry.playerId),
      lineupPosition: null,
      rosterOrder: i + 1,
      acqType: 'draft',
    }));

    ops.push({
      updateOne: {
        filter: { ablTeam: new ObjectId(teamId), effectiveDate },
        update: {
          $set: { roster, updatedAt: new Date() },
          $setOnInsert: { ablTeam: new ObjectId(teamId), effectiveDate },
        },
        upsert: true,
      },
    });
  }

  if (ops.length > 0) {
    const result = await db.collection('lineups').bulkWrite(ops);
    console.log(`  Created/updated ${result.upsertedCount + result.modifiedCount} lineup docs across ${ops.length} teams`);
  }
}

// Verify
const totalLineups = await db.collection('lineups').countDocuments();
console.log(`\nDone. Total lineup docs in collection: ${totalLineups}`);

await client.close();
