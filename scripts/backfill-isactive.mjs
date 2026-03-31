// Backfill isActive on seasons where it is missing: derive from status === 'active'
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
const db = client.db('abl_dev');

// Set isActive true where status='active' and isActive is not yet set
const toActivate = await db.collection('seasons')
  .updateMany(
    { status: 'active', isActive: { $exists: false } },
    { $set: { isActive: true } }
  );
console.log('Set isActive=true:', toActivate.modifiedCount, 'docs');

// Set isActive false where status!='active' and isActive is not yet set
const toDeactivate = await db.collection('seasons')
  .updateMany(
    { status: { $ne: 'active' }, isActive: { $exists: false } },
    { $set: { isActive: false } }
  );
console.log('Set isActive=false:', toDeactivate.modifiedCount, 'docs');

// Confirm final state
const all = await db.collection('seasons').find({}).toArray();
all.forEach(s => console.log({ year: s.year, status: s.status, isActive: s.isActive }));

await client.close();
