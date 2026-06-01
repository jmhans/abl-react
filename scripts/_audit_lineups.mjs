import { readFileSync } from 'fs';
import { MongoClient } from 'mongodb';

for (const line of readFileSync('.env.local', 'utf8').split(/\r?\n/)) {
  const m = line.match(/^([^#=\r]+)=(.*\S*)/);
  if (m) process.env[m[1].trim()] = m[2].trim();
}

const client = new MongoClient(process.env.MONGODB_URI);
await client.connect();
const db = client.db('abl_dev');

const all = await db.collection('lineups').find({}).toArray();
console.log(`Total lineup docs: ${all.length}\n`);

for (const doc of all) {
  const ed = doc.effectiveDate;
  console.log({
    _id: doc._id.toString(),
    ablTeam: doc.ablTeam?.toString(),
    effectiveDate: ed,
    type: typeof ed,
    isDate: ed instanceof Date,
    rosterLen: doc.roster?.length ?? 0,
  });
}

// Also show raw BSON type via a simple check
const sample = await db.collection('lineups').findOne({});
if (sample) {
  console.log('\nRaw sample doc keys:', Object.keys(sample));
  console.log('effectiveDate value:', sample.effectiveDate, '| constructor:', sample.effectiveDate?.constructor?.name);
}

await client.close();
