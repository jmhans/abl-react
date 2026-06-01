const { MongoClient } = require('mongodb');
const fs = require('fs');
for (const l of fs.readFileSync('.env.local','utf8').split(/\r?\n/)) {
  const m = l.match(/^([^#=\r]+)=(.+)/); if (m) process.env[m[1].trim()] = m[2].trim();
}
const client = new MongoClient(process.env.MONGODB_URI);
client.connect().then(async () => {
  const db = client.db();

  // 1. Show a sample of any surviving lineup docs
  console.log('=== SURVIVING LINEUP DOCS (sample 3) ===');
  const lineupSamples = await db.collection('lineups').find({}).limit(3).toArray();
  if (lineupSamples.length === 0) {
    console.log('NO LINEUPS FOUND — collection is empty');
  } else {
    for (const doc of lineupSamples) {
      console.log('Keys:', Object.keys(doc));
      console.log('ablTeam:', doc.ablTeam);
      console.log('effectiveDate:', doc.effectiveDate);
      console.log('roster sample (first 2):', JSON.stringify(doc.roster?.slice(0,2), null, 2));
      console.log('---');
    }
  }

  // 2. Show how many lineups exist total and which leagues
  const lineupCount = await db.collection('lineups').countDocuments();
  console.log('\nTotal lineup docs remaining:', lineupCount);

  // 3. Check game docs for 4/12/2026 — show homeTeamRoster structure
  console.log('\n=== GAME DOCS FOR 4/12/2026 ===');
  const games = await db.collection('games').find({
    gameDate: { $gte: new Date('2026-04-12'), $lt: new Date('2026-04-13') }
  }).toArray();
  console.log('Games found:', games.length);

  for (const g of games.slice(0, 2)) {
    console.log('\nGame:', g._id.toString(), 'seasonId:', g.seasonId, 'leagueId:', g.leagueId);
    console.log('homeTeam:', g.homeTeam?.toString(), 'awayTeam:', g.awayTeam?.toString());
    const homeRoster = g.homeTeamRoster || [];
    const awayRoster = g.awayTeamRoster || [];
    console.log('homeTeamRoster length:', homeRoster.length);
    console.log('homeTeamRoster[0]:', JSON.stringify(homeRoster[0]));
    console.log('awayTeamRoster length:', awayRoster.length);
    console.log('awayTeamRoster[0]:', JSON.stringify(awayRoster[0]));
  }

  // 4. Show all unique seasonIds/leagueIds in the 4/12 games
  const seasonIds = [...new Set(games.map(g => g.seasonId?.toString()))];
  const leagueIds = [...new Set(games.map(g => g.leagueId?.toString()))];
  console.log('\nDistinct seasonIds in 4/12 games:', seasonIds);
  console.log('Distinct leagueIds in 4/12 games:', leagueIds);

  // 5. Show all seasons and leagues to understand scope
  console.log('\n=== ALL SEASONS ===');
  const seasons = await db.collection('seasons').find({}).toArray();
  for (const s of seasons) {
    console.log(s._id.toString(), 'year:', s.year, 'leagueId:', s.leagueId?.toString(), 'teamIds count:', s.teamIds?.length);
  }

  // 6. Count unique teams appearing in 4/12 games
  const teamIds = new Set();
  for (const g of games) {
    if (g.homeTeam) teamIds.add(g.homeTeam.toString());
    if (g.awayTeam) teamIds.add(g.awayTeam.toString());
  }
  console.log('\nDistinct teams in 4/12 games:', teamIds.size);

  await client.close();
}).catch(console.error);
