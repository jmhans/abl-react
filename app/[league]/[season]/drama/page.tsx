'use client';

import { useEffect, useState, useMemo } from 'react';
import Link from 'next/link';
import { useLeagueSeason, leagueSeasonQuery } from '@/app/lib/league-season-context';

// ── Types ──────────────────────────────────────────────────────────────────────

interface Team {
  _id: string;
  nickname: string;
  location?: string;
}

interface DailyStats {
  ab?: number;
  h?: number;
  '2b'?: number;
  '3b'?: number;
  hr?: number;
  bb?: number;
  hbp?: number;
  sb?: number;
  cs?: number;
  e?: number;
  abl_points?: number;
}

interface PlayerEntry {
  _id?: string;
  name: string;
  position?: string;
  playedPosition?: string;
  lineupOrder?: number;
  ablPlayedType?: string;
  mlbTeam?: string;
  dailyStats?: DailyStats;
}

interface TeamScore {
  abl_runs?: number;
  final?: number;
}

interface GameRoster {
  homeTeam: PlayerEntry[];
  awayTeam: PlayerEntry[];
  home_score: { regulation: TeamScore; final: TeamScore };
  away_score: { regulation: TeamScore; final: TeamScore };
  result?: {
    winner: Team;
    loser: Team;
    isFinal?: boolean;
  };
  status: string;
}

interface GameSummary {
  _id: string;
  gameDate: string;
  homeTeam: Team;
  awayTeam: Team;
  result?: { isFinal?: boolean };
}

interface RevealSlot {
  order: number;
  home: PlayerEntry | null;
  away: PlayerEntry | null;
}

// ── Helpers ────────────────────────────────────────────────────────────────────

function getStars(abl_points: number, ab: number): number {
  if (!ab) return 3;
  const score = abl_points / ab - 4.5;
  if (score < -3) return 0;
  if (score < -1.5) return 1;
  if (score < 0) return 2;
  if (score < 1.5) return 3;
  if (score < 3) return 4;
  return 5;
}

const STAR_COLOR  = ['text-red-500',   'text-red-400',    'text-orange-400', 'text-gray-400',  'text-lime-500',    'text-emerald-500'  ];
const CARD_STYLE  = ['bg-red-50 border-red-200',   'bg-red-50 border-red-200',   'bg-orange-50 border-orange-200',
                     'bg-gray-50 border-gray-200',  'bg-lime-50 border-lime-200',  'bg-emerald-50 border-emerald-200'];

function statLine(p: PlayerEntry): string {
  const s = p.dailyStats;
  if (!s || (s.ab == null && !s.h)) return 'DNP';
  const ab = s.ab ?? 0;
  if (ab === 0) return 'PA only';
  const hits = `${s.h ?? 0}-${ab}`;
  const extras: string[] = [];
  if (s['2b'])  extras.push(`${s['2b']}2B`);
  if (s['3b'])  extras.push(`${s['3b']}3B`);
  if (s.hr)     extras.push(`${s.hr}HR`);
  if (s.bb)     extras.push(`${s.bb}BB`);
  if (s.sb)     extras.push(`${s.sb}SB`);
  if (s.e)      extras.push(`${s.e}E`);
  return extras.length ? `${hits}, ${extras.join(' ')}` : hits;
}

function getAblRuns(score: any): number | null {
  if (!score) return null;
  if (typeof score.abl_runs === 'number') return score.abl_runs;
  if (typeof score.final === 'number') return score.final;
  if (typeof score === 'number') return score;
  return null;
}

// ── Sub-components ─────────────────────────────────────────────────────────────

function StarDisplay({ stars }: { stars: number }) {
  return (
    <div className={`flex gap-0.5 justify-center ${STAR_COLOR[stars]}`}>
      {[1, 2, 3, 4, 5].map(i => (
        <svg key={i} width="13" height="13" viewBox="0 0 24 24"
             fill={i <= stars ? 'currentColor' : 'none'}
             stroke="currentColor" strokeWidth="2">
          <polygon points="12 2 15.09 8.26 22 9.27 17 14.14 18.18 21.02 12 17.77 5.82 21.02 7 14.14 2 9.27 8.91 8.26 12 2"/>
        </svg>
      ))}
    </div>
  );
}

