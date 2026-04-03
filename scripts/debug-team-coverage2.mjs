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
const db = client.db();

// The exact filter /api/players uses
const eligibleFilter = {
  $or: [
    { 'eligible.0': { $exists: true } },
    { 'stats.batting.atBats': { $gt: 0 } },
  ],
};

const total = await db.collection('players_cache').countDocuments(eligibleFilter);
const noTeam = await db.collection('players_cache').countDocuments({
  ...eligibleFilter,
  $or: [
    { 'eligible.0': { $exists: true } },
    { 'stats.batting.atBats': { $gt: 0 } },
  ],
  team: { $in: [null, '', undefined] },
});

// Separate count: eligible filter with no team
const noTeamCount = await db.collection('players_cache').countDocuments({
  $and: [
    eligibleFilter,
    { team: { $in: [null, ''] } },
  ],
});

console.log(`Eligible players: ${total}`);
console.log(`Eligible with no team: ${noTeamCount}`);

// sample of no-team eligible players
const samples = await db.collection('players_cache').find({
  $and: [
    eligibleFilter,
    { team: { $in: [null, ''] } },
  ],
}).limit(10).toArray();
console.log('Samples:', samples.map(p => `${p.name} (status=${p.status}, eligible=${JSON.stringify(p.eligible)})`));

// Also confirm what the actual team value is for a large swath
const teamBuckets = await db.collection('players_cache').aggregate([
  { $match: eligibleFilter },
  { $group: { _id: { hasTeam: { $gt: ['$team', ''] } }, count: { $sum: 1 } } },
]).toArray();
console.log('\nHas team vs no team among eligible:', teamBuckets);

await client.close();
