import { readFileSync } from 'fs';
import { MongoClient } from 'mongodb';

for (const line of readFileSync('.env.local', 'utf8').split(/\r?\n/)) {
  const m = line.match(/^([^#=\r]+)=(.*\S*)/);
  if (m) process.env[m[1].trim()] = m[2].trim();
}

const prodUri = process.env.MONGODB_URI.replace('/abl_dev', '/heroku_wm40bx9r');
const client = new MongoClient(prodUri);
await client.connect();
const db = client.db('heroku_wm40bx9r');

const docs = await db.collection('lineups').find({}).sort({ updatedAt: -1 }).toArray();
const teams = await db.collection('ablteams').find({}).toArray();
const teamMap = new Map(teams.map(t => [t._id.toString(), t.name || t.teamName || t._id]));

console.log('=== PROD lineups — when each was last written ===\n');
for (const d of docs) {
  const teamName = teamMap.get(d.ablTeam?.toString()) || d.ablTeam;
  console.log(`${d.updatedAt?.toISOString() ?? 'no updatedAt'}  ${String(teamName).padEnd(30)}  effectiveDate:${d.effectiveDate}  players:${d.roster?.length}`);
}

await client.close();
