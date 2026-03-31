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

const teams = await db.collection('ablteams').find({}).toArray();
console.log(`Total teams: ${teams.length}`);
console.log('Field keys present across all teams:',
  [...new Set(teams.flatMap(t => Object.keys(t)))].join(', '));
console.log('\nSample docs (first 3):');
teams.slice(0, 3).forEach(t => console.log(JSON.stringify(t, null, 2)));
console.log('\nAll teams (id, nickname, location, owner fields):');
teams.forEach(t => console.log({
  _id: t._id,
  nickname: t.nickname,
  location: t.location,
  tm: t.tm,
  teamName: t.teamName,
  owner: t.owner,
  owners: t.owners,
}));

await client.close();
