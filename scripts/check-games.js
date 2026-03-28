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

  const devDb = client.db('abl_dev');
  const prodDb = client.db('heroku_wm40bx9r');

  // Count games in dev vs prod
  const devGames = await devDb.collection('games').countDocuments();
  const prodGames = await prodDb.collection('games').countDocuments();
  console.log('games in dev:', devGames);
  console.log('games in prod:', prodGames);

  // Count games with results (completed games)
  const devCompleted = await devDb.collection('games').countDocuments({ 'results.0': { $exists: true } });
  const prodCompleted = await prodDb.collection('games').countDocuments({ 'results.0': { $exists: true } });
  console.log('completed games (with results) in dev:', devCompleted);
  console.log('completed games (with results) in prod:', prodCompleted);

  // What years are represented?
  const devYears = await devDb.collection('games').aggregate([
    { $addFields: { year: { $year: '$gameDate' } } },
    { $group: { _id: '$year', count: { $sum: 1 } } },
    { $sort: { _id: 1 } }
  ]).toArray();
  console.log('\nDev games by year:', devYears);

  // standings_view sample — how many games does a team appear to have?
  const svSample = await devDb.collection('standings_view').findOne({});
  if (svSample) {
    console.log('\nstandings_view sample team:', svSample.tm?.nickname || svSample._id);
    console.log('  g:', svSample.g, 'w:', svSample.w, 'l:', svSample.l);
    console.log('  outcomes count:', svSample.outcomes?.length);
  }

  await client.close();
})().catch(e => console.error('Error:', e));
