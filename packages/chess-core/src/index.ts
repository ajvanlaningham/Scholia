// The single authority for chess rules in Scholia. Nothing else should interpret
// moves or FENs directly; it should go through this package.
import { castlingSide, Chess, normalizeMove } from 'chessops/chess';
import { chessgroundDests } from 'chessops/compat';
import { INITIAL_FEN, makeFen, parseFen } from 'chessops/fen';
import { type Node, parseComment, parsePgn, type PgnNodeData, startingPosition } from 'chessops/pgn';
import { makeSan, parseSan } from 'chessops/san';
import type { Move } from 'chessops/types';
import { kingCastlesTo, makeUci, parseUci } from 'chessops/util';

export const STARTING_FEN = INITIAL_FEN;

export type Color = 'white' | 'black';

export interface PlayedMove {
  /** Standard UCI (castling as king-two-squares, e.g. e1g1). */
  uci: string;
  san: string;
  /** Canonical full FEN after the move. */
  fen: string;
  /** Normalized position key after the move. */
  key: string;
}

function load(fen: string): Chess {
  const setup = parseFen(fen);
  if (setup.isErr) throw new Error(`Invalid FEN "${fen}": ${setup.error.message}`);
  const pos = Chess.fromSetup(setup.value);
  if (pos.isErr) throw new Error(`Illegal position "${fen}": ${pos.error.message}`);
  return pos.value;
}

const fenOf = (pos: Chess): string => makeFen(pos.toSetup());

// toSetup() keeps the en passant square only when an en passant capture is
// actually legal, and the EPD form drops the halfmove/fullmove counters, so
// transpositions reached via different move orders get the same key.
const keyOf = (pos: Chess): string => makeFen(pos.toSetup(), { epd: true });

/**
 * Identity of a position for the knowledge graph: piece placement, side to
 * move, castling rights, and en passant square (only if a capture is legal).
 */
export function positionKey(fen: string): string {
  return keyOf(load(fen));
}

/** Canonical full FEN (normalized en passant square and castling field). */
export function normalizeFen(fen: string): string {
  return fenOf(load(fen));
}

export function sideToMove(fen: string): Color {
  return load(fen).turn;
}

/**
 * Legal destinations per origin square, e.g. Map { "e2" => ["e3", "e4"] }, for
 * a board UI. Castling appears as both king-two-squares and king-onto-rook.
 */
export function legalDests(fen: string): Map<string, string[]> {
  return chessgroundDests(load(fen));
}

// chessops encodes castling internally as king-takes-rook (e1h1); everything
// outside this package uses standard UCI (e1g1).
function standardUci(pos: Chess, move: Move): string {
  const side = castlingSide(pos, move);
  if (side && 'from' in move) {
    return makeUci({ from: move.from, to: kingCastlesTo(pos.turn, side) });
  }
  return makeUci(move);
}

function play(pos: Chess, move: Move): PlayedMove {
  const uci = standardUci(pos, move);
  const san = makeSan(pos, move);
  pos.play(move);
  return { uci, san, fen: fenOf(pos), key: keyOf(pos) };
}

function parseLegalUci(pos: Chess, uci: string): Move {
  const parsed = parseUci(uci);
  const move = parsed && normalizeMove(pos, parsed);
  if (!move || !pos.isLegal(move)) throw new Error(`Illegal move ${uci} in "${fenOf(pos)}"`);
  return move;
}

function parseLegalSan(pos: Chess, san: string): Move {
  const move = parseSan(pos, san);
  if (!move) throw new Error(`Illegal move ${san} in "${fenOf(pos)}"`);
  return move;
}

export function playUci(fen: string, uci: string): PlayedMove {
  const pos = load(fen);
  return play(pos, parseLegalUci(pos, uci));
}

export function playSan(fen: string, san: string): PlayedMove {
  const pos = load(fen);
  return play(pos, parseLegalSan(pos, san));
}

/** Plays a sequence of UCI moves (e.g. an engine principal variation). */
export function playUciLine(fen: string, ucis: readonly string[]): PlayedMove[] {
  const pos = load(fen);
  return ucis.map((uci) => play(pos, parseLegalUci(pos, uci)));
}

