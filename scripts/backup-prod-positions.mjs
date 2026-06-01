import { MongoClient } from 'mongodb';
import { writeFileSync } from 'fs';
import { readFileSync } from 'fs';
import { resolve, dirname } from 'path';
import { fileURLToPath } from 'url';

const __dirname = dirname(fileURLToPath(import.meta.url));

// Read .env.local for credentials, but connect to prod DB
for (const line of readFileSync(resolve(__dirname, '..', '.env.local'), 'utf8').split(/\r?\n/)) {
  const m = line.match(/^([^#=\r]+)=(.*\S*)/);
  if (m) process.env[m[1].trim()] = m[2].trim();
}

// Override DB name to prod
const prodUri = process.env.MONGODB_URI.replace('/abl_dev', '/heroku_wm40bx9r');
const client = new MongoClient(prodUri);
await client.connect();
const db = client.db('heroku_wm40bx9r');

console.log(`Backing up position_log from PROD DB: heroku_wm40bx9r`);

// Export all 2026 position_log entries
const allPos2026 = await db.collection('position_log')
  .find({ season: 2026 })
  .toArray();

console.log(`Found ${allPos2026.length} position_log 2026 entries`);

const backup = {
  timestamp: new Date().toISOString(),
  db: 'heroku_wm40bx9r',
  recordCount: allPos2026.length,
  data: allPos2026
};

writeFileSync(
  resolve(__dirname, '..', 'position_log_2026_backup_PROD.json'),
  JSON.stringify(backup, null, 2)
);

console.log(`✅ Backed up to: position_log_2026_backup_PROD.json`);

await client.close();
