#!/usr/bin/env node

/**
 * Backup all collections from production MongoDB database.
 * Usage: node scripts/backup-prod-db.mjs
 * 
 * Uses MONGODB_DB_URL (same connection as dev, just different DB name).
 * Exports to backup/ directory with timestamp.
 */

import { MongoClient } from 'mongodb';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import process from 'process';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const backupDir = path.join(__dirname, '..', 'backup');

const MONGODB_URL = process.env.MONGODB_DB_URL || 'mongodb://localhost:27017';
const PROD_DB_NAME = process.env.PROD_MONGODB_DB || 'heroku_wm40bx9r';

async function main() {
  const client = new MongoClient(MONGODB_URL);

  try {
    await client.connect();
    const db = client.db(PROD_DB_NAME);

    // Create backup directory
    if (!fs.existsSync(backupDir)) {
      fs.mkdirSync(backupDir, { recursive: true });
    }

    const timestamp = new Date().toISOString().replace(/[:.]/g, '-').slice(0, -5);
    const backupSummary = {
      timestamp,
      database: PROD_DB_NAME,
      collections: {},
    };

    // Get all collections
    const collections = await db.listCollections().toArray();
    console.log(`\n[${PROD_DB_NAME}] Backing up ${collections.length} collections...\n`);

    for (const collInfo of collections) {
      const collName = collInfo.name;
      console.log(`  Backing up ${collName}...`);

      try {
        const collection = db.collection(collName);
        const docs = await collection.find({}).toArray();
        const filename = `${timestamp}_${collName}.json`;
        const filepath = path.join(backupDir, filename);

        fs.writeFileSync(filepath, JSON.stringify(docs, null, 2));
        console.log(`    ✓ ${docs.length} documents`);

        backupSummary.collections[collName] = {
          count: docs.length,
          file: filename,
        };
      } catch (err) {
        console.error(`    ✗ Error: ${err.message}`);
      }
    }

    // Write summary
    const summaryFile = path.join(backupDir, `${timestamp}_SUMMARY.json`);
    fs.writeFileSync(summaryFile, JSON.stringify(backupSummary, null, 2));

    console.log(`\n✅ Backup complete: ${backupDir}`);
    console.log(`   Summary: ${summaryFile}`);
  } catch (error) {
    console.error('Error:', error.message);
    process.exit(1);
  } finally {
    await client.close();
  }
}

main();
