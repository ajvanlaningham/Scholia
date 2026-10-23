// Shape of content/traxler/tree.json, shared by the spike scripts.
import { join } from 'node:path';
import { type Color, sideToMove } from '@scholia/chess-core';
import type { Evaluation } from './evaluation.ts';
import { CONTENT_DIR } from './http.ts';
import type { Counts, ExplorerDb } from './lichess.ts';

export const TRAXLER_DIR = join(CONTENT_DIR, 'traxler');
export const TRAXLER_ROOT_PGN = '1. e4 e5 2. Nf3 Nc6 3. Bc4 Nf6 4. Ng5 Bc5';

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

export interface SourceRef {
  kind: 'book' | 'wiki' | 'study' | 'article' | 'web' | 'personal';
  title: string;
  author?: string;
  url?: string;
  /** Page, chapter, or section within the source. */
  locator?: string;
  /** Revision or edition, e.g. a wiki revision ID. */
  revision?: string;
  license?: string;
}

export interface Explanation {
  status: 'missing' | 'drafted' | 'reviewed';
  form?: 'quote' | 'paraphrase' | 'model-summary' | 'personal-note';
  text: string | null;
  sources: SourceRef[];
  notes?: string;
}

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
  /** The slot to fill: why this move is played, or why it fails. */
  explanation: Explanation;
}

export interface Tree {
  opening: string;
  generatedAt: string;
  root: { approach: string; fen: string; key: string };
  settings: Record<string, unknown>;
  nodes: TreeNode[];
  edges: TreeEdge[];
  /** Filled explanations whose move is no longer in the tree; kept so nothing is lost. */
  orphanedExplanations: { from: string; uci: string; line: string; explanation: Explanation }[];
}
