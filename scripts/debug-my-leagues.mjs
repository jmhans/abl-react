import { MongoClient } from 'mongodb';
import * as fs from 'fs';
import * as path from 'path';
import { fileURLToPath } from 'url';
import { ObjectId } from 'mongodb';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

// Load MONGODB_URI from env or .env.local
let mongoUri = process.env.MONGODB_URI;
if (!mongoUri) {
  try {
    const envPath = path.resolve(__dirname, '../.env.local');
    const envLocal = fs.readFileSync(envPath, 'utf-8');
    const match = envLocal.match(/^MONGODB_URI=(.+)$/m);
    if (match) {
      mongoUri = match[1].trim().replace(/^['"]|['"]$/g, '');
    }
  } catch (e) {
    console.error('❌ Could not find MONGODB_URI');
    process.exit(1);
  }
}

const client = new MongoClient(mongoUri);
const db = client.db('abl_dev');

async function main() {
  try {
    console.log(`\n🔍 DEBUGGING /api/auth/my-leagues LOGIC\n`);

    // Get all teams and their owners
    const teams = await db.collection('ablteams').find({}).project({ _id: 1, nickname: 1, owners: 1 }).toArray();
    
    console.log(`Teams in DB (${teams.length}):`);
    teams.forEach(t => {
      const ownerIds = (t.owners ?? []).map(o => o.userId).join(', ');
      console.log(`  - ${t.nickname}: _id=${t._id} (${t._id.constructor.name}), owners=[${ownerIds}]`);
    });

    console.log(`\nPick first team as example:`);
    if (teams.length > 0) {
      const team = teams[0];
      const userId = team.owners?.[0]?.userId;
      
      if (!userId) {
        console.log(`  ⚠️  No owners on this team`);
        return;
      }
      
      console.log(`  Team: ${team.nickname} (${team._id})`);
      console.log(`  Owner userId: ${userId}\n`);

      // Simulate: find teams owned by this user
      const myTeams = await db.collection('ablteams').find({ 'owners.userId': userId }).toArray();
      console.log(`  ✓ Found ${myTeams.length} teams owned by ${userId}:`);
      myTeams.forEach(mt => console.log(`    - ${mt.nickname}`));

      const myTeamIds = myTeams.map(t => t._id);
      const myTeamIdStrings = myTeams.map(t => t._id.toString());
      
      console.log(`\n  myTeamIds (ObjectIds):\n    ${myTeamIds.join(', ')}`);
      console.log(`  myTeamIdStrings:\n    ${myTeamIdStrings.join(', ')}\n`);

      // Now try to find seasons
      console.log(`  Query: { teamIds: { $in: [...myTeamIds, ...myTeamIdStrings] } }`);
      
      const seasons = await db.collection('seasons').find({
        teamIds: { $in: [...myTeamIds, ...myTeamIdStrings] }
      }).toArray();
      
      console.log(`  ✓ Found ${seasons.length} seasons:\n`);
      seasons.forEach(s => {
        console.log(`    - Year ${s.year} (league: ${s.leagueId})`);
        console.log(`      teamIds: [${s.teamIds.join(', ')}]`);
      });
    }

  } catch (err) {
    console.error('❌ Error:', err);
    process.exit(1);
  } finally {
    await client.close();
  }
}

main();
