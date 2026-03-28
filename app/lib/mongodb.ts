import { MongoClient, Db } from 'mongodb';

let client: MongoClient | null = null;
let clientPromise: Promise<MongoClient> | null = null;
let db: Db | null = null;

function getMongoUri(): string {
  const directUri = process.env.MONGODB_URI_DIRECT;
  const srvUri = process.env.MONGODB_URI;
  const mongoUrl = directUri || srvUri;

  if (!mongoUrl) {
    throw new Error('MONGODB_URI is not defined');
  }

  return mongoUrl;
}

async function getClient(): Promise<MongoClient> {
  if (client) {
    return client;
  }

  if (clientPromise) {
    return clientPromise;
  }

  const mongoUrl = getMongoUri();
  const nextClient = new MongoClient(mongoUrl, {
    serverSelectionTimeoutMS: 10000,
    connectTimeoutMS: 10000,
    family: 4,
  });

  clientPromise = nextClient.connect();

  try {
    client = await clientPromise;
    return client;
  } catch (error: any) {
    clientPromise = null;

    if (error?.code === 'ETIMEOUT' && String(error?.hostname || '').includes('_mongodb._tcp.')) {
      throw new Error(
        'MongoDB Atlas DNS lookup timed out. If this keeps happening, use a non-SRV Atlas connection string in MONGODB_URI_DIRECT or retry on a stable network/VPN.'
      );
    }

    throw error;
  }
}

export async function connectToDatabase(): Promise<Db> {
  if (db) {
    return db;
  }

  const connectedClient = await getClient();

  const dbName = process.env.MONGODB_DB || 'abl_dev';
  db = connectedClient.db(dbName);

  console.log(`Connected to MongoDB database: ${dbName}`);

  return db;
}

export async function closeDatabase(): Promise<void> {
  if (client) {
    await client.close();
  }
  client = null;
  clientPromise = null;
  db = null;
}

export { db };
