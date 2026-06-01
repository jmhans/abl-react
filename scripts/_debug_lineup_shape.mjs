import { MongoClient, ObjectId } from 'mongodb';
const client = new MongoClient('mongodb+srv://heroku_wm40bx9r:nt73jqanr2hd7uosqljsvd9mbv@cluster-wm40bx9r.5twxx.mongodb.net/abl_dev');
await client.connect();
const db = client.db();

// Simulate what ensureRostersLockedForGames will do for today
const officialDate = '2026-04-11';
const dayStart = new Date('2026-04-11T00:00:00.000Z');
const dayEnd = new Date('2026-04-11T23:59:59.999Z');

const games = await db.collection('games').find({ gameDate: { $gte: dayStart, $lte: dayEnd } }).toArray();
console.log('Games today:', games.length);

const allTeamIds = new Set();
for (const g of games) {
  if (g.homeTeam) allTeamIds.add(g.homeTeam.toString());
  if (g.awayTeam) allTeamIds.add(g.awayTeam.toString());
}
console.log('Unique teams:', allTeamIds.size);

const teamObjectIds = Array.from(allTeamIds).map(id => new ObjectId(id));
const lineupDocs = await db.collection('lineups').aggregate([
  { $match: { ablTeam: { $in: teamObjectIds }, effectiveDate: { $lte: officialDate } } },
  { $sort: { ablTeam: 1, effectiveDate: -1 } },
  { $group: { _id: '$ablTeam', roster: { $first: '$roster' }, effectiveDate: { $first: '$effectiveDate' } } },
]).toArray();

console.log('Lineup docs found:', lineupDocs.length);
for (const doc of lineupDocs) {
  console.log(`  team ${doc._id}: ${doc.roster?.length ?? 0} players (effectiveDate: ${doc.effectiveDate})`);
}
await client.close();
