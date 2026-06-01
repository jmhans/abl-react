// Inspect full lineup structure + identify which teams need reconstruction from game docs
const { MongoClient } = require('mongodb');
const fs = require('fs');
for (const l of fs.readFileSync('.env.local','utf8').split(/\r?\n/)) {
  const m = l.match(/^([^#=\r]+)=(.+)/); if (m) process.env[m[1].trim()] = m[2].trim();
}
const client = new MongoClient(process.env.MONGODB_URI);
client.connect().then(async () => {
  const db = client.db();

  // Full structure of one 4/12 lineup
  const sample412 = await db.collection('lineups').findOne({ effectiveDate: '2026-04-12' });
  console.log('=== FULL 4/12 LINEUP SAMPLE ===');
  console.log(JSON.stringify(sample412, null, 2).slice(0, 2000));

  // Which 3 teams only have 4/11?
  const all = await db.collection('lineups').find({}).toArray();
  const latestByTeam = new Map();
  for (const doc of all) {
    const tid = doc.ablTeam?.toString();
    if (!latestByTeam.has(tid) || doc.effectiveDate > latestByTeam.get(tid).effectiveDate) {
      latestByTeam.set(tid, doc);
    }
  }

  const teamsNeedingReconstruction = [];
  for (const [tid, doc] of latestByTeam) {
    if (doc.effectiveDate < '2026-04-12') {
      teamsNeedingReconstruction.push({ teamId: tid, latestDate: doc.effectiveDate });
    }
  }
  console.log('\n=== TEAMS NEEDING RECONSTRUCTION (no 4/12 lineup) ===');
  console.log(teamsNeedingReconstruction);

  // Look at game docs roster structure for those teams
  const teamIds = teamsNeedingReconstruction.map(t => t.teamId);
  const { ObjectId } = require('mongodb');
  const games = await db.collection('games').find({
    gameDate: { $gte: new Date('2026-04-12'), $lt: new Date('2026-04-13') },
    $or: [
      { homeTeam: { $in: teamIds.map(id => new ObjectId(id)) } },
      { awayTeam: { $in: teamIds.map(id => new ObjectId(id)) } }
    ]
  }).toArray();

  console.log('\n=== GAME ROSTER SAMPLE FOR MISSING TEAMS ===');
  for (const g of games) {
    for (const side of ['home','away']) {
      const teamField = side + 'Team';
      const rosterField = side + 'TeamRoster';
      if (teamIds.includes(g[teamField]?.toString())) {
        const roster = g[rosterField] || [];
        console.log(`\nTeam: ${g[teamField]} (${side}) — roster length: ${roster.length}`);
        console.log('  roster[0]:', JSON.stringify(roster[0]));
        console.log('  roster[23]:', JSON.stringify(roster[23]));
      }
    }
  }

  // Also show the ABL 2026 seasonId and leagueId for proper lineup scoping
  const abl2026 = await db.collection('seasons').findOne({ year: 2026, leagueId: { $in: ['aaaaaa000000000000000001', { $type: 'objectId' }] } });
  console.log('\nABL 2026 season doc:');
  const ablLeague = await db.collection('leagues').findOne({});
  console.log('leagues sample:', JSON.stringify(ablLeague));

  await client.close();
}).catch(console.error);