function PlayerCard({ player, revealed, align }: { player: PlayerEntry | null; revealed: boolean; align: 'left' | 'right' }) {
  const isRight = align === 'right';

  if (!player) {
    return <div className="flex-1 rounded-lg border border-dashed border-gray-200 bg-gray-50 min-h-[90px]"/>;
  }

  if (!revealed) {
    return (
      <div className="flex-1 rounded-lg border border-gray-200 bg-gray-100 min-h-[90px] flex flex-col items-center justify-center gap-1">
        <span className="text-2xl">🎭</span>
        <span className="text-xs text-gray-400 tracking-widest">???</span>
      </div>
    );
  }

  const stars = getStars(player.dailyStats?.abl_points ?? 0, player.dailyStats?.ab ?? 0);
  const cardClass = CARD_STYLE[stars];
  const ablPoints = player.dailyStats?.abl_points;
  const ab        = player.dailyStats?.ab ?? 0;
  const ablScore  = ab > 0 ? ((ablPoints ?? 0) / ab - 4.5) : null;

  return (
    <div className={`flex-1 rounded-lg border p-3 flex flex-col gap-1 min-h-[90px] ${cardClass} ${isRight ? 'items-end text-right' : 'items-start text-left'}`}>
      <div className="font-semibold text-sm text-gray-900 leading-tight">{player.name}</div>
      <div className="text-[11px] text-gray-500">
        {[player.mlbTeam, player.playedPosition || player.position].filter(Boolean).join(' · ')}
      </div>
      <div className="text-[11px] font-mono text-gray-700">{statLine(player)}</div>
      <div className={`flex items-center gap-2 ${isRight ? 'flex-row-reverse' : ''}`}>
        <StarDisplay stars={stars} />
        <span className="text-[10px] text-gray-500 tabular-nums">
          {ablScore !== null ? `${ablScore.toFixed(2)} ABL` : '—'}
          {ablPoints != null ? ` · ${ablPoints.toFixed(1)}pts` : ''}
        </span>
      </div>
    </div>
  );
}

// ── Page ───────────────────────────────────────────────────────────────────────

