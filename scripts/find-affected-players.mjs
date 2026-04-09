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
const db = client.db(process.env.MONGODB_DB || 'abl_dev');

// Get all 2026 position_log entries that have 1B or higher count than DH
// This suggests they might have spring training data vs actual games
console.log('\n=== Players with 1B as maxPosition in 2026 ===');
const with1B = await db.collection('position_log').find({
  season: 2026,
  maxPosition: '1B'
}).toArray();
console.log(`Found ${with1B.length} players with 1B as maxPosition`);
console.log(with1B.map(p => ({
  mlbId: p.mlbId,
  maxPos: p.maxPosition,
  posLog: p.positionsLog
})));

// Get players with unusual position counts (very high for spring training)
console.log('\n\n=== Players with 1B appearances but inconsistent with DH/OF ===');
const oddPosLog = await db.collection('position_log').find({
  season: 2026,
  'positionsLog.pos': '1B',
  $expr: {
    $gt: [
      { $arrayElemAt: [
        { $filter: { input: '$positionsLog', as: 'item', cond: { $eq: ['$$item.pos', '1B'] } } },
        0
      ] }?.ct,
      5 // more than 5 games at a position in early season is unusual
    ]
  }
}).toArray();
console.log(`Found ${oddPosLog.length} players with oddly high 1B counts`);
if (oddPosLog.length > 0) {
  oddPosLog.slice(0, 10).forEach(p => {
    console.log(`  ${p.mlbId}: 1B=${p.positionsLog.find(x => x.pos === '1B')?.ct}, DH=${p.positionsLog.find(x => x.pos === 'DH')?.ct}, OF=${p.positionsLog.find(x => x.pos === 'OF')?.ct}`);
  });
}

// Get count by position to see distribution
console.log('\n=== Position distribution for 2026 ===');
const posDistribution = await db.collection('position_log').aggregate([
  { $match: { season: 2026 } },
  { $group: {
    _id: '$maxPosition',
    count: { $sum: 1 }
  }},
  { $sort: { count: -1 } }
]).toArray();
console.log(JSON.stringify(posDistribution, null, 2));

await client.close();
