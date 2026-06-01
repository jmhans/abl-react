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

const prodUri = mongoUri.replace('/abl_dev', '/heroku_wm40bx9r');
const client = new MongoClient(prodUri);
const db = client.db('heroku_wm40bx9r');

console.log(`\n🔴 BACKING UP ALL COLLECTIONS FROM PROD: heroku_wm40bx9r\n`);

async function main() {
  try {
    // Create backup directory
    if (!fs.existsSync(backupDir)) {
      fs.mkdirSync(backupDir, { recursive: true });
    }

    // Get list of all collections (excluding views)
    const collections = await db.listCollections().toArray();
    
    // Filter out views - views have type: 'view'
    const actualCollections = collections.filter(c => c.type !== 'view');
    
    console.log(`Found ${actualCollections.length} actual collections (excluding ${collections.length - actualCollections.length} views)`);
    console.log(`Collections to backup:\n`);

    let totalDocs = 0;

    for (const collInfo of actualCollections) {
      const collName = collInfo.name;
      console.log(`  → ${collName}`);
      
      const collection = db.collection(collName);
      const docs = await collection.find({}).toArray();
      
      const backupFile = path.join(backupDir, `${collName}.json`);
      // EJSON preserves ObjectId, Date, etc. as { "$oid": "..." } so they restore correctly
      fs.writeFileSync(backupFile, EJSON.stringify(docs, null, 2));
      
      console.log(`    ✓ Backed up ${docs.length} documents\n`);
      totalDocs += docs.length;
    }

    const metaFile = path.join(backupDir, '_metadata.json');
    fs.writeFileSync(metaFile, JSON.stringify({
      timestamp: new Date().toISOString(),
      source: 'heroku_wm40bx9r (PROD)',
      collectionsCount: actualCollections.length,
      totalDocuments: totalDocs,
      collections: actualCollections.map(c => c.name),
    }, null, 2));

    console.log(`\n✅ Backup complete!`);
    console.log(`   Total documents: ${totalDocs}`);
    console.log(`   Location: ${backupDir}`);
    console.log(`\nTo restore to dev, run: node scripts/restore-dev-from-backup.mjs\n`);

  } catch (err) {
    console.error('❌ Backup failed:', err);
    process.exit(1);
  } finally {
    await client.close();
  }
}

main();
