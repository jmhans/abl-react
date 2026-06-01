import { MongoClient, ObjectId } from 'mongodb';
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

const client = new MongoClient(mongoUri);
const db = client.db('abl_dev');

console.log(`\n🟢 RESTORING TO DEV WITH BSON TYPE RESTORATION\n`);

function deserializeWithBson(obj) {
  if (Array.isArray(obj)) {
    return obj.map(item => deserializeWithBson(item));
  }
  
  if (obj !== null && typeof obj === 'object') {
    // Check for ObjectId marker
    if (obj.__type === 'ObjectId' && obj.value) {
      return new ObjectId(obj.value);
    }
    
    // Recursively deserialize nested objects
    const deserialized = {};
    for (const [key, value] of Object.entries(obj)) {
      deserialized[key] = deserializeWithBson(value);
    }
    return deserialized;
  }
  
  return obj;
}

async function main() {
  try {
    if (!fs.existsSync(backupDir)) {
      console.error(`❌ Backup directory not found: ${backupDir}`);
      console.error(`First, run: node scripts/backup-prod-bson-safe.mjs\n`);
      process.exit(1);
    }

    const metaFile = path.join(backupDir, '_metadata.json');
    if (!fs.existsSync(metaFile)) {
      console.error(`❌ Metadata file not found\n`);
      process.exit(1);
    }

    const metadata = JSON.parse(fs.readFileSync(metaFile, 'utf-8'));
    console.log(`Restoring from: ${metadata.source}`);
    console.log(`Backup timestamp: ${metadata.timestamp}`);
    console.log(`Collections: ${metadata.collectionsCount}\n`);

    let totalRestored = 0;

    for (const collName of metadata.collections) {
      const backupFile = path.join(backupDir, `${collName}.json`);

      if (!fs.existsSync(backupFile)) {
        console.warn(`⚠️  File not found for collection: ${collName}`);
        continue;
      }

      console.log(`→ Restoring ${collName}...`);

      const serializedDocs = JSON.parse(fs.readFileSync(backupFile, 'utf-8'));
      const docs = serializedDocs.map(doc => deserializeWithBson(doc));

      const collection = db.collection(collName);

      // Delete existing documents
      const deleteResult = await collection.deleteMany({});
      console.log(`  ✓ Deleted ${deleteResult.deletedCount} existing documents`);

      // Insert new documents
      if (docs.length > 0) {
        const insertResult = await collection.insertMany(docs, { ordered: false });
        console.log(`  ✓ Inserted ${Object.keys(insertResult.insertedIds).length} documents\n`);
        totalRestored += Object.keys(insertResult.insertedIds).length;
      } else {
        console.log(`  ✓ (collection is empty)\n`);
      }
    }

    console.log(`✅ Restore complete with proper BSON types!`);
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
