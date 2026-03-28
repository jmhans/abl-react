import { MongoClient } from 'mongodb';

async function checkStandingsFields() {
  const uri = process.env.MONGODB_URI;
  if (!uri) {
    throw new Error('MONGODB_URI not set');
  }

  const client = new MongoClient(uri);

  try {
    await client.connect();
    const db = client.db();
    
    console.log('Fetching one standing document...\n');
    const standing = await db.collection('standings_view').findOne({});
    
    if (!standing) {
      console.log('No standings found!');
      return;
    }

    console.log('Available fields in standings_view:');
    console.log(JSON.stringify(standing, null, 2));
    
    console.log('\n\nAdvanced fields check:');
    console.log('- streak:', standing.streak);
    console.log('- l10:', standing.l10);
    console.log('- dougluckw:', standing.dougluckw);
    console.log('- dougluckl:', standing.dougluckl);
    console.log('- dougluckExcessW:', standing.dougluckExcessW);
    console.log('- homeRecord:', standing.homeRecord);
    console.log('- awayRecord:', standing.awayRecord);
    console.log('- xtrasRecord:', standing.xtrasRecord);
    
    console.log('\n\nChecking for advanced_standings_view collection...');
    const advStandings = await db.collection('advanced_standings_view').findOne({});
    console.log('advanced_standings_view sample:', JSON.stringify(advStandings, null, 2));
    
    console.log('\n\nChecking outcomes/games array...');
    console.log('Has outcomes field:', !!standing.outcomes);
    console.log('Has games field:', !!standing.games);
    if (standing.outcomes) {
      console.log('Outcomes array length:', standing.outcomes?.length);
      console.log('First outcome sample:', standing.outcomes?.[0]);
    }
    if (standing.games && !standing.outcomes) {
      console.log('Games array length:', standing.games?.length);
      console.log('First game sample:', standing.games?.[0]);
    }
    
  } finally {
    await client.close();
  }
}

checkStandingsFields().catch(console.error);
