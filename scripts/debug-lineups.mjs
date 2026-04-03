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

// How many players have ablstatus.onRoster = true?
const rostered = await db.collection('players').countDocuments({ 'ablstatus.onRoster': true });
console.log('Players with onRoster=true:', rostered);

// Sample rostered players
const sample = await db.collection('players').find({ 'ablstatus.onRoster': true })
  .limit(3).project({ name: 1, 'ablstatus.ablTeam': 1, 'ablstatus.acqType': 1 }).toArray();
console.log('Sample rostered players:', JSON.stringify(sample, null, 2));

// ABL season teamIds
const ablLeague = await db.collection('leagues').findOne({ slug: 'abl' });
const ablSeason = await db.collection('seasons').findOne({ leagueId: ablLeague._id, isActive: true });
console.log('\nABL season teamIds:', (ablSeason?.teamIds ?? []).map(String));

// Do ablstatus.ablTeam values match season teamIds?
const teamIdStrs = new Set((ablSeason?.teamIds ?? []).map(String));
const ablTeamValues = await db.collection('players').distinct('ablstatus.ablTeam', { 'ablstatus.onRoster': true });
console.log('\nDistinct ablTeam values on rostered players:', ablTeamValues.map(String));
const matches = ablTeamValues.filter((t: any) => teamIdStrs.has(String(t)));
console.log('Overlap with ABL season teamIds:', matches.map(String));

await client.close();
