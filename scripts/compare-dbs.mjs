import { MongoClient } from 'mongodb';
import { readFileSync } from 'fs';
import { resolve, dirname } from 'path';
import { fileURLToPath } from 'url';

const __dirname = dirname(fileURLToPath(import.meta.url));
for (const line of readFileSync(resolve(__dirname, '..', '.env.local'), 'utf8').split(/\r?\n/)) {
  const m = line.match(/^([^#=\r]+)=(.*\S*)/);
  if (m) process.env[m[1].trim()] = m[2].trim();
}

const client = new MongoClient(process.env.MONGODB_URI);
await client.connect();

// Compare abl_dev vs heroku_wm40bx9r
const devDb = client.db('abl_dev');
const prodDb = client.db('heroku_wm40bx9r');

console.log('\n📊 Database Schema Comparison (abl_dev vs heroku_wm40bx9r):\n');

// Get collections in each
const devColls = await devDb.listCollections().toArray();
const prodColls = await prodDb.listCollections().toArray();

const devCollNames = new Set(devColls.map(c => c.name));
const prodCollNames = new Set(prodColls.map(c => c.name));

console.log('Collections only in abl_dev:');
[...devCollNames].filter(x => !prodCollNames.has(x)).forEach(c => console.log('  -', c));

console.log('\nCollections only in heroku_wm40bx9r (prod):');
[...prodCollNames].filter(x => !devCollNames.has(x)).forEach(c => console.log('  -', c));

console.log('\n--- Comparing key collections ---\n');

// Compare games collection
const devGames = await devDb.collection('games').countDocuments({});
const prodGames = await prodDb.collection('games').countDocuments({});
console.log('games:');
console.log('  abl_dev:', devGames);
console.log('  prod:', prodGames);

// Compare statlines collection
const devStatlines = await devDb.collection('statlines').countDocuments({});
const prodStatlines = await prodDb.collection('statlines').countDocuments({});
console.log('\nstatlines:');
console.log('  abl_dev:', devStatlines);
console.log('  prod:', prodStatlines);

// Check statline format (sample doc)
const devSample = await devDb.collection('statlines').findOne({});
const prodSample = await prodDb.collection('statlines').findOne({});
console.log('\nstatlines format (checking structure):');
console.log('  abl_dev format:', Object.keys(devSample || {}).join(', '));
console.log('  prod format:', Object.keys(prodSample || {}).join(', '));

// Compare lineups collection
const devLineups = await devDb.collection('lineups').countDocuments({});
const prodLineups = await prodDb.collection('lineups').countDocuments({});
console.log('\nlineups:');
console.log('  abl_dev:', devLineups);
console.log('  prod:', prodLineups);

// Compare players collection
const devPlayers = await devDb.collection('players').countDocuments({});
const prodPlayers = await prodDb.collection('players').countDocuments({});
console.log('\nplayers:');
console.log('  abl_dev:', devPlayers);
console.log('  prod:', prodPlayers);

await client.close();
