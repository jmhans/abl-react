const { MongoClient } = require('mongodb');
const fs = require('fs'), path = require('path');
for (const l of fs.readFileSync(path.resolve('.env.local'), 'utf8').split(/\r?\n/)) {
  const m = l.match(/^([^#=\r]+)=(.+)/); if (m) process.env[m[1].trim()] = m[2].trim();
}
const uri = process.env.MONGODB_URI_DIRECT || process.env.MONGODB_URI;
(async () => {
  const c = new MongoClient(uri); await c.connect();
  const db = c.db('abl_dev');

  // Get a final 2026 game and dump the full scores[].final object
  const game = await db.collection('games').findOne({ 'result.isFinal': true });
  if (!game) { console.log('No final game found'); await c.close(); return; }

  console.log('=== result.scores[0].final ===');
  console.log(JSON.stringify(game.result.scores[0].final, null, 2));
  console.log('\n=== result.scores[1].final ===');
  console.log(JSON.stringify(game.result.scores[1].final, null, 2));

  // Also check what stage 11 of standings_view sums — compare field names
  const svInfo = await db.listCollections({ name: 'standings_view' }).next();
  const pl = svInfo.options.pipeline;
  console.log('\n=== stage 11 (stat accumulation) ===');
  console.log(JSON.stringify(pl[11], null, 2));

  await c.close();
})().catch(e => { console.error(e.message); process.exit(1); });
