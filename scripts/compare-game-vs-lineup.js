/**
 * compare-game-vs-lineup.js
 *
 * For each ABL team, compares:
 *   A) Most recent lineup from this DB (dev)  
 *   B) The locked roster from the 4/12 game doc in this DB
 *
 * Reports differences in player list, lineupPosition, or rosterOrder.
 *
 * Usage: node scripts/compare-game-vs-lineup.js
 */
const { MongoClient, ObjectId } = require('mongodb');
const fs = require('fs');
for (const l of fs.readFileSync('.env.local', 'utf8').split(/\r?\n/)) {
  const m = l.match(/^([^#=\r]+)=(.+)/);
  if (m) process.env[m[1].trim()] = m[2].trim();
}

const client = new MongoClient(process.env.MONGODB_URI);
client.connect().then(async () => {
  const db = client.db();

  // Latest lineup per team (dev)
  const allLineups = await db.collection('lineups').find({}).toArray();
  const latestByTeam = new Map();
  for (const doc of allLineups) {
    const tid = doc.ablTeam?.toString();
    if (!tid) continue;
    if (!latestByTeam.has(tid) || doc.effectiveDate > latestByTeam.get(tid).effectiveDate) {
      latestByTeam.set(tid, doc);
    }
  }

  // Game rosters from 4/12
  const games = await db.collection('games').find({
    gameDate: { $gte: new Date('2026-04-12'), $lt: new Date('2026-04-13') }
  }).toArray();

  const gameRosterByTeam = new Map();
  for (const g of games) {
    if (g.homeTeam && g.homeTeamRoster?.length) gameRosterByTeam.set(g.homeTeam.toString(), g.homeTeamRoster);
    if (g.awayTeam && g.awayTeamRoster?.length) gameRosterByTeam.set(g.awayTeam.toString(), g.awayTeamRoster);
  }

  // Team names
  const teamDocs = await db.collection('ablteams').find({}).toArray();
  const teamName = new Map(teamDocs.map(t => [t._id.toString(), t.nickname || t.name || t._id.toString()]));

  const teamIds = [...new Set([...latestByTeam.keys(), ...gameRosterByTeam.keys()])];

  console.log('=== GAME ROSTER vs DEV LINEUP COMPARISON ===\n');

  let anyDiff = false;
  for (const tid of teamIds) {
    const lineupDoc = latestByTeam.get(tid);
    const gameRoster = gameRosterByTeam.get(tid);
    const name = teamName.get(tid) || tid;

    if (!lineupDoc) { console.log(`${name}: NO dev lineup at all`); continue; }
    if (!gameRoster) { console.log(`${name}: NO game roster on 4/12`); continue; }

    // Build maps keyed by player id string
    const lineupMap = new Map(
      (lineupDoc.roster || []).map(r => [r.player?.toString(), r])
    );
    const gameMap = new Map(
      gameRoster.map(r => [r.player?.toString(), r])
    );

    const allPlayerIds = new Set([...lineupMap.keys(), ...gameMap.keys()]);
    const diffs = [];

    for (const pid of allPlayerIds) {
      const inLineup = lineupMap.get(pid);
      const inGame   = gameMap.get(pid);

      if (!inGame) {
        diffs.push(`  + In lineup (${lineupDoc.effectiveDate}) but NOT in game roster: player=${pid} pos=${inLineup.lineupPosition} order=${inLineup.rosterOrder}`);
      } else if (!inLineup) {
        diffs.push(`  - In game roster but NOT in dev lineup: player=${pid} pos=${inGame.lineupPosition} order=${inGame.rosterOrder}`);
      } else {
        // Both have player — check fields
        if (inLineup.lineupPosition !== inGame.lineupPosition) {
          diffs.push(`  ~ player=${pid} lineupPosition: lineup=${inLineup.lineupPosition} vs game=${inGame.lineupPosition} (order: lineup=${inLineup.rosterOrder} game=${inGame.rosterOrder})`);
        }
        if (inLineup.rosterOrder !== inGame.rosterOrder) {
          diffs.push(`  ~ player=${pid} rosterOrder: lineup=${inLineup.rosterOrder} vs game=${inGame.rosterOrder} (pos: ${inLineup.lineupPosition})`);
        }
      }
    }

    if (diffs.length === 0) {
      console.log(`${name} [${lineupDoc.effectiveDate}]: ✓ identical`);
    } else {
      anyDiff = true;
      console.log(`\n${name} [lineup:${lineupDoc.effectiveDate} vs game:4/12] — ${diffs.length} difference(s):`);
      diffs.forEach(d => console.log(d));
    }
  }

  if (!anyDiff) console.log('\nAll teams match — no reconstruction needed.');
  else console.log('\nTeams above have diverged and may need the lineup updated to match the later game state.');

  await client.close();
}).catch(console.error);
