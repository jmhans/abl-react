import { MongoClient } from 'mongodb';
const client = new MongoClient('mongodb+srv://heroku_wm40bx9r:nt73jqanr2hd7uosqljsvd9mbv@cluster-wm40bx9r.5twxx.mongodb.net/abl_dev');
client.connect().then(async () => {
  const db = client.db();
  const now = new Date();
  const dayStart = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate(), 0, 0, 0, 0));
  const dayEnd = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate(), 23, 59, 59, 999));
  console.log('Today UTC range:', dayStart.toISOString(), '->', dayEnd.toISOString());
  const todayGames = await db.collection('games').find({ gameDate: { $gte: dayStart, $lte: dayEnd } }).toArray();
  console.log('ABL games with gameDate = today:', todayGames.length);
  const sample = await db.collection('games').aggregate([
    { $group: { _id: null, minDate: { $min: '$gameDate' }, maxDate: { $max: '$gameDate' }, total: { $sum: 1 } } }
  ]).toArray();
  console.log('All ABL games range:', JSON.stringify(sample, null, 2));
  // Show distinct game dates near April 2026
  const nearNow = await db.collection('games').find({
    gameDate: { $gte: new Date('2026-04-01'), $lte: new Date('2026-04-30') }
  }).project({ gameDate: 1 }).toArray();
  const dates = [...new Set(nearNow.map(g => g.gameDate?.toISOString?.() || g.gameDate))];
  console.log('April 2026 game dates:', dates);
  await client.close();
});
