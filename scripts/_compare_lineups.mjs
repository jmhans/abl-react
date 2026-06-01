import { readFileSync } from 'fs';
import { MongoClient } from 'mongodb';

for (const line of readFileSync('.env.local', 'utf8').split(/\r?\n/)) {
  const m = line.match(/^([^#=\r]+)=(.*\S*)/);
  if (m) process.env[m[1].trim()] = m[2].trim();
}

const devUri = process.env.MONGODB_URI;
const prodUri = process.env.MONGODB_URI.replace('/abl_dev', '/heroku_wm40bx9r');

const devClient = new MongoClient(devUri);
const prodClient = new MongoClient(prodUri);
await devClient.connect();
await prodClient.connect();

const devDb = devClient.db('abl_dev');
const prodDb = prodClient.db('heroku_wm40bx9r');

const devDocs = await devDb.collection('lineups').find({}).toArray();
const prodDocs = await prodDb.collection('lineups').find({}).toArray();

console.log(`=== DEV (${devDocs.length} docs) ===`);
for (const d of devDocs) {
  console.log(`  ${d._id}  team:${d.ablTeam}  effectiveDate:${d.effectiveDate}  rosterLen:${d.roster?.length}`);
}

console.log(`\n=== PROD (${prodDocs.length} docs) ===`);
for (const d of prodDocs) {
  console.log(`  ${d._id}  team:${d.ablTeam}  effectiveDate:${d.effectiveDate}  rosterLen:${d.roster?.length}`);
}

// Show IDs that differ between dev and prod
const devIds = new Set(devDocs.map(d => d._id.toString()));
const prodIds = new Set(prodDocs.map(d => d._id.toString()));
const onlyInProd = prodDocs.filter(d => !devIds.has(d._id.toString()));
const onlyInDev  = devDocs.filter(d => !prodIds.has(d._id.toString()));
console.log(`\nOnly in prod: ${onlyInProd.length}`);
console.log(`Only in dev:  ${onlyInDev.length}`);

await devClient.close();
await prodClient.close();
