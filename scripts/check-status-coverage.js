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

  const teamCount = await db.collection('mlbrosters').countDocuments();
  console.log('mlbrosters team docs:', teamCount);

  const total = await db.collection('players_view').countDocuments();
  const withStatus = await db.collection('players_view').countDocuments({ status: { $exists: true, $ne: null } });
  const activeCount = await db.collection('players_view').countDocuments({ status: 'Active' });
  console.log('players_view total:', total);
  console.log('players with any status:', withStatus);
  console.log('players with "Active" status:', activeCount);

  // Show a sample of active players
  const activeSample = await db.collection('players_view').find({ status: 'Active' }).limit(3).toArray();
  console.log('\nSample active players:');
  activeSample.forEach(p => console.log(' ', p.name || p.fullName, '| mlbID:', p.mlbID, '| status:', p.status));

  await client.close();
})().catch(e => console.error('Error:', e));
