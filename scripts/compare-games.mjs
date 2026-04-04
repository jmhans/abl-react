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

const devDb = client.db('abl_dev');
const prodDb = client.db('heroku_wm40bx9r');

console.log('\n📊 Game Structure Comparison (Apr 2025)\n');

// Get a sample game from each
const devGame = await devDb.collection('games').findOne({ gameDate: { $gte: new Date('2025-04-15'), $lt: new Date('2025-04-20') } });
const prodGame = await prodDb.collection('games').findOne({ gameDate: { $gte: new Date('2025-04-15'), $lt: new Date('2025-04-20') } });

if (devGame) {
  console.log('DEV Game:');
  console.log('  homeTeamRoster length:', devGame.homeTeamRoster?.length);
  console.log('  awayTeamRoster length:', devGame.awayTeamRoster?.length);
  console.log('  result.scores exists?', !!devGame.result?.scores);
  if (devGame.result?.scores?.[0]) {
    console.log('  result.scores[0].players exists?', !!devGame.result.scores[0].players, '| Length:', devGame.result.scores[0].players?.length);
  }
  if (devGame.result?.scores?.[1]) {
    console.log('  result.scores[1].players exists?', !!devGame.result.scores[1].players, '| Length:', devGame.result.scores[1].players?.length);
  }
}

if (prodGame) {
  console.log('\nPROD Game:');
  console.log('  homeTeamRoster length:', prodGame.homeTeamRoster?.length);
  console.log('  awayTeamRoster length:', prodGame.awayTeamRoster?.length);
  console.log('  result.scores exists?', !!prodGame.result?.scores);
  if (prodGame.result?.scores?.[0]) {
    console.log('  result.scores[0].players exists?', !!prodGame.result.scores[0].players, '| Length:', prodGame.result.scores[0].players?.length);
  }
  if (prodGame.result?.scores?.[1]) {
    console.log('  result.scores[1].players exists?', !!prodGame.result.scores[1].players, '| Length:', prodGame.result.scores[1].players?.length);
  }
} else {
  console.log('\nPROD: No April 2025 games found!');
}

// Count games in each
const devGameCount = await devDb.collection('games').countDocuments({ gameDate: { $gte: new Date('2025-04-15'), $lt: new Date('2025-09-01') } });
const prodGameCount = await prodDb.collection('games').countDocuments({ gameDate: { $gte: new Date('2025-04-15'), $lt: new Date('2025-09-01') } });

console.log('\n📈 Game Count (Apr-Aug 2025):');
console.log('  Dev:', devGameCount);
console.log('  Prod:', prodGameCount);

// Count games with result.scores.players
const devWithPlayers = await devDb.collection('games').countDocuments({ 'result.scores.players': { $exists: true, $ne: [] } });
const prodWithPlayers = await prodDb.collection('games').countDocuments({ 'result.scores.players': { $exists: true, $ne: [] } });

console.log('\nGames with result.scores.players:');
console.log('  Dev:', devWithPlayers);
console.log('  Prod:', prodWithPlayers);

await client.close();
