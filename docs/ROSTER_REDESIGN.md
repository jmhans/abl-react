# Roster Management Redesign

## Problem Statement
Current roster system is overly complex:
- Updates ALL future lineup documents when adding/dropping players
- Complex timezone calculations scattered throughout code
- Uses `priorRosters` embedded array that grows indefinitely
- Difficult to understand "roster effective date" logic

## Proposed Solution

### Core Principles
1. **One document per team per game date** - Simple, atomic roster snapshots
2. **Edit next game only** - No cascade updates to multiple future dates
3. **Game-based locking** - Rosters lock at noon CT on game day
4. **Historical snapshots** - Past rosters preserved as separate documents

### Document Structure

```javascript
// Collection: lineups
{
  _id: ObjectId,
  ablTeam: ObjectId,              // ref to ablteams
  effectiveDate: Date,             // noon CT before this game
  roster: [{
    player: ObjectId,              // ref to players
    lineupPosition: String,        // "1B", "2B", "SS", "OF", "C", "DH", etc.
    rosterOrder: Number            // CRITICAL: Determines lineup priority for game scoring
                                   // Lower numbers = higher priority when filling positions
                                   // Must be preserved exactly in historical snapshots
  }],
  updatedAt: Date                  // when this version was saved
}

// Indexes:
// - {ablTeam: 1, effectiveDate: -1} - for "most recent before date" queries
// - {ablTeam: 1, effectiveDate: 1} - unique compound index
```

### Key Operations

#### 1. Calculate Effective Date
```javascript
function getNextRosterEffectiveDate() {
  // 1. Query games collection for next scheduled game
  const nextGame = await db.collection('games')
    .find({ gameDate: { $gte: new Date() } })
    .sort({ gameDate: 1 })
    .limit(1);
  
  // 2. Calculate noon CT on that game date
  const gameDate = new Date(nextGame.gameDate);
  const noonCT = new Date(
    gameDate.getFullYear(),
    gameDate.getMonth(), 
    gameDate.getDate(),
    12, 0, 0
  );
  
  // 3. Convert to UTC (CT = UTC-5 or UTC-6 depending on DST)
  // Noon CT = 5pm or 6pm UTC
  const effectiveDate = convertToUTC(noonCT, 'America/Chicago');
  
  return effectiveDate;
}
```

#### 2. Get Current Roster (for display)
```javascript
async function getCurrentRoster(teamId) {
  const effectiveDate = await getNextRosterEffectiveDate();
  
  // Get roster for this effective date, or copy from previous
  let lineup = await db.collection('lineups').findOne({
    ablTeam: teamId,
    effectiveDate: effectiveDate
  });
  
  if (!lineup) {
    // No roster set for next game yet - copy from most recent
    const previous = await db.collection('lineups')
      .find({ ablTeam: teamId, effectiveDate: { $lt: effectiveDate } })
      .sort({ effectiveDate: -1 })
      .limit(1)
      .toArray();
    
    lineup = {
      ablTeam: teamId,
      effectiveDate: effectiveDate,
      roster: previous[0]?.roster || [],
      updatedAt: new Date()
    };
  }
  
  return lineup;
}
```

#### 3. Add Player to Roster
```javascript
async function addPlayerToRoster(teamId, player, position) {
  const effectiveDate = await getNextRosterEffectiveDate();
  
  // Check if roster locked
  if (new Date() >= effectiveDate) {
    throw new Error('Roster is locked for next game');
  }
  
  // Get current roster (will copy from previous if needed)
  const lineup = await getCurrentRoster(teamId);
  
  // Add player to roster
  lineup.roster.push({
    player: player._id,
    lineupPosition: position,
    rosterOrder: lineup.roster.length + 1
  });
  lineup.updatedAt = new Date();
  
  // Upsert single document
  await db.collection('lineups').updateOne(
    { ablTeam: teamId, effectiveDate: effectiveDate },
    { $set: lineup },
    { upsert: true }
  );
  
  // Update player ownership
  await db.collection('players').updateOne(
    { _id: player._id },
    { $set: { 
      'ablstatus.ablTeam': teamId,
      'ablstatus.onRoster': true 
    }}
  );
  
  return lineup;
}
```

