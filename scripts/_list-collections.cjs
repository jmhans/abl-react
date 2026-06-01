const { MongoClient } = require('mongodb');
const fs = require('fs'), path = require('path');
for (const l of fs.readFileSync(path.resolve('.env.local'), 'utf8').split(/\r?\n/)) {
  const m = l.match(/^([^#=\r]+)=(.+)/); if (m) process.env[m[1].trim()] = m[2].trim();
}

async function main() {
  for (const [label, dbName] of [['DEV', 'abl_dev'], ['PROD', 'heroku_wm40bx9r']]) {
    const uri = process.env.MONGODB_URI.replace('abl_dev', dbName);
    const client = new MongoClient(uri);
    await client.connect();
    const db = client.db(dbName);
    const all = await db.listCollections().toArray();
    const collections = all.filter(c => c.type === 'collection').map(c => c.name).sort();
    const views = all.filter(c => c.type === 'view').map(c => c.name).sort();
    console.log(`\n[${label}] Collections (${collections.length}):`);
    collections.forEach(n => console.log('  ' + n));
    console.log(`\n[${label}] Views (${views.length}):`);
    views.forEach(n => console.log('  ' + n));
    await client.close();
  }
}
main().catch(console.error);
