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

async function resolveLeagueContext(leagueSlug, seasonSlug = 'active') {
  const league = await db.collection('leagues').findOne({ slug: leagueSlug });
  if (!league) throw new Error(`League not found: ${leagueSlug}`);

  const seasonFilter = { leagueId: league._id };
  if (seasonSlug === 'active') {
    seasonFilter.isActive = true;
  } else {
    seasonFilter.year = Number(seasonSlug);
  }

  const season = await db.collection('seasons').findOne(seasonFilter, { sort: { year: -1 } });
  if (!season) throw new Error(`Season not found: ${seasonSlug} in ${leagueSlug}`);

  return { league, season };
}

async function main() {
  try {
    console.log(`\n🔍 TESTING TEAMS API LOGIC\n`);

    // Simulate API call: GET /api/teams?league=abl&season=2026
    const leagueSlug = 'abl';
    const seasonSlug = '2026';

    console.log(`Simulating: GET /api/teams?league=${leagueSlug}&season=${seasonSlug}\n`);

    const ctx = await resolveLeagueContext(leagueSlug, seasonSlug);
    console.log(`✓ League resolved: ${ctx.league.slug} (${ctx.league.name})`);
    console.log(`✓ Season resolved: ${ctx.season.year} (${ctx.season.slug})`);
    console.log(`✓ Season has ${ctx.season.teamIds?.length ?? 0} teamIds\n`);

    if (!ctx.season.teamIds || ctx.season.teamIds.length === 0) {
      console.log(`⚠️  WARNING: season.teamIds is empty or undefined!`);
      return;
    }

    // Convert to ObjectId if needed
    const teamIds = ctx.season.teamIds.map(id =>
      id instanceof ObjectId ? id : new ObjectId(id)
    );

    console.log(`Looking up teams with IDs:\n  ${teamIds.map(id => id.toString()).join('\n  ')}\n`);

    const teams = await db.collection('ablteams')
      .find({ _id: { $in: teamIds } })
      .toArray();

    console.log(`✓ Found ${teams.length} teams:\n`);
    teams.forEach(t => {
      console.log(`  - ${t.location || ''} ${t.nickname} (${t._id})`);
    });

  } catch (err) {
    console.error('❌ Error:', err.message);
    process.exit(1);
  } finally {
    await client.close();
  }
}

main();