export default function DramaModePage() {
  const ctx = useLeagueSeason();
  const { league, season } = ctx;

  const [bootstrapping, setBootstrapping] = useState(true);
  const [bootstrapError, setBootstrapError] = useState<string | null>(null);
  const [myTeamId, setMyTeamId] = useState<string | null>(null);
  const [games, setGames] = useState<GameSummary[]>([]);
  const [selectedGameId, setSelectedGameId] = useState<string | null>(null);

  const [gameLoading, setGameLoading] = useState(false);
  const [game, setGame] = useState<GameSummary | null>(null);
  const [roster, setRoster] = useState<GameRoster | null>(null);

  const [revealedCount, setRevealedCount] = useState(0);
  const [scoreRevealed, setScoreRevealed] = useState(false);

  // Bootstrap: find user's team and their completed games
  useEffect(() => {
    if (!league || !season) return;
    (async () => {
      try {
        const [myLeaguesRes, gamesRes] = await Promise.all([
          fetch('/api/auth/my-leagues').catch(() => null),
          fetch(`/api/games?view=summary&${leagueSeasonQuery(ctx)}`),
        ]);

        const myLeaguesData = myLeaguesRes?.ok ? await myLeaguesRes.json() : [];
        const myEntry = (Array.isArray(myLeaguesData) ? myLeaguesData : []).find(
          (e: any) => e.league?.slug === league && String(e.season?.year) === String(season)
        );
        const teamId = myEntry?.team?._id ?? null;
        setMyTeamId(teamId);

        if (teamId && gamesRes.ok) {
          const allGames: GameSummary[] = await gamesRes.json();
          const myGames = allGames
            .filter(g =>
              (g.homeTeam._id === teamId || g.awayTeam._id === teamId) &&
              g.result != null &&
              g.result.isFinal !== false
            )
            .sort((a, b) => new Date(b.gameDate).getTime() - new Date(a.gameDate).getTime());
          setGames(myGames);
          if (myGames.length > 0) setSelectedGameId(myGames[0]._id);
        }
      } catch {
        setBootstrapError('Failed to load games');
      } finally {
        setBootstrapping(false);
      }
    })();
  }, [league, season]); // eslint-disable-line react-hooks/exhaustive-deps

  // Fetch selected game's rosters
  useEffect(() => {
    if (!selectedGameId) return;
    setGameLoading(true);
    setRevealedCount(0);
    setScoreRevealed(false);
    setGame(null);
    setRoster(null);

    Promise.all([
      fetch(`/api/games/${selectedGameId}`),
      fetch(`/api/games/${selectedGameId}/rosters`),
    ]).then(async ([gRes, rRes]) => {
      if (gRes.ok) setGame(await gRes.json());
      if (rRes.ok) setRoster(await rRes.json());
    }).finally(() => setGameLoading(false));
  }, [selectedGameId]);

  // Build ordered reveal slots (zip home + away by lineup order)
  const slots: RevealSlot[] = useMemo(() => {
    if (!roster) return [];
    const sort = (ps: PlayerEntry[]) =>
      ps
        .filter(p => p.ablPlayedType === 'STARTER' || p.ablPlayedType === 'SUB')
        .sort((a, b) => (a.lineupOrder ?? 99) - (b.lineupOrder ?? 99));
    const home = sort(roster.homeTeam);
    const away = sort(roster.awayTeam);
    const len = Math.max(home.length, away.length);
    return Array.from({ length: len }, (_, i) => ({
      order: home[i]?.lineupOrder ?? away[i]?.lineupOrder ?? i + 1,
      home: home[i] ?? null,
      away: away[i] ?? null,
    }));
  }, [roster]);

  const allRevealed = revealedCount >= slots.length && slots.length > 0;

  // Running score from revealed slots only (raw pts/AB - 4.5, no HTA/error adjustments)
  const runningScores = useMemo(() => {
    const compute = (getter: (s: RevealSlot) => PlayerEntry | null) => {
      let pts = 0, ab = 0;
      for (let i = 0; i < revealedCount && i < slots.length; i++) {
        const p = getter(slots[i]);
        if (p?.dailyStats) {
          pts += p.dailyStats.abl_points ?? 0;
          ab  += p.dailyStats.ab ?? 0;
        }
      }
      return ab > 0 ? pts / ab - 4.5 : null;
    };
    return { away: compute(s => s.away), home: compute(s => s.home) };
  }, [slots, revealedCount]);

  // ── Early exit states ──────────────────────────────────────────────────────

  if (bootstrapping) {
    return (
      <div className="flex items-center justify-center py-20 text-gray-400 text-sm">Loading…</div>
    );
  }

  if (bootstrapError) {
    return (
      <div className="max-w-lg mx-auto px-4 py-12 text-center text-red-500">{bootstrapError}</div>
    );
  }

  if (!myTeamId || games.length === 0) {
    return (
      <div className="max-w-lg mx-auto px-4 py-12 text-center">
        <div className="text-4xl mb-4">🎭</div>
        <h2 className="text-xl font-bold text-gray-800 mb-2">Drama Mode</h2>
        <p className="text-gray-500 text-sm">
          {!myTeamId ? 'You need a team to use Drama Mode.' : 'No completed games yet — check back after your first game.'}
        </p>
        <Link href={`/${league}/${season}`} className="mt-5 inline-block text-sm text-blue-600 hover:underline">← Back to dashboard</Link>
      </div>
    );
  }

  // ── Derived display values ─────────────────────────────────────────────────

  const homeScore = getAblRuns(roster?.home_score?.final);
  const awayScore = getAblRuns(roster?.away_score?.final);
  const winnerId  = roster?.result?.winner?._id;
  const iWon      = !!myTeamId && winnerId === myTeamId;

  const gameLabel = (g: GameSummary) => {
    if (!myTeamId) return '';
    const isHome = g.homeTeam._id === myTeamId;
    const opp    = isHome ? g.awayTeam : g.homeTeam;
    const date   = new Date(g.gameDate).toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
    return `${date} — ${isHome ? 'vs' : '@'} ${opp.location ?? ''} ${opp.nickname}`.trim();
  };

  // ── Render ─────────────────────────────────────────────────────────────────

  return (
    <div className="max-w-2xl mx-auto px-4 py-6">
      {/* Header */}
      <div className="flex items-center gap-3 mb-6">
        <Link
          href={`/${league}/${season}`}
          className="p-1.5 text-gray-500 hover:text-blue-600 rounded-lg hover:bg-gray-100 transition-colors"
          aria-label="Back to dashboard"
        >
          <svg xmlns="http://www.w3.org/2000/svg" width="20" height="20" viewBox="0 0 20 20" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
            <path d="M12 4l-6 6 6 6"/>
          </svg>
        </Link>
        <div>
          <h1 className="text-xl font-bold text-gray-900">🎭 Drama Mode</h1>
          <p className="text-xs text-gray-400 mt-0.5">Reveal your game results one position at a time</p>
        </div>
      </div>

      {/* Game selector */}
      <div className="mb-6">
        <select
          value={selectedGameId ?? ''}
          onChange={e => setSelectedGameId(e.target.value)}
          className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm bg-white focus:outline-none focus:ring-2 focus:ring-blue-400"
        >
          {games.map(g => (
            <option key={g._id} value={g._id}>{gameLabel(g)}</option>
          ))}
        </select>
      </div>

      {gameLoading && (
        <div className="text-center py-16 text-gray-400 text-sm">Loading game…</div>
      )}

      {!gameLoading && game && roster && (
        <>
          {/* Matchup header card */}
          <div className="bg-white rounded-xl border border-gray-200 p-4 mb-4 text-center shadow-sm">
            <div className="text-xs text-gray-400 mb-3">
              {new Date(game.gameDate).toLocaleDateString('en-US', { weekday: 'long', month: 'long', day: 'numeric' })}
            </div>
            <div className="flex items-center justify-center gap-6">
              {/* Away team */}
              <div className="text-center min-w-0">
                <div className="font-bold text-gray-800 truncate">{game.awayTeam.location}</div>
                <div className="text-sm text-gray-500 truncate">{game.awayTeam.nickname}</div>
                {scoreRevealed ? (
                  <div className={`text-3xl font-black mt-1 tabular-nums ${winnerId === game.awayTeam._id ? 'text-green-600' : 'text-gray-400'}`}>
                    {awayScore?.toFixed(2) ?? '—'}
                  </div>
                ) : revealedCount > 0 && runningScores.away !== null ? (
                  <div className="text-xl font-bold mt-1 tabular-nums text-gray-600">
                    {runningScores.away.toFixed(2)}
                    <span className="text-xs font-normal text-gray-400 ml-1">so far</span>
                  </div>
                ) : null}
              </div>

              <div className="text-xl text-gray-300 font-bold shrink-0">@</div>

              {/* Home team */}
              <div className="text-center min-w-0">
                <div className="font-bold text-gray-800 truncate">{game.homeTeam.location}</div>
                <div className="text-sm text-gray-500 truncate">{game.homeTeam.nickname}</div>
                {scoreRevealed ? (
                  <div className={`text-3xl font-black mt-1 tabular-nums ${winnerId === game.homeTeam._id ? 'text-green-600' : 'text-gray-400'}`}>
                    {homeScore?.toFixed(2) ?? '—'}
                  </div>
                ) : revealedCount > 0 && runningScores.home !== null ? (
                  <div className="text-xl font-bold mt-1 tabular-nums text-gray-600">
                    {runningScores.home.toFixed(2)}
                    <span className="text-xs font-normal text-gray-400 ml-1">so far</span>
                  </div>
                ) : null}
              </div>
            </div>
            {scoreRevealed && roster.result?.winner && (
              <div className={`mt-3 text-sm font-semibold ${iWon ? 'text-green-600' : 'text-red-500'}`}>
                {iWon
                  ? '🎉 Your team wins!'
                  : `${roster.result.winner.location ?? ''} ${roster.result.winner.nickname} wins`}
              </div>
            )}
          </div>

          {/* Action button — anchored at top above the slots */}
          <div className="flex flex-col items-center gap-2 mb-5">
            {!allRevealed && (
              <button
                onClick={() => setRevealedCount(c => c + 1)}
                className="bg-blue-600 hover:bg-blue-700 active:scale-95 text-white font-semibold px-8 py-3 rounded-xl shadow transition-all"
              >
                Reveal Slot {revealedCount + 1} of {slots.length}
              </button>
            )}
            {allRevealed && !scoreRevealed && (
              <button
                onClick={() => setScoreRevealed(true)}
                className="bg-purple-600 hover:bg-purple-700 active:scale-95 text-white font-semibold px-8 py-3 rounded-xl shadow transition-all"
              >
                🎭 Reveal Final Score
              </button>
            )}
            {allRevealed && scoreRevealed && (
              <p className="text-sm text-gray-500">{iWon ? '🏆 Great game!' : '💪 Better luck next time!'}</p>
            )}
            {!allRevealed && revealedCount > 0 && (
              <button
                onClick={() => { setRevealedCount(slots.length); setScoreRevealed(true); }}
                className="text-xs text-gray-400 hover:text-gray-600 underline"
              >
                Reveal all
              </button>
            )}
          </div>

          {/* Column labels */}
          <div className="grid grid-cols-[1fr_1.5rem_1fr] gap-3 mb-2 px-1">
            <div className="text-xs font-semibold text-gray-500 text-center truncate">{game.awayTeam.nickname}</div>
            <div />
            <div className="text-xs font-semibold text-gray-500 text-center truncate">{game.homeTeam.nickname}</div>
          </div>

          {/* Reveal slots */}
          <div className="flex flex-col gap-2">
            {slots.map((slot, i) => {
              const revealed = i < revealedCount;
              const isNext   = i === revealedCount;
              return (
                <div
                  key={i}
                  className={`grid grid-cols-[1fr_1.5rem_1fr] gap-3 items-center transition-opacity duration-300 ${
                    !revealed && !isNext ? 'opacity-25' : ''
                  }`}
                >
                  <PlayerCard player={slot.away} revealed={revealed} align="left" />
                  <div className={`flex items-center justify-center rounded-full w-6 h-6 text-[10px] font-bold shrink-0 ${
                    isNext    ? 'bg-blue-100 text-blue-600' :
                    revealed  ? 'bg-gray-100 text-gray-400' :
                               'text-gray-200'
                  }`}>
                    {slot.order}
                  </div>
                  <PlayerCard player={slot.home} revealed={revealed} align="right" />
                </div>
              );
            })}
          </div>
        </>
      )}
    </div>
  );
}
