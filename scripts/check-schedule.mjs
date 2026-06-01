import { readFileSync } from 'fs';

for (const line of readFileSync('.env.local', 'utf8').split(/\r?\n/)) {
  const m = line.match(/^([^#=\r]+)=(.*\S*)/);
  if (m) process.env[m[1].trim()] = m[2].trim();
}

const MLB_API = 'https://statsapi.mlb.com/api/v1';

async function fetchJson(url) {
  const res = await fetch(url);
  if (!res.ok) throw new Error(`${res.status}: ${res.statusText}`);
  return await res.json();
}

// Check what gameType values are in the schedule
const schedule = await fetchJson(`${MLB_API}/schedule?sportId=1&date=2026-03-27`);
const games = schedule?.dates?.[0]?.games || [];

console.log(`Found ${games.length} games on 2026-03-27\n`);

if (games.length > 0) {
  const sample = games[0];
  console.log('Sample game structure (first game):');
  console.log(JSON.stringify({
    gamePk: sample.gamePk,
    gameType: sample.gameType,
    status: sample.status
  }, null, 2));

  console.log('\nAll unique gameTypes on 2026-03-27:');
  const types = new Set(games.map(g => g.gameType));
  types.forEach(t => console.log(`  ${t}`));
}
