import { MongoClient } from 'mongodb';
import * as fs from 'fs';
import * as path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

let mongoUri = process.env.MONGODB_URI;
if (!mongoUri) {
  try {
    const envPath = path.resolve(__dirname, '../.env.local');
    const envLocal = fs.readFileSync(envPath, 'utf-8');
    const match = envLocal.match(/^MONGODB_URI=(.+)$/m);
    if (match) mongoUri = match[1].trim().replace(/^['"]|['"]$/g, '');
  } catch (e) {
    process.exit(1);
  }
}

const client = new MongoClient(mongoUri);
const db = client.db('abl_dev');

async function main() {
  try {
    const seasons = await db.collection('seasons').find({}).toArray();
    console.log(`\n📅 ALL SEASONS IN DEV:\n`);
    
    seasons.forEach(s => {
      const teamIdsType = s.teamIds?.[0]?.constructor.name || 'undefined';
      console.log(`Year ${s.year} (${s.slug})`);
      console.log(`  leagueId: ${s.leagueId?.toString?.() || s.leagueId}`);
      console.log(`  isActive: ${s.isActive}`);
      console.log(`  status: ${s.status}`);
      console.log(`  teamIds type: ${teamIdsType}, count: ${s.teamIds?.length || 0}\n`);
    });

  } catch (err) {
    console.error('❌ Error:', err);
  } finally {
    await client.close();
  }
}

main();
