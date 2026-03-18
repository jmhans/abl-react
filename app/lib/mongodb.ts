import { MongoClient, Db } from 'mongodb';

let client: MongoClient;
let db: Db;

export async function connectToDatabase(): Promise<Db> {
  if (db) {
    return db;
  }

  const mongoUrl = process.env.MONGODB_URI;
  if (!mongoUrl) {
    throw new Error('MONGODB_URI is not defined');
  }

  client = new MongoClient(mongoUrl);
  await client.connect();
  
  // Extract database name from URI or use default
  const dbName = process.env.MONGODB_DB || 'abl_dev';
  db = client.db(dbName);
  
  console.log(`Connected to MongoDB database: ${dbName}`);
  
  return db;
}

export async function closeDatabase(): Promise<void> {
  if (client) {
    await client.close();
  }
}

export { db };
