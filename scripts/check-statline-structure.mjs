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

// Check statlines structure
console.log('=== Statline dates available ===');
const dates = await db.collection('statlines')
  .find({})
  .project({ _id: 1 })
  .sort({ _id: 1 })
  .toArray();

console.log(`Total statline dates: ${dates.length}`);
console.log('First 10:', dates.slice(0, 10).map(d => d._id));
console.log('Last 10:', dates.slice(-10).map(d => d._id));

// Check if any are from 2026 through April 5
const april5Filter = dates.filter(d => /^2026-(?:0[1-3]|04-0[0-5])/.test(d._id));
console.log(`\n2026 dates through 04-05: ${april5Filter.length}`);
console.log(april5Filter.map(d => d._id));

// Sample a statline doc structure
console.log('\n=== Sample statline doc structure ===');
const sample = await db.collection('statlines').findOne({ _id: { $regex: '^2026-' } });
if (sample) {
  console.log('_id:', sample._id);
  const keys = Object.keys(sample.p || {}).slice(0, 5);
  console.log('p keys (first 5):', keys);
  if (keys[0]) {
    console.log('Example entry:', sample.p[keys[0]]);
  }
}

await client.close();
