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

  const withResult = await db.collection('games').countDocuments({ result: { $exists: true } });
  const withOldResults = await db.collection('games').countDocuments({ results: { $exists: true } });
  console.log('games with singular result:', withResult);
  console.log('games with old results array:', withOldResults);

  const sv = await db.collection('standings_view').find({}).toArray();
  const totalG = sv.reduce((s, t) => s + (t.g || 0), 0);
  console.log('\nstandings_view teams:', sv.length, ' totalG:', totalG, ' expected:', 831 * 2);
  sv.sort((a, b) => (b.w || 0) - (a.w || 0));
  sv.forEach(t => console.log(' ', (t.tm?.nickname || t._id).padEnd(20), 'G:', t.g, 'W:', t.w, 'L:', t.l));

  await client.close();
})().catch(e => console.error('Error:', e));
