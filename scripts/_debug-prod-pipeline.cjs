const { MongoClient } = require('mongodb');
const fs = require('fs'), path = require('path');
for (const l of fs.readFileSync(path.resolve('.env.local'), 'utf8').split(/\r?\n/)) {
  const m = l.match(/^([^#=\r]+)=(.+)/); if (m) process.env[m[1].trim()] = m[2].trim();
}
const prodUri = (process.env.MONGODB_URI_DIRECT || process.env.MONGODB_URI).replace('abl_dev', 'heroku_wm40bx9r');

(async () => {
  const c = new MongoClient(prodUri); await c.connect();
  const db = c.db('heroku_wm40bx9r');

  // Full prod standings_view pipeline
  const svInfo = await db.listCollections({ name: 'standings_view' }).next();
  const pl = (svInfo && svInfo.options && svInfo.options.pipeline) || [];
  console.log(`PROD standings_view: ${pl.length} stages, viewOn: ${svInfo.options.viewOn}`);
  pl.forEach((s, i) => console.log(`  stage ${i}: ${JSON.stringify(s).slice(0, 300)}`));

  // Compare with dev pipeline
  const devC = new MongoClient(process.env.MONGODB_URI_DIRECT || process.env.MONGODB_URI);
  await devC.connect();
  const devDb = devC.db('abl_dev');
  const devSvInfo = await devDb.listCollections({ name: 'standings_view' }).next();
  const devPl = (devSvInfo && devSvInfo.options && devSvInfo.options.pipeline) || [];
  console.log(`\nDEV standings_view: ${devPl.length} stages`);
  devPl.forEach((s, i) => console.log(`  stage ${i}: ${JSON.stringify(s).slice(0, 300)}`));

  await c.close(); await devC.close();
})().catch(e => { console.error(e.message); process.exit(1); });
