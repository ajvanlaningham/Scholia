import { engineLine, type Evaluation } from './evaluation.ts';
import { cachedGet } from './http.ts';

export interface Counts {
  white: number;
  draws: number;
  black: number;
}

export interface ExplorerMove extends Counts {
  uci: string;
  san: string;
}

export interface ExplorerResult extends Counts {
  moves: ExplorerMove[];
}

export type ExplorerDb = 'masters' | 'lichess';

// Club-level games, where Scholia's users will actually meet the Traxler.
const LICHESS_SPEEDS = 'blitz,rapid,classical';
const LICHESS_RATINGS = '1400,1600,1800,2000';

export const totalGames = (c: Counts): number => c.white + c.draws + c.black;

/** Requires a Lichess personal API token (no scopes needed). */
export async function explorer(db: ExplorerDb, fen: string, token: string): Promise<ExplorerResult> {
  const params = new URLSearchParams({ fen, moves: '12', topGames: '0', recentGames: '0' });
  if (db === 'lichess') {
    params.set('variant', 'standard');
    params.set('speeds', LICHESS_SPEEDS);
    params.set('ratings', LICHESS_RATINGS);
  }
  const res = await cachedGet(`https://explorer.lichess.ovh/${db}?${params}`, {
    Authorization: `Bearer ${token}`,
  });
  if (res.status !== 200) throw new Error(`Explorer ${db} returned ${res.status} for ${fen}`);
  return JSON.parse(res.body) as ExplorerResult;
}

interface CloudEvalResponse {
  depth: number;
  knodes: number;
  pvs: { moves: string; cp?: number; mate?: number }[];
}

/** Lichess's cached deep evaluations; undefined when the position isn't in the cloud. */
export async function cloudEval(fen: string, multiPv: number): Promise<Evaluation | undefined> {
  const params = new URLSearchParams({ fen, multiPv: String(multiPv) });
  const res = await cachedGet(`https://lichess.org/api/cloud-eval?${params}`);
  if (res.status === 404) return undefined;
  const data = JSON.parse(res.body) as CloudEvalResponse;
  return {
    origin: 'lichess-cloud',
    engine: 'Stockfish (Lichess cloud)',
    depth: data.depth,
    knodes: data.knodes,
    lines: data.pvs.map((pv) => engineLine(fen, pv.moves.split(' '), { cp: pv.cp, mate: pv.mate })),
  };
}
