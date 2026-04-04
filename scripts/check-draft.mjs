import { MongoClient } from 'mongodb';
import { readFileSync } from 'fs';
import { resolve, dirname } from 'path';
import { fileURLToPath } from 'url';

const __dirname = dirname(fileURLToPath(import.meta.url));
for (const line of readFileSync(resolve(__dirname, '..', '.env.local'), 'utf8').split(/\r?\n/)) {
  const m = line.match(/^([^#=\r]+)=(.*\S*)/);
  if (m) process.env[m[1].trim()] = m[2].trim();
}

const client = new MongoClient(process.env.MONGODB_URI);
await client.connect();
const db = client.db(process.env.MONGODB_DB || 'abl_dev');

console.log('\n📊 Statline Format in Database:');

// Get sample statline docs
const samples = await db.collection('statlines').find({}).limit(3).toArray();

if (samples.length > 0) {
  console.log(`Found ${samples.length} sample statlines:\n`);
  samples.forEach((s, i) => {
    console.log(`Sample ${i + 1}:`);
    console.log('  Keys:', Object.keys(s).filter(k => k !== '_id').join(', '));
    console.log('  Full doc:', JSON.stringify(s, null, 2).slice(0, 300));
    console.log('');
  });
} else {
  console.log('No statlines found!');
}

// Also check collections available
const colls = await db.listCollections().toArray();
console.log('\n📚 Collections in database:');
colls.forEach(c => console.log('  -', c.name));

await client.close();
