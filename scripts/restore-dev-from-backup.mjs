import { MongoClient, BSON } from 'mongodb';
const { EJSON } = BSON;
import * as fs from 'fs';
import * as path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const backupDir = path.join(__dirname, '../backup-all-collections');

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
    console.error('❌ Could not find MONGODB_URI in env or .env.local');
    process.exit(1);
  }
}

if (!mongoUri) {
  console.error('❌ MONGODB_URI is empty');
  process.exit(1);
}

const devUri = mongoUri;
const client = new MongoClient(devUri);
const db = client.db('abl_dev');

console.log(`\n🟢 RESTORING ALL COLLECTIONS TO DEV: abl_dev\n`);

async function main() {
  try {
    // Check if backup exists
    if (!fs.existsSync(backupDir)) {
      console.error(`❌ Backup directory not found: ${backupDir}`);
      console.error(`First, run: node scripts/backup-prod-all-collections.mjs\n`);
      process.exit(1);
    }

    // Read metadata
    const metaFile = path.join(backupDir, '_metadata.json');
    if (!fs.existsSync(metaFile)) {
      console.error(`❌ Metadata file not found. Invalid backup?\n`);
      process.exit(1);
    }

    const metadata = JSON.parse(fs.readFileSync(metaFile, 'utf-8'));
    console.log(`Restoring from: ${metadata.source}`);
    console.log(`Backup timestamp: ${metadata.timestamp}`);
    console.log(`Collections: ${metadata.collectionsCount}\n`);

    // Confirm action
    console.log(`⚠️  WARNING: This will DELETE all data in ${metadata.collectionsCount} collections and restore from backup.`);
    console.log(`Collections to clear and restore:\n`);
    metadata.collections.forEach(c => console.log(`  - ${c}`));
    console.log();

    // For safety, we'll just proceed (modify if you want interactive prompt)
    console.log(`Proceeding with restoration...\n`);

    let totalRestored = 0;

    for (const collName of metadata.collections) {
      const backupFile = path.join(backupDir, `${collName}.json`);
      
      if (!fs.existsSync(backupFile)) {
        console.warn(`⚠️  File not found for collection: ${collName}`);
        continue;
      }

      console.log(`→ Restoring ${collName}...`);

      // EJSON.parse restores ObjectId, Date, etc. back to proper BSON types
      const docs = EJSON.parse(fs.readFileSync(backupFile, 'utf-8'));
      const collection = db.collection(collName);

      // Delete existing documents
      const deleteResult = await collection.deleteMany({});
      console.log(`  ✓ Deleted ${deleteResult.deletedCount} existing documents`);

      // Insert new documents (if any)
      if (docs.length > 0) {
        const insertResult = await collection.insertMany(docs, { ordered: false });
        console.log(`  ✓ Inserted ${Object.keys(insertResult.insertedIds).length} documents\n`);
        totalRestored += Object.keys(insertResult.insertedIds).length;
      } else {
        console.log(`  ✓ (collection is empty)\n`);
      }
    }

    console.log(`\n✅ Restore complete!`);
    console.log(`   Collections restored: ${metadata.collectionsCount}`);
    console.log(`   Total documents inserted: ${totalRestored}\n`);

  } catch (err) {
    console.error('❌ Restore failed:', err);
    process.exit(1);
  } finally {
    await client.close();
  }
}

main();
