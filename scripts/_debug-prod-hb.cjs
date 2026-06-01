// Connects to PROD db and diagnoses Handbaskets W/L
const { MongoClient } = require('mongodb');
const fs = require('fs'), path = require('path');
for (const l of fs.readFileSync(path.resolve('.env.local'), 'utf8').split(/\r?\n/)) {
  const m = l.match(/^([^#=\r]+)=(.+)/); if (m) process.env[m[1].trim()] = m[2].trim();
}
const devUri = process.env.MONGODB_URI_DIRECT || process.env.MONGODB_URI;
const prodUri = devUri.replace('abl_dev', 'heroku_wm40bx9r');

(async () => {
  const c = new MongoClient(prodUri); await c.connect();
  const db = c.db('heroku_wm40bx9r');

  // Find the Handbaskets team
  const hb = await db.collection('ablteams').findOne({ nickname: /handbasket/i });
  console.log('Handbaskets team:', JSON.stringify({ _id: hb && hb._id, nickname: hb && hb.nickname }));
  if (!hb) { await c.close(); return; }

  // Find their 2026 games with results
  const league = await db.collection('leagues').findOne({ slug: 'abl' });
  const season = league && await db.collection('seasons').findOne({ leagueId: league._id, year: 2026 });
  console.log('Season:', JSON.stringify({ _id: season && season._id, year: season && season.year }));

  const games = await db.collection('games').find({
    seasonId: season._id,
    $or: [{ homeTeam: hb._id }, { awayTeam: hb._id }],
    'result.winner': { $exists: true }
  }).toArray();

  console.log(`\nHandbaskets games with results: ${games.length}`);
  games.forEach(g => {
    const winner = g.result && g.result.winner;
    const winnerStr = winner && (winner.toString ? winner.toString() : String(winner));
    const hbStr = hb._id.toString();
    const hbWon = winnerStr === hbStr;
    console.log(JSON.stringify({
      date: g.gameDate && g.gameDate.toISOString().slice(0, 10),
      isFinal: g.result && g.result.isFinal,
      hbIsHome: g.homeTeam && g.homeTeam.toString() === hbStr,
      winner: winnerStr,
      hbId: hbStr,
      hbWon,
      winnerType: winner && (winner._bsontype || typeof winner),
    }));
  });

  // Now run the standings pipeline on prod and show Handbaskets row
  const svInfo = await db.listCollections({ name: 'standings_view' }).next();
  const pl = (svInfo && svInfo.options && svInfo.options.pipeline) || [];
  console.log('\nstandings_view pipeline stages:', pl.length);

  const standings = await db.collection('games')
    .aggregate([
      { $match: { seasonId: season._id, 'result.isFinal': { $ne: false } } },
      ...pl
    ]).toArray();

  const hbRow = standings.find(s => s._id && s._id.toString() === hb._id.toString());
  console.log('\nHandbaskets standings row:', JSON.stringify({ w: hbRow && hbRow.w, l: hbRow && hbRow.l, g: hbRow && hbRow.g, outcomes: hbRow && hbRow.outcomes }));

  // Also check the pipeline stage that assigns outcome
  console.log('\nStage 9 (outcome assignment):', JSON.stringify(pl[9]));

  await c.close();
})().catch(e => { console.error(e.message); process.exit(1); });
