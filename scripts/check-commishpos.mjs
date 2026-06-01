import { MongoClient } from 'mongodb';
import { readFileSync } from 'fs';

for (const line of readFileSync('.env.local', 'utf8').split(/\r?\n/)) {
  const m = line.match(/^([^#=\r]+)=(.*\S*)/);
  if (m) process.env[m[1].trim()] = m[2].trim();
}

const prodUri = process.env.MONGODB_URI.replace('/abl_dev', '/heroku_wm40bx9r');
const client = new MongoClient(prodUri);
await client.connect();
const db = client.db('heroku_wm40bx9r');

console.log('=== CHECKING positions COLLECTION (CommishPos) ===\n');

// Check if positions has CommishPos set for test player
const testPlayers = ['656976', '593871', '696144']; // Pavin Smith, Jorge Polanco, sample

for (const mlbId of testPlayers) {
  const posDoc = await db.collection('positions').findOne({ mlbID: mlbId });
  const posLogDoc = await db.collection('position_log').findOne({ mlbId, season: 2026 });
  
  console.log(`${mlbId}:`);
  console.log(`  positions.CommishPos: ${posDoc?.CommishPos || 'NOT SET'}`);
  console.log(`  position_log.maxPosition: ${posLogDoc?.maxPosition || 'NOT SET'}`);
}

// Check how many positions docs have CommishPos
const withCommishPos = await db.collection('positions').countDocuments({ CommishPos: { $exists: true } });
const totalPositions = await db.collection('positions').countDocuments();

console.log(`\nTotal positions docs: ${totalPositions}`);
console.log(`With CommishPos: ${withCommishPos}`);

await client.close();
