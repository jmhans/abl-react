import { Db } from 'mongodb';
import { ObjectId } from 'mongodb';
import { calculateGameResultLive } from '@/app/lib/game-utils';

export async function populateRosterPlayers(db: Db, roster: any[] = []) {
  const rawIds = roster
    .map((item: any) => item?.player)
    .filter(Boolean)
    .map((playerRef: any) => {
      if (playerRef instanceof ObjectId) return playerRef;
      if (typeof playerRef === 'string') {
        try {
          return new ObjectId(playerRef);
        } catch {
          return null;
        }
      }
      if (playerRef?._id) {
        try {
          return new ObjectId(playerRef._id.toString());
        } catch {
          return null;
        }
      }
      return null;
    })
    .filter(Boolean) as ObjectId[];

  const uniqueIds = Array.from(new Map(rawIds.map(id => [id.toString(), id])).values());

  const players = uniqueIds.length > 0
    ? await db.collection('players').find({ _id: { $in: uniqueIds } }).toArray()
    : [];

  const playerMap = new Map(players.map((player: any) => [player._id.toString(), player]));

  return roster.map((item: any) => {
    const playerRef = item?.player;
    const playerId = playerRef?._id?.toString?.() || playerRef?.toString?.() || String(playerRef);

    return {
      ...item,
      player: playerMap.get(playerId) || playerRef,
    };
  });
}

export async function saveCalculatedResult(db: Db, gameId: string, result: any) {
  return db.collection('games').findOneAndUpdate(
    { _id: new ObjectId(gameId) },
    { $set: { result } } as any,
    { returnDocument: 'after' },
  );
}

export async function calculateAndStoreLiveGameResult(db: Db, game: any, options?: { save?: boolean }) {
  const save = options?.save !== false;

  let homeSourceRoster = game?.homeTeamRoster || [];
  let awaySourceRoster = game?.awayTeamRoster || [];

  if ((!homeSourceRoster.length || !awaySourceRoster.length) && game?.result) {
    const legacyResult = game.result;
    const legacyHome = legacyResult?.scores?.find((s: any) => s.location === 'H' || s.team?.toString() === game.homeTeam?.toString()) || legacyResult?.scores?.[0];
    const legacyAway = legacyResult?.scores?.find((s: any) => s.location === 'A' || s.team?.toString() === game.awayTeam?.toString()) || legacyResult?.scores?.[1];

    const filterRosterPlayers = (players: any[] = []) =>
      players.filter((p: any) => {
        const name = p?.player?.name || p?.name || '';
        return name !== 'supp' && name !== 'four';
      });

    if (!homeSourceRoster.length && legacyHome?.players) {
      homeSourceRoster = filterRosterPlayers(legacyHome.players);
    }

    if (!awaySourceRoster.length && legacyAway?.players) {
      awaySourceRoster = filterRosterPlayers(legacyAway.players);
    }
  }

  if (!homeSourceRoster.length || !awaySourceRoster.length) {
    return {
      status: 'skipped',
      reason: 'missing rosters',
      gameId: game?._id?.toString?.(),
    };
  }

  const [homeRosterWithPlayers, awayRosterWithPlayers] = await Promise.all([
    populateRosterPlayers(db, homeSourceRoster),
    populateRosterPlayers(db, awaySourceRoster),
  ]);

  const result = await calculateGameResultLive(
    db,
    game._id.toString(),
    game.homeTeam.toString(),
    game.awayTeam.toString(),
    homeRosterWithPlayers,
    awayRosterWithPlayers,
    new Date(game.gameDate),
  );

  if (!save) {
    return {
      status: 'calculated',
      gameId: game._id.toString(),
      result,
    };
  }

  const updateResult = await saveCalculatedResult(db, game._id.toString(), result);
  const savedGame = updateResult ? updateResult.value : null;

  return {
    status: 'saved',
    gameId: game._id.toString(),
    result,
    game: savedGame,
  };
}
