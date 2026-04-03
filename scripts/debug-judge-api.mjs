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

// Simulate what /api/players does
const CURRENT_SEASON = 2026;
const projSystem = 'Steamer'; // change to whatever you're using on the draft page

const cacheCount = await db.collection('players_cache').estimatedDocumentCount();
const sourceCollection = cacheCount > 0 ? 'players_cache' : 'players_view';
console.log(`Source: ${sourceCollection} (${cacheCount} docs)`);

const [players, projRows] = await Promise.all([
  db.collection(sourceCollection).find({
    name: /aaron judge/i,
  }).toArray(),
  db.collection('projections').find(
    { season: CURRENT_SEASON, projSystem },
    { projection: { mlbId: 1, ablProjected: 1, projSystem: 1, team: 1 } }
  ).toArray(),
]);

console.log('\nplayers_cache entry for Judge:');
console.log(JSON.stringify({ name: players[0]?.name, mlbID: players[0]?.mlbID, team: players[0]?.team, status: players[0]?.status }, null, 2));

const judgeProj = projRows.find(p => p.mlbId === players[0]?.mlbID);
console.log('\nProjection entry for Judge (if any):');
console.log(JSON.stringify(judgeProj ?? 'none', null, 2));

// Check if projection has a team field that could interfere
console.log('\nSample projection doc fields:', Object.keys(projRows[0] ?? {}));

await client.close();
