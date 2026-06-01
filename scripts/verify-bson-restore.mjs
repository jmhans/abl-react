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
    console.log(`\n✅ VERIFYING BSON TYPES RESTORED CORRECTLY\n`);

    const season = await db.collection('seasons').findOne({ year: 2026, isActive: true });
    console.log(`2026 ABL Season teamIds:`);
    console.log(`  Type of [0]: ${season.teamIds[0].constructor.name}`);
    console.log(`  Are they ObjectIds? ${season.teamIds[0].constructor.name === 'ObjectId' ? '✓ YES' : '✗ NO'}\n`);

    const found = await db.collection('ablteams').find({ _id: { $in: season.teamIds } }).toArray();
    console.log(`Query { _id: { $in: season.teamIds } } found ${found.length} teams:`);
    found.forEach(t => console.log(`  - ${t.nickname}`));

  } catch (err) {
    console.error('❌ Error:', err);
  } finally {
    await client.close();
  }
}

main();
