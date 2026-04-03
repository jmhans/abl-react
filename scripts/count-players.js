const db = db.getSiblingDB('abl_dev');
const total = db.players_view.countDocuments();
const filtered = db.players_view.countDocuments({
  $or: [
    { 'eligible.0': { $exists: true } },
    { 'stats.batting.atBats': { $gt: 0 } }
  ]
});
const withEligible = db.players_view.countDocuments({ 'eligible.0': { $exists: true } });
const withABs = db.players_view.countDocuments({ 'stats.batting.atBats': { $gt: 0 } });

console.log('=== Player Counts ===');
console.log('Total in players_view:', total);
console.log('Filtered by query (eligible OR ABs > 0):', filtered);
console.log('  - with eligible positions:', withEligible);
console.log('  - with ABs > 0:', withABs);
console.log('Excluded pure pitchers:', total - filtered);
