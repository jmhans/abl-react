import { MongoClient } from 'mongodb';

async function copyProdToDev() {
  const uri = process.env.MONGODB_URI!;
  
  if (!uri) {
    throw new Error('MONGODB_URI not found in environment');
  }

  const client = new MongoClient(uri);

  try {
    await client.connect();
    console.log('Connected to MongoDB');

    const prodDb = client.db('heroku_wm40bx9r');
    const devDb = client.db('abl_dev');

    // Get all collections from production — exclude views (type === 'view').
    // Views are live aggregation pipelines; copying their output as a static
    // collection breaks them. Run scripts/recreate-dev-views.ts separately
    // after this script to recreate views as proper views in dev.
    const allCollInfos = await prodDb.listCollections().toArray();
    const collections = allCollInfos.filter((c) => c.type !== 'view');
    const viewCount   = allCollInfos.length - collections.length;

    console.log(`Found ${collections.length} collections to copy (skipping ${viewCount} view(s))\n`);

    for (const collInfo of collections) {
      const collName = collInfo.name;
      console.log(`Copying ${collName}...`);

      const prodCollection = prodDb.collection(collName);
      const devCollection = devDb.collection(collName);

      // Drop existing dev collection
      try {
        await devDb.dropCollection(collName);
      } catch (err: any) {
        // Ignore error if collection doesn't exist
        if (err.code !== 26) throw err;
      }

      // Copy all documents
      const docs = await prodCollection.find({}).toArray();
      
      if (docs.length > 0) {
        await devCollection.insertMany(docs);
      }

      console.log(`✓ ${collName} - ${docs.length} documents copied`);
    }

    console.log('\n✅ All collections copied successfully!');
    if (viewCount > 0) {
      console.log(`\nℹ️  ${viewCount} view(s) were skipped. Run the following to recreate them in dev:`);
      console.log('   npx ts-node -r tsconfig-paths/register scripts/recreate-dev-views.ts');
    }
  } catch (error) {
    console.error('Error:', error);
    throw error;
  } finally {
    await client.close();
  }
}

copyProdToDev();
