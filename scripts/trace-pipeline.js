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

  const views = await db.listCollections({ name: 'StandingsHelper' }).toArray();
  const pipeline = views[0].options.pipeline;
  console.log('Total stages:', pipeline.length);

  for (let i = 1; i <= pipeline.length; i++) {
    try {
      const result = await db.collection('games').aggregate(
        [...pipeline.slice(0, i), { $count: 'count' }],
        { allowDiskUse: true }
      ).toArray();
      const count = result[0]?.count ?? 0;
      const stageName = Object.keys(pipeline[i - 1])[0];
      console.log(`Stage ${i - 1} (${stageName}): ${count} docs`);
      if (count === 0) {
        console.log('  ^^^ This stage dropped to 0!');
        console.log('  Stage content:', JSON.stringify(pipeline[i - 1]).slice(0, 400));
        break;
      }
    } catch (e) {
      console.log(`Stage ${i - 1}: ERROR — ${e.message}`);
      break;
    }
  }

  await client.close();
})().catch(e => console.error('Error:', e));
