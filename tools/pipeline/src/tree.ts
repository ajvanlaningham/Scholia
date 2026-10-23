// Shape of content/openings/<id>/tree.json: the opening's position graph with
// game statistics and evaluations. Research only; nothing here depends on
// which side a course teaches.
import { type Color, sideToMove } from '@scholia/chess-core';
import type { Evaluation } from './evaluation.ts';
import type { Counts, ExplorerDb } from './lichess.ts';

export const edgeId = (from: string, uci: string) => `${from} ${uci}`;

/** Numbered SAN, e.g. "5.Nxf7 Bxf2+ 6.Kxf2" or "4...Bc5 5.d4". */
export function formatLine(startFen: string, sans: string[]): string {
  let moveNo = Number(startFen.split(' ')[5]);
  let white = sideToMove(startFen) === 'white';
  return sans
    .map((san, i) => {
      const text = white ? `${moveNo}.${san}` : i === 0 ? `${moveNo}...${san}` : san;
      if (!white) moveNo++;
      white = !white;
      return text;
    })
    .join(' ');
}

export type EdgeOrigin = 'dataset' | 'explorer' | 'source' | 'lesson';

export interface TreeNode {
  key: string;
  fen: string;
  sideToMove: Color;
  /** SAN moves from the root along the first (shortest) path found. */
  path: string[];
  openings: { eco: string; name: string }[];
  /** Fraction of games from the root that pass through this position, summed over all paths. */
  reach: Record<ExplorerDb, number>;
  games?: Partial<Record<ExplorerDb, Counts>>;
  evaluation?: Evaluation;
}

export interface TreeEdge {
  from: string;
  to: string;
  uci: string;
  san: string;
  /** Numbered line from the root, e.g. "5.Nxf7 Bxf2+ 6.Kxf2". */
  line: string;
  origins: EdgeOrigin[];
  games?: Partial<Record<ExplorerDb, Counts>>;
}

export interface Tree {
  opening: string;
  generatedAt: string;
  root: { approach: string; fen: string; key: string };
  settings: Record<string, unknown>;
  nodes: TreeNode[];
  edges: TreeEdge[];
}
