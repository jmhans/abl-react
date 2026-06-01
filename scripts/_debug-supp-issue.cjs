/**
 * Debug script: check why supplements are still being added for pending games.
 * Game: 69d99921cc0a129a1342b7a9
 */
const { MongoClient, ObjectId } = require('mongodb');
const fs = require('fs'), path = require('path');
for (const l of fs.readFileSync(path.resolve('.env.local'), 'utf8').split(/\r?\n/)) {
  const m = l.match(/^([^#=\r]+)=(.+)/); if (m) process.env[m[1].trim()] = m[2].trim();
}

const GAME_ID = '69d99921cc0a129a1342b7a9';

function deriveAblDate(gameDate) {
  const dt = new Date(gameDate);
  const shifted = new Date(dt.getTime() - 8 * 60 * 60 * 1000);
  return shifted.toISOString().substring(0, 10);
}

async function main() {
  const client = new MongoClient(process.env.MONGODB_URI);
  await client.connect();
  const db = client.db();

  // 1. Fetch the game
  const game = await db.collection('games').findOne({ _id: new ObjectId(GAME_ID) });
  if (!game) { console.log('Game not found!'); await client.close(); return; }

  const gameDate = new Date(game.gameDate);
  const ablDate = deriveAblDate(gameDate);
  const calendarDate = gameDate.toISOString().substring(0, 10);

  console.log('\n=== GAME ===');
  console.log('gameDate (raw):', game.gameDate);
  console.log('gameDate (ISO):', gameDate.toISOString());
  console.log('deriveAblDate → ablDate:', ablDate);
  console.log('calendarDate (UTC):', calendarDate);

  // 2. Check mlbgameschemas for both dates
  const mlbDocsAblDate = await db.collection('mlbgameschemas')
    .find({ officialDate: ablDate, gameType: 'R' })
    .project({ 'teams.away.team.abbreviation': 1, 'teams.home.team.abbreviation': 1, 'status.abstractGameState': 1, officialDate: 1 })
    .toArray();

  const mlbDocsCalDate = await db.collection('mlbgameschemas')
    .find({ officialDate: calendarDate, gameType: 'R' })
    .project({ 'teams.away.team.abbreviation': 1, 'teams.home.team.abbreviation': 1, 'status.abstractGameState': 1, officialDate: 1 })
    .toArray();

  console.log(`\n=== mlbgameschemas (officialDate=${ablDate} / ablDate) ===`);
  if (mlbDocsAblDate.length === 0) {
    console.log('(none)');
  } else {
    for (const g of mlbDocsAblDate) {
      const away = g.teams?.away?.team?.abbreviation;
      const home = g.teams?.home?.team?.abbreviation;
      const state = g.status?.abstractGameState;
      console.log(`  ${away} @ ${home} → ${state}`);
    }
  }

  console.log(`\n=== mlbgameschemas (officialDate=${calendarDate} / calendarDate) ===`);
  if (mlbDocsCalDate.length === 0) {
    console.log('(none)');
  } else {
    for (const g of mlbDocsCalDate) {
      const away = g.teams?.away?.team?.abbreviation;
      const home = g.teams?.home?.team?.abbreviation;
      const state = g.status?.abstractGameState;
      console.log(`  ${away} @ ${home} → ${state}`);
    }
  }

  // 3. Check Freeman and Muncy in players collection
  console.log('\n=== PLAYER team fields (Freeman, Muncy, Walker, Perez) ===');
  const playerNames = ['Freeman', 'Muncy', 'Walker', 'Perez'];
  for (const name of playerNames) {
    const p = await db.collection('players').findOne({ name: new RegExp(name, 'i') });
    if (p) console.log(`  ${p.name}: team="${p.team}" mlbID=${p.mlbID}`);
    else console.log(`  ${name}: NOT FOUND`);
  }

  // 4. Check statlines for ablDate
  const statlineDoc = await db.collection('statlines').findOne({ _id: ablDate });
  console.log(`\n=== statlines _id="${ablDate}" ===`);
  if (!statlineDoc) {
    console.log('(not found)');
  } else {
    console.log('Found. Total player keys:', Object.keys(statlineDoc.p || {}).length);
    // Find Freeman & co
    const searches = ['668804980', '547989', '572761'];  // Freeman, Muncy, Walker mlbIDs (approximate)
    for (const mlbId of searches) {
      const prefix = mlbId + '_';
      const keys = Object.keys(statlineDoc.p || {}).filter(k => k.startsWith(prefix));
      if (keys.length) {
        console.log(`  mlbId ${mlbId}:`, keys.map(k => JSON.stringify(statlineDoc.p[k])).join(', '));
      }
    }
  }

  // 5. Show the stored result's player lineup for home/away
  const result = game.result;
  if (result?.scores) {
    for (const score of result.scores) {
      const teamId = score.team?.toString();
      console.log(`\n=== Stored result: team ${teamId} (${score.location}) ===`);
      if (score.players) {
        for (const p of score.players) {
          const name = p.player?.name || p.name || '?';
          const pos = p.playedPosition || p.lineupPosition || '?';
          const type = p.ablPlayedType || p.ablstatus || '?';
          const g = p.dailyStats?.g ?? '?';
          const ab = p.dailyStats?.ab ?? '?';
          const state = p.mlbGameState || 'n/a';
          console.log(`    ${name} | pos=${pos} | type=${type} | g=${g} ab=${ab} | gameState=${state}`);
        }
      }
    }
  }

  await client.close();
}

main().catch(console.error);
