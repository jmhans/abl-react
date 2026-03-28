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

  // Show the patched pipeline for StandingsHelper
  const views = await db.listCollections({ name: 'StandingsHelper' }).toArray();
  const v = views[0];
  console.log('StandingsHelper viewOn:', v.options.viewOn);
  console.log('Pipeline stages 0-5:');
  v.options.pipeline.slice(0, 6).forEach((s, i) => {
    console.log(`  [${i}]`, JSON.stringify(s).slice(0, 300));
  });

  // Try running the first 4 stages manually on the games collection 
  const testPipeline = v.options.pipeline.slice(0, 4);
  console.log('\nRunning first 4 stages:');
  const result = await db.collection('games').aggregate([...testPipeline, { $count: 'count' }]).toArray();
  console.log('Result:', result[0] ?? 'EMPTY');

  // Try with just stages 0 (match) and the count
  console.log('\nJust stage 0 ($match gameType R):');
  const r0 = await db.collection('games').aggregate([v.options.pipeline[0], { $count: 'count' }]).toArray();
  console.log('Result:', r0[0]);

  // Try stages 0-1
  console.log('\nStages 0-1:');
  const r1 = await db.collection('games').aggregate([...v.options.pipeline.slice(0, 2), { $count: 'count' }]).toArray();
  console.log('Result:', r1[0] ?? 'EMPTY');

  // Try stages 0-2
  console.log('\nStages 0-2:');
  const r2 = await db.collection('games').aggregate([...v.options.pipeline.slice(0, 3), { $count: 'count' }]).toArray();
  console.log('Result:', r2[0] ?? 'EMPTY');

  // Stage 2 isolated
  console.log('\nStage 2 contents:', JSON.stringify(v.options.pipeline[2]));

  await client.close();
})().catch(e => console.error('Error:', e));
