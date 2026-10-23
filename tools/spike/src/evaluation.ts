import { type Color, playUciLine } from '@scholia/chess-core';

export interface EngineLine {
  uci: string[];
  san: string[];
  /** Centipawns from White's point of view. */
  cp?: number;
  /** Moves to mate; positive means White mates. */
  mate?: number;
}

export interface Evaluation {
  origin: 'lichess-cloud' | 'local-stockfish';
  engine: string;
  depth: number;
  knodes: number;
  lines: EngineLine[];
}

const PV_DISPLAY_PLIES = 10;

/** Lichess's win-chance model, 0–100 from White's point of view. */
export function whiteWinChance(line: EngineLine): number {
  if (line.mate !== undefined) return line.mate > 0 ? 100 : 0;
  return 50 + 50 * (2 / (1 + Math.exp(-0.00368208 * line.cp!)) - 1);
}

export const winChanceFor = (color: Color, line: EngineLine): number =>
  color === 'white' ? whiteWinChance(line) : 100 - whiteWinChance(line);

/**
 * Win chance the mover gives up by playing `uci` instead of the engine's best
 * move. Uses the move's own line from the search before the move when there is
 * one (same search, consistent depth); otherwise the separate evaluation after
 * the move, where small differences are noise.
 */
export function moveLoss(
  mover: Color,
  uci: string,
  before: Evaluation | undefined,
  after: Evaluation | undefined,
): number | undefined {
  const best = before?.lines[0];
  const played = before?.lines.find((l) => l.uci[0] === uci) ?? after?.lines[0];
  if (!best || !played) return undefined;
  return Math.max(0, winChanceFor(mover, best) - winChanceFor(mover, played));
}

/** "+0.97", "−1.20", or "#3" (mate), from White's point of view. */
export function formatScore(line: EngineLine | undefined): string {
  if (!line) return '—';
  if (line.mate !== undefined) return `#${line.mate}`;
  const pawns = line.cp! / 100;
  return `${pawns > 0 ? '+' : ''}${pawns.toFixed(2)}`;
}

export function engineLine(fen: string, uci: string[], score: { cp?: number; mate?: number }): EngineLine {
  const shown = uci.slice(0, PV_DISPLAY_PLIES);
  const moves = playUciLine(fen, shown);
  return { uci: moves.map((m) => m.uci), san: moves.map((m) => m.san), ...score };
}
