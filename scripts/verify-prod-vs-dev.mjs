import { MongoClient } from 'mongodb';
import { readFileSync } from 'fs';

for (const line of readFileSync('.env.local', 'utf8').split(/\r?\n/)) {
  const m = line.match(/^([^#=\r]+)=(.*\S*)/);
  if (m) process.env[m[1].trim()] = m[2].trim();
}

const prodUri = process.env.MONGODB_URI.replace('/abl_dev', '/heroku_wm40bx9r');
const devUri = process.env.MONGODB_URI;

const prodClient = new MongoClient(prodUri);
const devClient = new MongoClient(devUri);

await prodClient.connect();
await devClient.connect();

const prodDb = prodClient.db('heroku_wm40bx9r');
const devDb = devClient.db('abl_dev');

console.log('=== VERIFYING POSITION_LOG 2026 CHANGES ===\n');

// Check a known changed player in both DBs
const testMlbId = '656976'; // Pavin Smith (1B → DH)

const prodEntry = await prodDb.collection('position_log').findOne({ mlbId: testMlbId, season: 2026 });
const devEntry = await devDb.collection('position_log').findOne({ mlbId: testMlbId, season: 2026 });

console.log(`PROD (${prodUri.split('/').pop()}):`);
console.log(`  maxPosition: ${prodEntry?.maxPosition}`);
console.log(`  positionsLog: ${JSON.stringify(prodEntry?.positionsLog)}`);

console.log(`\nDEV (${devUri.split('/').pop()}):`);
console.log(`  maxPosition: ${devEntry?.maxPosition}`);
console.log(`  positionsLog: ${JSON.stringify(devEntry?.positionsLog)}`);

// Check total 2026 entries in each
const prodCount = await prodDb.collection('position_log').countDocuments({ season: 2026 });
const devCount = await devDb.collection('position_log').countDocuments({ season: 2026 });

console.log(`\nTotal 2026 entries:`);
console.log(`  PROD: ${prodCount}`);
console.log(`  DEV: ${devCount}`);

await prodClient.close();
await devClient.close();
