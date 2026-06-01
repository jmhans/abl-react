const { MongoClient } = require('mongodb');
const fs = require('fs');
for (const l of fs.readFileSync('.env.local','utf8').split(/\r?\n/)) {
  const m = l.match(/^([^#=\r]+)=(.+)/); if (m) process.env[m[1].trim()] = m[2].trim();
}
const client = new MongoClient(process.env.MONGODB_URI);
client.connect().then(async () => {
  const db = client.db();

  const total = await db.collection('lineups').countDocuments();
  console.log('Total lineup docs:', total);

  const sample = await db.collection('lineups').find({}).limit(1).toArray();
  if (sample[0]) {
    console.log('Sample keys:', Object.keys(sample[0]));
    console.log('Sample roster[0]:', JSON.stringify(sample[0].roster?.[0]));
    console.log('effectiveDate:', sample[0].effectiveDate);
    console.log('ablTeam:', sample[0].ablTeam?.toString());
    console.log('leagueId:', sample[0].leagueId);
    console.log('seasonId:', sample[0].seasonId);
  }

  // Which teams + dates exist?
  const byTeam = await db.collection('lineups').aggregate([
    { $group: { _id: { team: '$ablTeam', date: '$effectiveDate' }, count: { $sum: 1 } } },
    { $sort: { '_id.date': -1 } }
  ]).toArray();
  console.log('\nLineups by team+date (recent first):');
  byTeam.slice(0, 40).forEach(r => console.log(' ', r._id.date, String(r._id.team), 'x', r.count));

  // How many distinct teams have lineups?
  const distinctTeams = new Set(byTeam.map(r => String(r._id.team)));
  console.log('\nDistinct teams with lineups:', distinctTeams.size);

  // How many distinct teams appear in 4/12 games?
  const games412 = await db.collection('games').find({
    gameDate: { $gte: new Date('2026-04-12'), $lt: new Date('2026-04-13') }
  }).toArray();
  const gameTeams = new Set();
  for (const g of games412) {
    if (g.homeTeam) gameTeams.add(g.homeTeam.toString());
    if (g.awayTeam) gameTeams.add(g.awayTeam.toString());
  }
  console.log('Teams in 4/12 games:', gameTeams.size);

  // Which game teams are MISSING from lineups?
  const missing = [...gameTeams].filter(id => !distinctTeams.has(id));
  console.log('Teams with NO lineup at all:', missing.length, missing);

  // Show seasons to understand scope
  const seasons = await db.collection('seasons').find({}).toArray();
  console.log('\nSeasons:');
  for (const s of seasons) {
    console.log(' ', s._id.toString(), 'year:', s.year, 'leagueId:', s.leagueId?.toString(), 'teams:', s.teamIds?.length);
  }

  await client.close();
}).catch(console.error);
