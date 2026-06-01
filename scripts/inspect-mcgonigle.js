// Show the players_view pipeline and a specific player's position_log + positions data
const { MongoClient } = require('mongodb');
const fs = require('fs');
for (const l of fs.readFileSync('.env.local', 'utf8').split(/\r?\n/)) {
  const m = l.match(/^([^#=\r]+)=(.+)/);
  if (m) process.env[m[1].trim()] = m[2].trim();
}
const client = new MongoClient(process.env.MONGODB_URI);
client.connect().then(async () => {
  const db = client.db();

  // 1. Get the players_view pipeline
  const collections = await db.listCollections({ name: 'players_view' }).toArray();
  if (collections[0]) {
    console.log('=== players_view pipeline ===');
    console.log(JSON.stringify(collections[0].options?.pipeline, null, 2));
  } else {
    console.log('players_view not found in listCollections');
  }

  // 2. Find Kevin McGonigle
  const player = await db.collection('players').findOne({ name: { $regex: /mcgonigle/i } });
  if (!player) { console.log('\nMcGonigle not found in players'); await client.close(); return; }
  console.log('\n=== McGonigle in players ===');
  console.log('_id:', player._id, 'mlbID:', player.mlbID, 'name:', player.name);
  console.log('eligible:', player.eligible);

  const mlbId = String(player.mlbID || player._id);

  // 3. position_log entry
  const posLog = await db.collection('position_log').findOne({ mlbId });
  console.log('\n=== position_log ===');
  console.log(JSON.stringify(posLog, null, 2));

  // 4. positions entry (CommishPos)
  const posDoc = await db.collection('positions').findOne({ mlbId });
  console.log('\n=== positions (CommishPos) ===');
  console.log(JSON.stringify(posDoc, null, 2));

  // 5. players_cache / players_view entry
  const cached = await db.collection('players_cache').findOne({ _id: player._id });
  console.log('\n=== players_cache ===');
  console.log('eligible:', cached?.eligible, 'position:', cached?.position);

  const viewed = await db.collection('players_view').findOne({ _id: player._id });
  console.log('\n=== players_view ===');
  console.log('eligible:', viewed?.eligible, 'position:', viewed?.position);

  await client.close();
}).catch(console.error);
