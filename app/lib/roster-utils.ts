import { Db } from 'mongodb';

/**
 * Calculate ABL (ABL Fantasy) score from batting stats
 * Formula from Angular app:
 * (hits*25 + doubles*10 + triples*20 + homeRuns*30 + baseOnBalls*10 + hitByPitch*10 + 
 *  stolenBases*7 + caughtStealing*(-7) + pickoffs*(-7) + (sacBunts + sacFlies)*5) / atBats - 4.5
 */
export function calculateAblScore(stats: any): number {
  if (!stats || !stats.batting || stats.batting.atBats === 0) {
    return 0;
  }

  const b = stats.batting;
  const points =
    (b.hits || 0) * 25 +
    (b.doubles || 0) * 10 +
    (b.triples || 0) * 20 +
    (b.homeRuns || 0) * 30 +
    (b.baseOnBalls || 0) * 10 +
    (b.hitByPitch || 0) * 10 +
    (b.stolenBases || 0) * 7 +
    (b.caughtStealing || 0) * -7 +
    (b.pickoffs || 0) * -7 +
    ((b.sacBunts || 0) + (b.sacFlies || 0)) * 5;

  return points / b.atBats - 4.5;
}

/**
 * Calculate raw ABL points (numerator only, before division by AB)
 * Used for team-level aggregation
 */
export function calculateAblPoints(stats: any): number {
  if (!stats) {
    return 0;
  }

  // Support both stats.batting and stats at root level
  const b = stats.batting || stats;
  
  if (!b) return 0;

  return (
    (b.hits || b.h || 0) * 25 +
    (b.doubles || b['2b'] || 0) * 10 +
    (b.triples || b['3b'] || 0) * 20 +
    (b.homeRuns || b.hr || 0) * 30 +
    (b.baseOnBalls || b.bb || 0) * 10 +
    (b.hitByPitch || b.hbp || 0) * 10 +
    (b.stolenBases || b.sb || 0) * 7 +
    (b.caughtStealing || b.cs || 0) * -7 +
    (b.pickoffs || b.po || 0) * -7 +
    ((b.sacBunts || b.sac || 0) + (b.sacFlies || b.sf || 0)) * 5
  );
}

/**
 * Convert a date to noon Central Time, returned as UTC
 * Handles DST properly
 */
export function getNoonCTAsUTC(date: Date): Date {
  // Create date at noon local time
  const year = date.getFullYear();
  const month = date.getMonth();
  const day = date.getDate();
  
  // Create noon CT time
  // CT is UTC-6 (CST) or UTC-5 (CDT)
  // Noon CT = 18:00 UTC (CST) or 17:00 UTC (CDT)
  
  // Use Intl API to handle DST correctly
  const ctString = new Date(year, month, day, 12, 0, 0).toLocaleString('en-US', {
    timeZone: 'America/Chicago',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
    hour12: false
  });
  
  // Parse back to get UTC time
  const ctDate = new Date(year, month, day, 12, 0, 0);
  const utcDate = new Date(ctString);
  const offset = ctDate.getTime() - utcDate.getTime();
  
  return new Date(ctDate.getTime() + offset);
}

/**
 * Get eligible positions for a player
 * Tries to get from player.eligible array, falls back to player.position field,
 * or uses a default set of standard positions
 */
export function getEligiblePositions(player: any): string[] {
  // If player already has eligible array with positions, use it
  if (Array.isArray(player.eligible) && player.eligible.length > 0) {
    return player.eligible;
  }

  // If player has a single position field, wrap it in array
  if (player.position && typeof player.position === 'string') {
    return [player.position];
  }

  // If player has mlbPosition, use standard positions based on it
  if (player.mlbPosition && typeof player.mlbPosition === 'string') {
    const pos = player.mlbPosition.toUpperCase();
    // Map MLB positions to standard positions
    if (pos.includes('C')) return ['C'];
    if (pos.includes('1B')) return ['1B'];
    if (pos.includes('2B')) return ['2B'];
    if (pos.includes('3B')) return ['3B'];
    if (pos.includes('SS')) return ['SS'];
    if (pos.includes('OF')) return ['OF', 'LF', 'CF', 'RF'];
    if (pos.includes('DH')) return ['DH', 'OF'];
  }

  // Default fallback: standard positions
  return ['C', '1B', '2B', '3B', 'SS', 'OF', 'DH'];
}

export function enrichPlayersWithEligibility(players: any[]): any[] {
  return players.map(player => ({
    ...player,
    eligible: getEligiblePositions(player)
  }));
}
export async function getNextRosterEffectiveDate(db: Db): Promise<Date> {
  try {
    // Find next scheduled game
    const nextGames = await db.collection('games')
      .find({ 
        gameDate: { $gte: new Date() },
        gameType: 'R' // Regular season only
      })
      .sort({ gameDate: 1 })
      .limit(1)
      .toArray();
    
    if (nextGames.length === 0) {
      // No upcoming games - use tomorrow's date for development/testing/off-season
      // This gives users a day to make roster changes before locking
      const tomorrow = new Date();
      tomorrow.setDate(tomorrow.getDate() + 1);
      return getNoonCTAsUTC(tomorrow);
    }
    
    const nextGameDate = new Date(nextGames[0].gameDate);
    
    // Return noon CT on that game date
    return getNoonCTAsUTC(nextGameDate);
    
  } catch (error) {
    console.error('Error getting next roster effective date:', error);
    throw error;
  }
}

/**
 * Get roster for a specific team and game date
 * Used by game scoring logic
 * Returns the most recent roster with effectiveDate <= gameDate
 */
export async function getRosterForGame(db: Db, teamId: string, gameDate: Date) {
  try {
    const { ObjectId } = require('mongodb');
    
    const lineups = await db.collection('lineups')
      .find({ 
        ablTeam: new ObjectId(teamId), 
        effectiveDate: { $lte: gameDate } 
      })
      .sort({ effectiveDate: -1 })
      .limit(1)
      .toArray();
    
    return lineups[0] || null;
    
  } catch (error) {
    console.error('Error getting roster for game:', error);
    throw error;
  }
}

/**
 * Check if roster is currently locked for the next game
 * Rosters lock when current time passes the effectiveDate (noon CT on game day)
 */
export async function isRosterLocked(db: Db): Promise<boolean> {
  const effectiveDate = await getNextRosterEffectiveDate(db);
  
  if (!effectiveDate) {
    // No upcoming games, roster editing not relevant
    return true;
  }
  
  return new Date() >= effectiveDate;
}

/**
 * Get time remaining until roster lock
 * Returns milliseconds, or null if no upcoming game
 */
export async function getTimeUntilLock(db: Db): Promise<number | null> {
  const effectiveDate = await getNextRosterEffectiveDate(db);
  
  if (!effectiveDate) {
    return null;
  }
  
  const remaining = effectiveDate.getTime() - Date.now();
  return Math.max(0, remaining);
}
