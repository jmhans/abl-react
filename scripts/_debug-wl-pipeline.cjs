// Diagnoses W/L calculation for a specific known-final game
// by manually running the key pipeline stages
const { MongoClient } = require('mongodb');
const fs = require('fs'), path = require('path');
for (const l of fs.readFileSync(path.resolve('.env.local'), 'utf8').split(/\r?\n/)) {
  const m = l.match(/^([^#=\r]+)=(.+)/); if (m) process.env[m[1].trim()] = m[2].trim();
}
const uri = process.env.MONGODB_URI_DIRECT || process.env.MONGODB_URI;

(async () => {
  const c = new MongoClient(uri); await c.connect();
  const db = c.db('abl_dev');

  // --- 1. isFinal breakdown ---
  const cutoff = new Date('2026-01-01');
  const total = await db.collection('games').countDocuments({ gameDate: { $gte: cutoff }, 'result.winner': { $exists: true } });
  const isFinalTrue  = await db.collection('games').countDocuments({ gameDate: { $gte: cutoff }, 'result.isFinal': true });
  const isFinalFalse = await db.collection('games').countDocuments({ gameDate: { $gte: cutoff }, 'result.isFinal': false });
  const isFinalMissing = await db.collection('games').countDocuments({ gameDate: { $gte: cutoff }, 'result.winner': { $exists: true }, 'result.isFinal': { $exists: false } });
  console.log(`\n=== 2026 game results breakdown ===`);
  console.log(`total with result: ${total}, isFinal:true=${isFinalTrue}, isFinal:false=${isFinalFalse}, isFinal missing=${isFinalMissing}`);

  // --- 2. Pick one game (prefer isFinal:true, fall back to false) ---
  let game = await db.collection('games').findOne({ gameDate: { $gte: cutoff }, 'result.isFinal': true });
  if (!game) {
    console.log('\nNo isFinal:true game - using isFinal:false for validation');
    game = await db.collection('games').findOne({ gameDate: { $gte: cutoff }, 'result.winner': { $exists: true } });
  }
  if (!game) { console.log('No 2026 games with results found'); await c.close(); return; }

  console.log(`\n=== Sample game ===`);
  console.log('date:', game.gameDate && game.gameDate.toISOString().slice(0, 10));
  console.log('isFinal:', game.result && game.result.isFinal);
  console.log('winner type:', game.result && game.result.winner && game.result.winner._bsontype);
  console.log('winner value:', game.result && game.result.winner && game.result.winner.toString());
  (game.result && game.result.scores || []).forEach((s, i) => {
    console.log(`score[${i}]: team=${s.team && s.team.toString()} type=${s.team && s.team._bsontype} loc=${s.location} runs=${s.final && s.final.abl_runs}`);
  });

  // --- 3. Run the full standings_view pipeline stages 3-9 on just this game ---
  const svInfo = await db.listCollections({ name: 'standings_view' }).next();
  const pl = (svInfo && svInfo.options && svInfo.options.pipeline) || [];

  // Stages 3-9 manually on just this game
  const testPipeline = [
    { $match: { _id: game._id } },
    ...pl.slice(3, 10), // stages 3 through 9
    { $project: { 'results.winner': 1, 'results.loser': 1, 'results.scores.team': 1, 'results.scores.outcome': 1, teams: 1 } }
  ];
  const rows = await db.collection('games').aggregate(testPipeline).toArray();
  console.log(`\n=== Pipeline rows after stages 3-9 (${rows.length} rows) ===`);
  rows.forEach((r, i) => {
    console.log(`row ${i}: teams=${r.teams && r.teams.toString()} winner=${r.results && r.results.winner} scoreTeam=${r.results && r.results.scores && r.results.scores.team && r.results.scores.team.toString()} outcome=${r.results && r.results.scores && r.results.scores.outcome}`);
  });

  // --- 4. Simulate full season standings with isFinal filter ---
  const league = await db.collection('leagues').findOne({ slug: 'abl' });
  const season = league && await db.collection('seasons').findOne({ leagueId: league._id, year: 2026 });
  if (season) {
    console.log(`\n=== Season standings WITH isFinal filter ===`);
    const finalStandings = await db.collection('games')
      .aggregate([
        { $match: { seasonId: season._id, 'result.isFinal': { $ne: false } } },
        ...pl
      ]).toArray();
    console.log(`Teams in final standings: ${finalStandings.length}`);
    finalStandings.forEach(t => {
      console.log(`  ${(t.tm && t.tm.nickname || t._id).toString().padEnd(15)} W:${t.w} L:${t.l} G:${t.g}`);
    });

    console.log(`\n=== Season standings WITHOUT isFinal filter (for comparison) ===`);
    const allStandings = await db.collection('games')
      .aggregate([
        { $match: { seasonId: season._id } },
        ...pl
      ]).toArray();
    allStandings.forEach(t => {
      console.log(`  ${(t.tm && t.tm.nickname || t._id).toString().padEnd(15)} W:${t.w} L:${t.l} G:${t.g}`);
    });
  }

  await c.close();
})().catch(e => { console.error(e.message); process.exit(1); });
