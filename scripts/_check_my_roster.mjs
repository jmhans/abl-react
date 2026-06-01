import { readFileSync } from 'fs';
import { MongoClient, ObjectId } from 'mongodb';

for (const line of readFileSync('.env.local', 'utf8').split(/\r?\n/)) {
  const m = line.match(/^([^#=\r]+)=(.*\S*)/);
  if (m) process.env[m[1].trim()] = m[2].trim();
}

const teamId = new ObjectId('5ca28dbed79ef30033562385');

async function showRoster(label, uri, dbName) {
  const client = new MongoClient(uri);
  await client.connect();
  const db = client.db(dbName);

  const lineups = await db.collection('lineups')
    .find({ ablTeam: teamId })
    .sort({ effectiveDate: -1 })
    .toArray();

  console.log(`\n=== ${label} — ${lineups.length} lineup doc(s) for this team ===`);
  for (const lineup of lineups) {
    console.log(`\n  Doc _id: ${lineup._id}  effectiveDate: ${lineup.effectiveDate}  roster: ${lineup.roster?.length} players`);
    const playerIds = (lineup.roster || []).map(r => r.player);
    const players = await db.collection('players').find({ _id: { $in: playerIds } }).toArray();
    const playerMap = new Map(players.map(p => [p._id.toString(), p]));
    for (const entry of (lineup.roster || [])) {
      const p = playerMap.get(entry.player.toString());
      console.log(`    [${entry.rosterOrder}] ${p?.name || entry.player}  pos:${entry.lineupPosition}  acq:${entry.acqType}`);
    }
  }

  await client.close();
}

const devUri = process.env.MONGODB_URI;
const prodUri = process.env.MONGODB_URI.replace('/abl_dev', '/heroku_wm40bx9r');

await showRoster('DEV', devUri, 'abl_dev');
await showRoster('PROD', prodUri, 'heroku_wm40bx9r');
