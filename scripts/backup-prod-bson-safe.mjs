import { MongoClient } from 'mongodb';
import * as fs from 'fs';
import * as path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const backupDir = path.join(__dirname, '../backup-all-collections-fixed');

let mongoUri = process.env.MONGODB_URI;
if (!mongoUri) {
  try {
    const envPath = path.resolve(__dirname, '../.env.local');
    const envLocal = fs.readFileSync(envPath, 'utf-8');
    const match = envLocal.match(/^MONGODB_URI=(.+)$/m);
    if (match) mongoUri = match[1].trim().replace(/^['"]|['"]$/g, '');
  } catch (e) {
    console.error('❌ Could not find MONGODB_URI');
    process.exit(1);
  }
}

const prodUri = mongoUri.replace('/abl_dev', '/heroku_wm40bx9r');
const client = new MongoClient(prodUri);
const db = client.db('heroku_wm40bx9r');

console.log(`\n🔴 BACKING UP PROD WITH BSON TYPE PRESERVATION\n`);

async function serializeWithBson(doc) {
  const serialized = JSON.parse(JSON.stringify(doc, (key, value) => {
    // Mark ObjectIds so we can restore them later
    if (value && typeof value === 'object' && value._bsontype === 'ObjectId') {
      return { __type: 'ObjectId', value: value.toString() };
    }
    return value;
  }));
  return serialized;
}

async function main() {
  try {
    if (!fs.existsSync(backupDir)) {
      fs.mkdirSync(backupDir, { recursive: true });
    }

    const collections = await db.listCollections().toArray();
    const actualCollections = collections.filter(c => c.type !== 'view');

    console.log(`Found ${actualCollections.length} actual collections\n`);

    let totalDocs = 0;

    for (const collInfo of actualCollections) {
      const collName = collInfo.name;
      console.log(`→ ${collName}`);

      const collection = db.collection(collName);
      const docs = await collection.find({}).toArray();

      // Serialize with BSON type markers
      const serialized = docs.map(doc => serializeWithBson(doc));

      const backupFile = path.join(backupDir, `${collName}.json`);
      fs.writeFileSync(backupFile, JSON.stringify(serialized, null, 2));

      console.log(`  ✓ Backed up ${docs.length} documents\n`);
      totalDocs += docs.length;
    }

    const metaFile = path.join(backupDir, '_metadata.json');
    fs.writeFileSync(metaFile, JSON.stringify({
      timestamp: new Date().toISOString(),
      source: 'heroku_wm40bx9r (PROD)',
      collectionsCount: actualCollections.length,
      totalDocuments: totalDocs,
      collections: actualCollections.map(c => c.name),
      note: 'ObjectIds preserved with __type markers',
    }, null, 2));

    console.log(`✅ Backup complete!`);
    console.log(`   Total documents: ${totalDocs}`);
    console.log(`   Location: ${backupDir}`);
    console.log(`\nTo restore to dev, run: node scripts/restore-dev-from-backup-fixed.mjs\n`);

  } catch (err) {
    console.error('❌ Backup failed:', err);
    process.exit(1);
  } finally {
    await client.close();
  }
}

main();
