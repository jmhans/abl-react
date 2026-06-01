const { MongoClient } = require('mongodb');
const fs = require('fs'), path = require('path');
for (const l of fs.readFileSync(path.resolve('.env.local'), 'utf8').split(/\r?\n/)) {
  const m = l.match(/^([^#=\r]+)=(.+)/); if (m) process.env[m[1].trim()] = m[2].trim();
}

async function main() {
  const devUri = process.env.MONGODB_URI;
  const prodUri = process.env.MONGODB_URI.replace('abl_dev', 'heroku_wm40bx9r');

  for (const [label, uri, dbName] of [['DEV', devUri, 'abl_dev'], ['PROD', prodUri, 'heroku_wm40bx9r']]) {
    const client = new MongoClient(uri);
    await client.connect();
    const db = client.db(dbName);
    const views = ['AdvancedStandings', 'advanced_standings_view'];
    for (const v of views) {
      const def = await db.listCollections({ name: v }).next();
      console.log(`\n=== [${label}] ${v} (${def?.options?.pipeline?.length} stages) ===`);
      (def?.options?.pipeline || []).forEach((stage, i) => {
        console.log(`  Stage ${i+1}: ${JSON.stringify(stage)}`);
      });
    }
    await client.close();
  }
}
main().catch(console.error);
