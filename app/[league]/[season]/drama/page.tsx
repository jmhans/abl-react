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
  lineupPosition?: string;
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
  homeSubs: PlayerEntry[];
  away: PlayerEntry | null;
  awaySubs: PlayerEntry[];
  isExtra?: boolean;
}

// ── Helpers ────────────────────────────────────────────────────────────────────

function getStars(abl_points: number, ab: number): number {
  if (!ab) return 2;
  const x = abl_points / ab - 4.5;
  if (x < -2) return 0;
  if (x <  0) return 1;
  if (x <  3) return 2;
  if (x <  5) return 3;
  if (x <  8) return 4;
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

function PlayerCard({ player, revealed, align, isSupp = false }: {
  player: PlayerEntry | null;
  revealed: boolean;
  align: 'left' | 'right';
  isSupp?: boolean;
}) {
  const isRight = align === 'right';

  if (!player) {
    if (isSupp) return null;
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
  const cardClass = isSupp
    ? 'bg-white border-gray-200'
    : CARD_STYLE[stars];
  const ablPoints = player.dailyStats?.abl_points;
  const ab        = player.dailyStats?.ab ?? 0;
  const ablScore  = ab > 0 ? ((ablPoints ?? 0) / ab - 4.5) : null;

  const posMeta = player.mlbTeam ?? '';
  const suppBadge = isSupp ? 'supp' : (player.playedPosition || player.position);
  const meta = [posMeta, suppBadge].filter(Boolean).join(' · ');

  return (
    <div className={`rounded-lg border px-2.5 py-1.5 flex flex-col gap-0.5 ${cardClass} ${isRight ? 'items-end text-right' : 'items-start text-left'} ${isSupp ? 'opacity-80' : ''}`}>
      {/* Line 1: name · team/pos */}
      <div className={`flex items-baseline gap-1.5 flex-wrap ${isRight ? 'flex-row-reverse justify-start' : ''}`}>
        <span className={`font-semibold leading-tight text-gray-900 ${isSupp ? 'text-xs' : 'text-sm'}`}>{player.name}</span>
        {meta && <span className="text-[10px] text-gray-400 leading-tight shrink-0">{meta}</span>}
      </div>
      {/* Line 2: stat line + pts + stars */}
      <div className={`flex items-center gap-2 flex-wrap ${isRight ? 'flex-row-reverse' : ''}`}>
        <span className="text-[11px] font-mono text-gray-700">{statLine(player)}</span>
        <span className="text-[10px] text-gray-500 tabular-nums">
          {ablScore !== null ? `${ablScore.toFixed(2)}` : '—'}
          {ablPoints != null ? ` · ${ablPoints.toFixed(1)}pts` : ''}
        </span>
        {!isSupp && <StarDisplay stars={stars} />}
      </div>
    </div>
  );
}

function PlayerSlotCell({ main, subs, revealed, align }: {
  main: PlayerEntry | null;
  subs: PlayerEntry[];
  revealed: boolean;
  align: 'left' | 'right';
}) {
  return (
    <div className="flex-1 flex flex-col gap-1 min-w-0">
      <PlayerCard player={main} revealed={revealed} align={align} />
      {revealed && subs.map((sub, i) => (
        <div key={i} className={align === 'right' ? 'pr-3' : 'pl-3'}>
          <PlayerCard player={sub} revealed={revealed} align={align} isSupp />
        </div>
      ))}
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
  const [selectorOpen, setSelectorOpen] = useState(false);

  const [gameLoading, setGameLoading] = useState(false);
  const [game, setGame] = useState<GameSummary | null>(null);
  const [roster, setRoster] = useState<GameRoster | null>(null);

  const [revealedCount, setRevealedCount] = useState(0);
  const [regulationRevealed, setRegulationRevealed] = useState(false);
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
    setRegulationRevealed(false);
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

  // Build ordered reveal slots: STARTERs with their SUBs folded in, then XTRA
  const slots: RevealSlot[] = useMemo(() => {
    if (!roster) return [];

    // Returns starters sorted by lineupOrder, each paired with their subs (same lineupPosition)
    const buildMainSlots = (players: PlayerEntry[]) => {
      const starters = [...players.filter(p => p.ablPlayedType === 'STARTER')]
        .sort((a, b) => (a.lineupOrder ?? 99) - (b.lineupOrder ?? 99));
      const subs = players.filter(p => p.ablPlayedType === 'SUB');
      return starters.map(s => ({
        player: s,
        subs: subs.filter(sub => sub.lineupPosition === s.lineupPosition),
      }));
    };

    const homeMain = buildMainSlots(roster.homeTeam);
    const awayMain = buildMainSlots(roster.awayTeam);

    const byOrder = (ps: PlayerEntry[]) =>
      [...ps].sort((a, b) => (a.lineupOrder ?? 99) - (b.lineupOrder ?? 99));
    const homeXtra = byOrder(roster.homeTeam.filter(p => p.ablPlayedType === 'XTRA'));
    const awayXtra = byOrder(roster.awayTeam.filter(p => p.ablPlayedType === 'XTRA'));

    const mainSlots: RevealSlot[] = Array.from(
      { length: Math.max(homeMain.length, awayMain.length) },
      (_, i) => ({
        order: homeMain[i]?.player.lineupOrder ?? awayMain[i]?.player.lineupOrder ?? i + 1,
        home:     homeMain[i]?.player ?? null,
        homeSubs: homeMain[i]?.subs   ?? [],
        away:     awayMain[i]?.player ?? null,
        awaySubs: awayMain[i]?.subs   ?? [],
        isExtra: false,
      })
    );

    const xtraSlots: RevealSlot[] = Array.from(
      { length: Math.max(homeXtra.length, awayXtra.length) },
      (_, i) => ({
        order: homeXtra[i]?.lineupOrder ?? awayXtra[i]?.lineupOrder ?? i + 1,
        home:     homeXtra[i] ?? null,
        homeSubs: [],
        away:     awayXtra[i] ?? null,
        awaySubs: [],
        isExtra: true,
      })
    );

    return [...mainSlots, ...xtraSlots];
  }, [roster]);

  // mainSlotCount is the index where extras begin (or total length if no extras)
  const mainSlotCount = useMemo(() => {
    const idx = slots.findIndex(s => s.isExtra);
    return idx === -1 ? slots.length : idx;
  }, [slots]);
  const hasExtras = useMemo(() => slots.some(s => s.isExtra), [slots]);

  const allMainRevealed = mainSlotCount > 0 && revealedCount >= mainSlotCount;
  const allRevealed = revealedCount >= slots.length && slots.length > 0;

  // Only render extra slots after regulation is revealed
  const visibleSlots = regulationRevealed ? slots : slots.slice(0, mainSlotCount);

  // Running score from revealed slots only. Home team always gets +0.5 HFA.
  // Includes subs since they're revealed alongside their starter.
  const runningScores = useMemo(() => {
    const compute = (main: (s: RevealSlot) => PlayerEntry | null, subs: (s: RevealSlot) => PlayerEntry[]) => {
      let pts = 0, ab = 0;
      for (let i = 0; i < revealedCount && i < slots.length; i++) {
        for (const p of [main(slots[i]), ...subs(slots[i])]) {
          if (p?.dailyStats) {
            pts += p.dailyStats.abl_points ?? 0;
            ab  += p.dailyStats.ab ?? 0;
          }
        }
      }
      return ab > 0 ? pts / ab - 4.5 : null;
    };
    const homeRaw = compute(s => s.home, s => s.homeSubs);
    return {
      away: compute(s => s.away, s => s.awaySubs),
      home: homeRaw !== null ? homeRaw + 0.5 : null,
    };
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
    <div className="max-w-2xl mx-auto px-4 py-3">
      {/* Compact top bar: back · title · change-game */}
      <div className="flex items-center gap-2 mb-3">
        <Link
          href={`/${league}/${season}`}
          className="p-1.5 text-gray-500 hover:text-blue-600 rounded-lg hover:bg-gray-100 transition-colors shrink-0"
          aria-label="Back to dashboard"
        >
          <svg xmlns="http://www.w3.org/2000/svg" width="18" height="18" viewBox="0 0 20 20" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
            <path d="M12 4l-6 6 6 6"/>
          </svg>
        </Link>
        <span className="font-bold text-gray-900 text-base">🎭 Drama Mode</span>
        <div className="flex-1"/>
        <button
          onClick={() => setSelectorOpen(o => !o)}
          className="text-xs text-blue-500 hover:text-blue-700 border border-blue-200 hover:border-blue-400 rounded-lg px-2.5 py-1 transition-colors shrink-0"
        >
          {selectorOpen ? 'Cancel' : 'Change game'}
        </button>
      </div>

      {/* Collapsible game selector */}
      {selectorOpen && (
        <div className="mb-3">
          <select
            value={selectedGameId ?? ''}
            onChange={e => { setSelectedGameId(e.target.value); setSelectorOpen(false); }}
            className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm bg-white focus:outline-none focus:ring-2 focus:ring-blue-400"
            autoFocus
          >
            {games.map(g => (
              <option key={g._id} value={g._id}>{gameLabel(g)}</option>
            ))}
          </select>
        </div>
      )}

      {gameLoading && (
        <div className="text-center py-16 text-gray-400 text-sm">Loading game…</div>
      )}

      {!gameLoading && game && roster && (
        <>
          {/* Single-line matchup bar */}
          <div className="bg-white rounded-xl border border-gray-200 px-4 py-2.5 mb-3 shadow-sm">
            <div className="flex items-center gap-2 min-w-0">
              {/* Away */}
              <span className={`font-semibold text-sm truncate flex-1 text-right ${winnerId === game.awayTeam._id && scoreRevealed ? 'text-green-600' : 'text-gray-800'}`}>
                {game.awayTeam.nickname}
              </span>
              {/* Away score */}
              <span className={`tabular-nums font-black text-lg shrink-0 w-14 text-center ${winnerId === game.awayTeam._id && scoreRevealed ? 'text-green-600' : 'text-gray-700'}`}>
                {scoreRevealed
                  ? (awayScore?.toFixed(2) ?? '—')
                  : runningScores.away !== null
                    ? runningScores.away.toFixed(2)
                    : '—'}
              </span>
              {/* Divider */}
              <span className="text-gray-300 font-bold shrink-0">·</span>
              {/* Home score */}
              <span className={`tabular-nums font-black text-lg shrink-0 w-14 text-center ${winnerId === game.homeTeam._id && scoreRevealed ? 'text-green-600' : 'text-gray-700'}`}>
                {scoreRevealed
                  ? (homeScore?.toFixed(2) ?? '—')
                  : runningScores.home !== null
                    ? runningScores.home.toFixed(2)
                    : '—'}
              </span>
              {/* Home */}
              <span className={`font-semibold text-sm truncate flex-1 ${winnerId === game.homeTeam._id && scoreRevealed ? 'text-green-600' : 'text-gray-800'}`}>
                {game.homeTeam.nickname}
              </span>
            </div>
            {/* Win/loss result + date on second micro-line */}
            <div className="flex items-center justify-between mt-0.5">
              <span className="text-[10px] text-gray-400">
                {new Date(game.gameDate).toLocaleDateString('en-US', { month: 'short', day: 'numeric' })}
                {!scoreRevealed && revealedCount > 0 && <span className="ml-1 italic">in progress…</span>}
              </span>
              {scoreRevealed && roster.result?.winner && (
                <span className={`text-[11px] font-semibold ${iWon ? 'text-green-600' : 'text-red-500'}`}>
                  {iWon ? '🎉 You win!' : `${roster.result.winner.nickname} wins`}
                </span>
              )}
            </div>
          </div>

          {/* Action button — anchored at top above the slots */}
          <div className="flex flex-col items-center gap-2 mb-5">
            {/* Still revealing main slots */}
            {!allMainRevealed && (
              <button
                onClick={() => setRevealedCount(c => c + 1)}
                className="bg-blue-600 hover:bg-blue-700 active:scale-95 text-white font-semibold px-8 py-3 rounded-xl shadow transition-all"
              >
                Reveal Slot {revealedCount + 1} of {mainSlotCount}
              </button>
            )}
            {/* All main slots done — reveal regulation score */}
            {allMainRevealed && !regulationRevealed && (
              <button
                onClick={() => setRegulationRevealed(true)}
                className="bg-indigo-600 hover:bg-indigo-700 active:scale-95 text-white font-semibold px-8 py-3 rounded-xl shadow transition-all"
              >
                📊 Reveal Regulation Score
              </button>
            )}
            {/* Revealing extra innings slots */}
            {regulationRevealed && !allRevealed && (
              <button
                onClick={() => setRevealedCount(c => c + 1)}
                className="bg-amber-500 hover:bg-amber-600 active:scale-95 text-white font-semibold px-8 py-3 rounded-xl shadow transition-all"
              >
                Reveal Extra Slot {revealedCount - mainSlotCount + 1} of {slots.length - mainSlotCount}
              </button>
            )}
            {/* All slots done — reveal final score */}
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
                onClick={() => { setRevealedCount(slots.length); setRegulationRevealed(true); setScoreRevealed(true); }}
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
            {visibleSlots.map((slot, i) => {
              const revealed   = i < revealedCount;
              const isNext     = i === revealedCount;
              const firstExtra = slot.isExtra && (i === 0 || !visibleSlots[i - 1].isExtra);
              return (
                <div key={`${slot.order}-${slot.isExtra ? 'x' : 'm'}`}>
                  {firstExtra && (
                    <>
                      <div className="flex items-center justify-center gap-2 my-3 py-2 bg-amber-50 rounded-lg border border-amber-200">
                        <span className="text-amber-600 font-bold text-sm">⚡ Extra Innings!</span>
                      </div>
                      <div className="flex items-center gap-2 mb-2">
                        <div className="flex-1 border-t border-dashed border-amber-300"/>
                        <span className="text-[10px] font-semibold text-amber-500 uppercase tracking-wide whitespace-nowrap">Extra Innings</span>
                        <div className="flex-1 border-t border-dashed border-amber-300"/>
                      </div>
                    </>
                  )}
                  <div
                    className={`grid grid-cols-[1fr_1.5rem_1fr] gap-3 items-center transition-opacity duration-300 ${
                      !revealed && !isNext ? 'opacity-25' : ''
                    }`}
                  >
                    <PlayerSlotCell main={slot.away} subs={slot.awaySubs} revealed={revealed} align="left" />
                    <div className={`flex items-center justify-center rounded-full w-6 h-6 text-[10px] font-bold shrink-0 self-start mt-2 ${
                      isNext && slot.isExtra ? 'bg-amber-100 text-amber-600' :
                      isNext                ? 'bg-blue-100 text-blue-600' :
                      revealed              ? 'bg-gray-100 text-gray-400' :
                                             'text-gray-200'
                    }`}>
                      {slot.order}
                    </div>
                    <PlayerSlotCell main={slot.home} subs={slot.homeSubs} revealed={revealed} align="right" />
                  </div>
                </div>
              );
            })}
          </div>
        </>
      )}
    </div>
  );
}
