const { MongoClient } = require('mongodb');
const fs = require('fs'), path = require('path');
const ep = path.resolve(__dirname, '..', '.env.local');
for (const l of fs.readFileSync(ep, 'utf8').split(/\r?\n/)) {
  const m = l.match(/^([^#=\r]+)=(.*\S*)/);
  if (m) process.env[m[1].trim()] = m[2].trim();
}
const uri = process.env.MONGODB_URI_DIRECT || process.env.MONGODB_URI;

(async () => {
  const client = new MongoClient(uri);
  await client.connect();
  const db = client.db('abl_dev');

  // Check what each view returns
  console.log('=== Standings (patched view) ===');
  const standings = await db.collection('Standings').find({}).limit(3).toArray();
  console.log('count:', standings.length);
  if (standings[0]) console.log('sample:', JSON.stringify(standings[0]).slice(0, 200));

  console.log('\n=== StandingsHelper (patched view) ===');
  const sh = await db.collection('StandingsHelper').find({}).limit(3).toArray();
  console.log('count:', sh.length);
  if (sh[0]) console.log('sample:', JSON.stringify(sh[0]).slice(0, 200));

  console.log('\n=== advanced_standings_view ===');
  const adv = await db.collection('advanced_standings_view').find({}).limit(3).toArray();
  console.log('count:', adv.length);
  if (adv[0]) console.log('sample:', JSON.stringify(adv[0]).slice(0, 200));

  console.log('\n=== standings_view (without advanced lookup — direct pipeline) ===');
  // Test the initial stages manually to see how far the pipeline gets
  const testPipeline = await db.collection('games').aggregate([
    { $match: { gameType: 'R' } },
    { $match: { result: { $exists: true, $ne: null } } },
    { $set: { results: ['$result'] } },
    { $unwind: { path: '$results', preserveNullAndEmptyArrays: false } },
    { $count: 'count' }
  ]).toArray();
  console.log('games after match+wrap+unwind:', testPipeline[0]?.count ?? 0);

  // Check one game's result shape
  console.log('\n=== Sample game result field ===');
  const g = await db.collection('games').findOne({ result: { $exists: true } });
  if (g) {
    console.log('result.winner:', g.result?.winner);
    console.log('result.scores count:', g.result?.scores?.length);
    console.log('result.status:', g.result?.status);
  }

  await client.close();
})().catch(e => console.error('Error:', e));
