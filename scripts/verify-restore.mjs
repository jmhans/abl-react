import { MongoClient } from 'mongodb';
import * as fs from 'fs';
import * as path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const env = fs.readFileSync(path.join(__dirname, '../.env.local'), 'utf-8');
const match = env.match(/^MONGODB_URI=(.+)$/m);
const uri = match[1].trim();
const client = new MongoClient(uri);
const db = client.db('abl_dev');

const season = await db.collection('seasons').findOne({});
const teamId0 = season?.teamIds?.[0];
console.log('teamIds[0] constructor:', teamId0?.constructor?.name);
console.log('teamIds[0] value:', teamId0);

const team = await db.collection('ablteams').findOne({});
console.log('ablteams _id constructor:', team?._id?.constructor?.name);

const teams = await db.collection('ablteams').find({ _id: { $in: season.teamIds } }).toArray();
console.log('Teams found by teamIds $in query:', teams.length, '(expect > 0)');

await client.close();
