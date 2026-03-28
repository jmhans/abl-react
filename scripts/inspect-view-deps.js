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

  const viewNames = ['advanced_standings_view', 'AdvancedStandings', 'Standings', 'StandingsHelper', 'standings_view'];
  for (const name of viewNames) {
    const views = await db.listCollections({ name }).toArray();
    const v = views[0];
    if (!v) { console.log(`${name}: NOT FOUND`); continue; }
    console.log(`\n${name}:`);
    console.log('  viewOn:', v.options?.viewOn);
    console.log('  stages:', v.options?.pipeline?.length);
    // Show lookup stages
    v.options?.pipeline?.forEach((s, i) => {
      if (s.$lookup) console.log(`  stage[${i}] $lookup from: "${s.$lookup.from}"`);
      if (s.$unwind) {
        const path = s.$unwind?.path || s.$unwind;
        const pne = s.$unwind?.preserveNullAndEmptyArrays;
        console.log(`  stage[${i}] $unwind ${path} preserveNull=${pne}`);
      }
    });

    // Count actual results
    try {
      const count = await db.collection(name).countDocuments();
      console.log('  current count:', count);
    } catch (e) {
      console.log('  count ERROR:', e.message);
    }
  }

  await client.close();
})().catch(e => console.error('Error:', e));
