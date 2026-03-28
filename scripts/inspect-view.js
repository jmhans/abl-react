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

  // Check players_view pipeline
  const devDb = client.db('abl_dev');
  const views = await devDb.listCollections({ name: 'players_view' }).toArray();
  const v = views[0];
  console.log('=== players_view ===');
  console.log('viewOn:', v.options.viewOn);
  console.log('total stages:', v.options.pipeline.length);
  v.options.pipeline.forEach((s, i) => {
    const op = Object.keys(s)[0];
    console.log(`  [${i}] ${op}:`, JSON.stringify(s).substring(0, 400));
  });

  // Check mlbrosters sample
  console.log('\n=== mlbrosters sample ===');
  const sample = await devDb.collection('mlbrosters').findOne({});
  if (!sample) {
    console.log('mlbrosters is EMPTY — need to run Sync Roster Statuses');
  } else {
    console.log('teamId:', sample.teamId, 'teamName:', sample.teamName);
    console.log('roster length:', sample.roster?.length);
    if (sample.roster?.length > 0) {
      const p = sample.roster[0];
      console.log('first player:', JSON.stringify(p).substring(0, 300));
    }
  }

  // Check a sample player from players collection
  console.log('\n=== players sample ===');
  const player = await devDb.collection('players').findOne({});
  if (player) {
    console.log('mlbID:', player.mlbID, 'type:', typeof player.mlbID);
    console.log('name:', player.name || player.fullName);
  }

  // Check what players_view actually returns for status
  console.log('\n=== players_view sample (status field) ===');
  const pv = await devDb.collection('players_view').findOne({});
  if (pv) {
    console.log('status:', pv.status);
    console.log('mlbID:', pv.mlbID, 'type:', typeof pv.mlbID);
  }

  await client.close();
})().catch(e => console.error('Error:', e));
