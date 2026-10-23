// Commentary gathered from published sources, each piece anchored to the move it
// discusses. Every adapter (Wikibooks, Lichess studies, hand-entered books)
// produces this shape, so coverage can be joined on position keys regardless of
// the move order a source used.
import { readdir, readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { CONTENT_DIR } from './http.ts';
import type { SourceRef } from './tree.ts';

export const SOURCES_DIR = join(CONTENT_DIR, 'sources');

interface AnnotationBase {
  source: SourceRef;
  /** The position the text discusses (after the move, for move annotations). */
  toKey: string;
  /** The move order the source used, numbered from its starting position. */
  line: string;
  /** The source's starting position and SAN moves from it, so its line can be replayed. */
  startFen: string;
  path: string[];
  text: string;
  /** The source's own assessments, e.g. "!", "?!", "±". */
  symbols?: string[];
}

/** Text about a specific move, or about a position as a whole (e.g. a chapter intro). */
export type SourceAnnotation = AnnotationBase &
  ({ anchor: 'move'; fromKey: string; uci: string; san: string } | { anchor: 'position' });

export type MoveAnnotation = Extract<SourceAnnotation, { anchor: 'move' }>;

export interface SourceCollection {
  adapter: string;
  retrievedAt: string;
  annotations: SourceAnnotation[];
  /** Source items that couldn't be anchored to a legal move, with the reason. */
  skipped: { item: string; reason: string }[];
}

export async function loadSourceCollections(): Promise<SourceCollection[]> {
  const files = await readdir(SOURCES_DIR).catch(() => []);
  return Promise.all(
    files
      .filter((f) => f.endsWith('.json'))
      .map(async (f) => JSON.parse(await readFile(join(SOURCES_DIR, f), 'utf8')) as SourceCollection),
  );
}