export function playSanLine(fen: string, sans: readonly string[]): PlayedMove[] {
  const pos = load(fen);
  return sans.map((san) => play(pos, parseLegalSan(pos, san)));
}

function startOf(headers: Map<string, string>): Chess {
  const start = startingPosition(headers);
  if (start.isErr) throw new Error(`Invalid PGN starting position: ${start.error.message}`);
  if (!(start.value instanceof Chess)) throw new Error('Only standard chess is supported');
  return start.value;
}

/**
 * Plays the mainline of a single PGN game (movetext alone is fine, e.g.
 * "1. e4 e5 2. Nf3"). Honors a FEN header. Variations are ignored.
 */
export function playPgnMainline(pgn: string): { startFen: string; moves: PlayedMove[] } {
  const [game] = parsePgn(pgn);
  if (!game) throw new Error('PGN contains no game');
  const pos = startOf(game.headers);
  const startFen = fenOf(pos);
  const moves = [...game.moves.mainline()].map(({ san }) => play(pos, parseLegalSan(pos, san)));
  return { startFen, moves };
}

export interface AnnotatedMove extends PlayedMove {
  /** Position key before the move. */
  fromKey: string;
  /** SAN moves from the game's starting position up to and including this one. */
  path: string[];
  /** Comment text before and after the move, with [%cal]/[%csl]/[%eval] and other [%…] commands removed. */
  comments: string[];
  /** Move and position assessments, e.g. "!", "?!", "±". */
  symbols: string[];
  /** On the game's main line rather than in a variation. */
  mainline: boolean;
}

export interface AnnotatedGame {
  headers: Record<string, string>;
  startFen: string;
  startKey: string;
  /** Comments before the first move, e.g. a study chapter's introduction. */
  intro: string[];
  /** Every move in every variation, in depth-first order. */
  moves: AnnotatedMove[];
}

const NAG_SYMBOLS: Record<number, string> = {
  1: '!', 2: '?', 3: '!!', 4: '??', 5: '!?', 6: '?!', 7: '□',
  10: '=', 13: '∞', 14: '⩲', 15: '⩱', 16: '±', 17: '∓', 18: '+−', 19: '−+',
  22: '⨀', 23: '⨀', 32: '⟳', 33: '⟳', 36: '→', 37: '→', 40: '↑', 41: '↑', 132: '⇆', 133: '⇆',
};

// parseComment knows the board commands; others, like Lichess's [%anno "Author", id]
// co-author tag, are dropped here.
const commentText = (comments: string[] | undefined): string[] =>
  (comments ?? [])
    .map((c) => parseComment(c).text.replace(/\[%\w+[^\]]*\]/g, '').trim())
    .filter((c) => c.length > 0);

function walk(node: Node<PgnNodeData>, pos: Chess, path: string[], out: AnnotatedMove[], mainline = true): void {
  for (const [index, child] of node.children.entries()) {
    const next = pos.clone();
    const fromKey = keyOf(next);
    const played = play(next, parseLegalSan(next, child.data.san));
    const childPath = [...path, played.san];
    out.push({
      ...played,
      fromKey,
      path: childPath,
      comments: [...commentText(child.data.startingComments), ...commentText(child.data.comments)],
      symbols: (child.data.nags ?? []).map((nag) => NAG_SYMBOLS[nag] ?? `$${nag}`),
      mainline: mainline && index === 0,
    });
    walk(child, next, childPath, out, mainline && index === 0);
  }
}

/** Parses every game in a PGN, including all variations, comments, and NAGs. */
export function parseAnnotatedPgn(pgn: string): AnnotatedGame[] {
  return parsePgn(pgn).map((game) => {
    const pos = startOf(game.headers);
    const moves: AnnotatedMove[] = [];
    walk(game.moves, pos, [], moves);
    return {
      headers: Object.fromEntries(game.headers),
      startFen: fenOf(pos),
      startKey: keyOf(pos),
      intro: commentText(game.comments),
      moves,
    };
  });
}
