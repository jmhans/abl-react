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

// Aaron Judge mlbID = 592450
const judge = await db.collection('players').findOne({ name: /aaron judge/i });
console.log('players doc:', JSON.stringify({ _id: judge?._id, mlbID: judge?.mlbID, name: judge?.name, team: judge?.team }, null, 2));

const judgeCache = await db.collection('players_cache').findOne({ name: /aaron judge/i });
console.log('players_cache doc:', JSON.stringify({ mlbID: judgeCache?.mlbID, name: judgeCache?.name, team: judgeCache?.team, status: judgeCache?.status }, null, 2));

// Check mlbrosters — does person.id match as number or string?
const rosterDoc = await db.collection('mlbrosters').findOne({ 'roster.person.id': 592450 });
if (rosterDoc) {
  const entry = rosterDoc.roster.find((r) => r.person?.id === 592450);
  console.log('mlbrosters team:', rosterDoc.teamAbbreviation);
  console.log('roster entry:', JSON.stringify(entry, null, 2));
} else {
  console.log('Judge NOT found in mlbrosters by numeric id=592450');
  // Try string
  const rosterDoc2 = await db.collection('mlbrosters').findOne({ 'roster.person.id': '592450' });
  console.log('by string id:', rosterDoc2 ? rosterDoc2.teamAbbreviation : 'also not found');
}

// Sample a mlbrosters roster entry to see the person.id type
const sample = await db.collection('mlbrosters').findOne({});
if (sample?.roster?.[0]) {
  const p = sample.roster[0].person;
  console.log('\nSample roster person:', JSON.stringify(p, null, 2));
  console.log('typeof person.id:', typeof p?.id);
}

await client.close();