#### 4. Drop Player from Roster
```javascript
async function dropPlayerFromRoster(teamId, playerId) {
  const effectiveDate = await getNextRosterEffectiveDate();
  
  // Check if roster locked
  if (new Date() >= effectiveDate) {
    throw new Error('Roster is locked for next game');
  }
  
  // Get current roster
  const lineup = await getCurrentRoster(teamId);
  
  // Remove player
  lineup.roster = lineup.roster.filter(r => !r.player.equals(playerId));
  lineup.updatedAt = new Date();
  
  // Upsert single document
  await db.collection('lineups').updateOne(
    { ablTeam: teamId, effectiveDate: effectiveDate },
    { $set: lineup },
    { upsert: true }
  );
  
  // Update player ownership
  await db.collection('players').updateOne(
    { _id: playerId },
    { $set: { 
      'ablstatus.ablTeam': null,
      'ablstatus.onRoster': false 
    }}
  );
  
  return lineup;
}
```

#### 5. Get Roster for Game Scoring
```javascript
async function getRosterForGame(teamId, gameDate) {
  // Find most recent roster before/at game time
  const lineup = await db.collection('lineups')
    .find({ 
      ablTeam: teamId, 
      effectiveDate: { $lte: gameDate } 
    })
    .sort({ effectiveDate: -1 })
    .limit(1)
    .toArray();
  
  return lineup[0];
}
```

### UI Changes

#### My Roster Page
```
┌─────────────────────────────────────────┐
│ My Roster                               │
│                                         │
│ Next Game: June 15, 2025 at 7:00 PM   │
│ Roster Lock: June 15, 2025 at 12:00 PM│
│ Status: Editable [23h 15m remaining]   │
│                                         │
│ [Add Player] [View Free Agents]        │
│                                         │
│ Position  Player           Team  Stats │
│ ────────  ──────────────  ────  ────── │
│ 1B        Mike Trout      LAA   .285   │
│ 2B        Jose Altuve     HOU   .298   │
│ ...                                     │
│                                         │
│ [Save Changes]                          │
└─────────────────────────────────────────┘
```

- Shows roster for NEXT game only
- Clear indication of lock time and remaining time
- Add/drop operations immediate (no multi-date selection)
- Historical view available via date selector (read-only)

### Benefits

1. **Simpler code**: One upsert instead of update-many
2. **Better performance**: No cascade updates across multiple documents
3. **Clearer semantics**: "This is my roster for the next game"
4. **Easier debugging**: Each game has explicit roster snapshot
5. **Historical accuracy**: Past rosters preserved as-is
6. **No edge cases**: No "which futures to update?" logic

### Migration Plan

**Option 1: Rebuild from transactions**
- Export draft picks + all add/drop transactions
- Replay in chronological order
- Generate lineup document for each game date

**Option 2: One-time conversion**
- For each team, for each game date in current season
- Query old system's `_getRosterForTeamAndDate`
- Save as new document

**Option 3: Hybrid**
- Start fresh for new season
- Keep old data as-is for historical reference
- No migration needed

### Implementation Checklist

**Phase 1: API Endpoints**
- [ ] `GET /api/teams/:id/roster` - Get current roster (populates players)
- [ ] `POST /api/teams/:id/roster/add` - Add player (assigns next rosterOrder)
- [ ] `DELETE /api/teams/:id/roster/:playerId` - Drop player (reorders remaining)
- [ ] `PUT /api/teams/:id/roster/reorder` - Update rosterOrder (critical for game scoring!)
- [ ] `PUT /api/teams/:id/roster/:playerId/position` - Update lineupPosition only
- [ ] `GET /api/teams/:id/roster/history` - Historical rosters
- [ ] Helper: `getNextRosterEffectiveDate()`
- [ ] Helper: `getRosterForGame(teamId, gameDate)` - Used by game scoring
- [ ] Helper: `getNoonCTForDate(date)` - Timezone conversion utility

**Phase 2: UI Components**
- [ ] Roster page with next game info
- [ ] Lock status indicator
- [ ] Add player modal/flow
- [ ] Drop player confirmation
- [ ] Drag-and-drop reordering
- [ ] Historical roster viewer

**Phase 3: Testing**
- [ ] Unit tests for effective date calculation
- [ ] Test roster locking behavior
- [ ] Test add/drop operations
- [ ] Test game scoring roster retrieval
- [ ] Test timezone edge cases

**Phase 4: Migration**
- [ ] Choose migration strategy
- [ ] Run migration script
- [ ] Validate data integrity
- [ ] Deploy

### Open Questions / Future Enhancements

1. **Lineup optimization suggestions** - AI-powered batting order recommendations
2. **Injury notifications** - Alert when rostered player goes on IL
3. **Roster validity checks** - Warn if player not on active MLB roster
4. **Transaction history log** - Separate collection tracking all adds/drops with timestamps
5. **Undo functionality** - Allow reverting recent changes before lock
