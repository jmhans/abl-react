const { MongoClient } = require('mongodb');
const fs = require('fs');
for (const l of fs.readFileSync('.env.local','utf8').split(/\r?\n/)) {
  const m = l.match(/^([^#=\r]+)=(.+)/); if (m) process.env[m[1].trim()] = m[2].trim();
}
const client = new MongoClient(process.env.MONGODB_URI);
client.connect().then(async () => {
  const db = client.db();

  const vipers = await db.collection('ablteams').findOne({ nickname: { $regex: /viper/i } });
  if (!vipers) { console.log('Vipers team not found'); await client.close(); return; }
  console.log('Vipers _id:', vipers._id.toString(), 'name:', vipers.name ?? vipers.nickname);

  const today = '2026-04-12';
  const game = await db.collection('games').findOne({
    $or: [{ homeTeam: vipers._id }, { awayTeam: vipers._id }],
    gameDate: { $gte: new Date(today), $lt: new Date('2026-04-13') }
  });
  if (!game) { console.log('No game today for Vipers'); await client.close(); return; }
  console.log('Game _id:', game._id.toString(), 'gameDate:', game.gameDate);

  const isHome = game.homeTeam.toString() === vipers._id.toString();
  const lockedRoster = isHome ? game.homeTeamRoster : game.awayTeamRoster;
  if (!lockedRoster) {
    console.log('No locked roster on game doc');
  } else {
    console.log('\nLocked roster length:', lockedRoster.length);
    const playerIds = lockedRoster.map(r => r.player);
    const players = await db.collection('players').find({ _id: { $in: playerIds } }).toArray();
    const pm = new Map(players.map(p => [p._id.toString(), p.name]));
    lockedRoster.sort((a,b) => (a.rosterOrder??999)-(b.rosterOrder??999)).forEach(r => {
      console.log(' ', r.rosterOrder, pm.get(r.player.toString()) ?? r.player.toString(), '-', r.lineupPosition);
    });
  }

  const lineups = await db.collection('lineups')
    .find({ ablTeam: vipers._id })
    .sort({ effectiveDate: -1 })
    .limit(3)
    .toArray();
  console.log('\nMost recent lineup docs:');
  lineups.forEach(l => console.log(' effectiveDate:', l.effectiveDate, 'roster length:', l.roster?.length));

  if (lineups[0]) {
    const lr = lineups[0].roster ?? [];
    const pids = lr.map(r => r.player);
    const ps = await db.collection('players').find({ _id: { $in: pids } }).toArray();
    const pm2 = new Map(ps.map(p => [p._id.toString(), p.name]));
    console.log('\nLatest lineup (' + lineups[0].effectiveDate + ') roster order:');
    lr.sort((a,b) => (a.rosterOrder??999)-(b.rosterOrder??999)).forEach(r => {
      console.log(' ', r.rosterOrder, pm2.get(r.player.toString()) ?? r.player.toString(), '-', r.lineupPosition);
    });
  }

  await client.close();
}).catch(console.error);
