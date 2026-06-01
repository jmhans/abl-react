import { MongoClient } from 'mongodb';
import * as fs from 'fs';
import * as path from 'path';
import { fileURLToPath } from 'url';

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

const prodUri = mongoUri.replace('/abl_dev', '/heroku_wm40bx9r');
const client = new MongoClient(prodUri);
const db = client.db('heroku_wm40bx9r');

async function main() {
  try {
    console.log(`\n🔍 Checking if teams API works in PROD\n`);

    // Test: can we get teams for abl 2026?
    const ctx1 = await resolveLeagueContext('abl', '2026');
    console.log(`✓ ABL 2026: ${ctx1.season.teamIds?.length || 0} teams`);

    const teams1 = await db.collection('ablteams')
      .find({ _id: { $in: ctx1.season.teamIds } })
      .toArray();
    console.log(`✓ Found: ${teams1.length} teams\n`);

    if (teams1.length > 0) {
      console.log(`First team:`);
      const t = teams1[0];
      console.log(`  _id: ${t._id} (type: ${t._id.constructor.name})`);
      console.log(`  nickname: ${t.nickname}`);
    }

  } catch (err) {
    console.error('❌ Error:', err.message);
  } finally {
    await client.close();
  }
}

async function resolveLeagueContext(leagueSlug, seasonSlug) {
  const league = await db.collection('leagues').findOne({ slug: leagueSlug });
  if (!league) throw new Error(`League not found: ${leagueSlug}`);

  const seasonFilter = { leagueId: league._id };
  if (seasonSlug === 'active') {
    seasonFilter.isActive = true;
  } else {
    seasonFilter.year = Number(seasonSlug);
  }

  const season = await db.collection('seasons').findOne(seasonFilter, { sort: { year: -1 } });
  if (!season) throw new Error(`Season not found: ${seasonSlug}`);

  return { league, season };
}

main();
