const { MongoClient } = require('mongodb');
const fs = require('fs'), path = require('path');
for (const l of fs.readFileSync(path.resolve('.env.local'), 'utf8').split(/\r?\n/)) {
  const m = l.match(/^([^#=\r]+)=(.+)/); if (m) process.env[m[1].trim()] = m[2].trim();
}
const baseUri = process.env.MONGODB_URI_DIRECT || process.env.MONGODB_URI;
const devUri  = baseUri;
const prodUri = baseUri.replace('abl_dev', 'heroku_wm40bx9r');

(async () => {
  const devClient  = new MongoClient(devUri);
  const prodClient = new MongoClient(prodUri);
  await Promise.all([devClient.connect(), prodClient.connect()]);
  const devDb  = devClient.db('abl_dev');
  const prodDb = prodClient.db('heroku_wm40bx9r');

  const devViews  = (await devDb.listCollections({ type: 'view' }).toArray())
    .sort((a, b) => a.name.localeCompare(b.name));
  const prodViews = (await prodDb.listCollections({ type: 'view' }).toArray())
    .sort((a, b) => a.name.localeCompare(b.name));

  const devMap  = new Map(devViews.map(v  => [v.name, v]));
  const prodMap = new Map(prodViews.map(v => [v.name, v]));
  const allNames = [...new Set([...devMap.keys(), ...prodMap.keys()])].sort();

  console.log(`DEV views: ${devViews.length}  |  PROD views: ${prodViews.length}\n`);
  console.log('View'.padEnd(35), 'Stages(dev)', 'Stages(prod)', 'Match');
  console.log('-'.repeat(75));

  let allMatch = true;
  for (const name of allNames) {
    const d = devMap.get(name);
    const p = prodMap.get(name);

    if (!d) {
      console.log(name.padEnd(35), '(missing)  ', String((p.options.pipeline||[]).length).padEnd(12), '❌ only in PROD');
      allMatch = false; continue;
    }
    if (!p) {
      console.log(name.padEnd(35), String((d.options.pipeline||[]).length).padEnd(11), '(missing)  ', '❌ only in DEV');
      allMatch = false; continue;
    }

    const devPl   = JSON.stringify(d.options.pipeline);
    const prodPl  = JSON.stringify(p.options.pipeline);
    const devOn   = d.options.viewOn;
    const prodOn  = p.options.viewOn;
    const match   = devPl === prodPl && devOn === prodOn;

    const dStages = (d.options.pipeline||[]).length;
    const pStages = (p.options.pipeline||[]).length;
    const icon    = match ? '✓' : '❌';

    console.log(name.padEnd(35), String(dStages).padEnd(11), String(pStages).padEnd(12), icon);
    if (!match) {
      allMatch = false;
      if (devOn !== prodOn) console.log(`  viewOn: dev=${devOn}  prod=${prodOn}`);
      if (devPl !== prodPl) {
        // Show which stages differ
        const dp = d.options.pipeline || [];
        const pp = p.options.pipeline || [];
        const maxLen = Math.max(dp.length, pp.length);
        for (let i = 0; i < maxLen; i++) {
          const ds = JSON.stringify(dp[i] || null);
          const ps = JSON.stringify(pp[i] || null);
          if (ds !== ps) console.log(`  stage ${i} differs:\n    dev:  ${ds.slice(0,200)}\n    prod: ${ps.slice(0,200)}`);
        }
      }
    }
  }

  console.log('\n' + (allMatch ? '✅ All views are in sync.' : '❌ Some views differ — see above.'));

  await devClient.close();
  await prodClient.close();
})().catch(e => { console.error(e.message); process.exit(1); });
