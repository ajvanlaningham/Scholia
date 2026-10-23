// Adapter for Lichess studies, exported through the official API as annotated
// PGN (every chapter, with variations and comments). Lichess has no study
// search API and its search page is behind a bot challenge, so which studies to
// use is a human choice: see content/sources/lichess-studies.txt.
import { parseAnnotatedPgn } from '@scholia/chess-core';
import { cachedGet } from './http.ts';
import type { SourceAnnotation, SourceCollection } from './sources.ts';
import { formatLine } from './tree.ts';

export interface StudySummary {
  id: string;
  name: string;
  owner: string;
  /** Lichess-verified title (GM, IM, FM, …); absent for untitled players. */
  ownerTitle?: string;
  url: string;
}

const auth = (token: string | undefined): Record<string, string> => (token ? { Authorization: `Bearer ${token}` } : {});

/** Accepts a study ID or any lichess.org/study/… URL (including chapter URLs). */
export function studyId(ref: string): string {
  const match = /lichess\.org\/study\/([A-Za-z0-9]{8})\b/.exec(ref) ?? /^([A-Za-z0-9]{8})$/.exec(ref.trim());
  if (!match?.[1]) throw new Error(`Not a Lichess study URL or ID: ${ref}`);
  return match[1];
}

/** Study name and owner from the export's headers (they're on every chapter). */
export function studySummary(id: string, pgn: string): StudySummary {
  const header = (name: string) => new RegExp(`^\\[${name} "([^"]*)"\\]`, 'm').exec(pgn)?.[1];
  return {
    id,
    name: header('StudyName') ?? id,
    owner: header('Annotator')?.split('/@/')[1] ?? 'unknown',
    url: `https://lichess.org/study/${id}`,
  };
}

export async function userTitle(username: string, token?: string): Promise<string | undefined> {
  const res = await cachedGet(`https://lichess.org/api/user/${encodeURIComponent(username)}`, auth(token));
  if (res.status !== 200) return undefined;
  return (JSON.parse(res.body) as { title?: string }).title;
}

// Sent without the token: public studies don't need it, and an authenticated
// request requires the study:read scope, which Scholia's token doesn't have.
export async function exportStudy(id: string): Promise<string> {
  const params = new URLSearchParams({ comments: 'true', variations: 'true', clocks: 'false', orientation: 'false' });
  const res = await cachedGet(`https://lichess.org/api/study/${id}.pgn?${params}`);
  if (res.status !== 200) throw new Error(`Study ${id} export returned ${res.status}`);
  return res.body;
}

/**
 * Converts a study's chapters into annotations, keeping only moves inside the
 * opening: moves played from a position in `scope` (the tree) or from a
 * position reached that way. Moves without comments or symbols are dropped.
 */
export function studyAnnotations(
  study: StudySummary,
  pgn: string,
  scope: ReadonlySet<string>,
  rootKey: string,
): SourceCollection {
  const collection: SourceCollection = {
    adapter: `lichess-study:${study.id}`,
    retrievedAt: new Date().toISOString(),
    annotations: [],
    skipped: [],
  };
  const author = study.ownerTitle ? `${study.ownerTitle} ${study.owner}` : study.owner;

  let chapters;
  try {
    chapters = parseAnnotatedPgn(pgn);
  } catch (error) {
    collection.skipped.push({ item: study.url, reason: (error as Error).message });
    return collection;
  }

  for (const chapter of chapters) {
    const chapterName = chapter.headers.ChapterName ?? chapter.headers.Event ?? 'Untitled chapter';
    const source = {
      kind: 'study' as const,
      title: `Lichess study: ${study.name}`,
      author,
      url: chapter.headers.ChapterURL ?? study.url,
      locator: chapterName,
    };

    const inside = new Set(scope);
    const kept: SourceAnnotation[] = [];
    for (const move of chapter.moves) {
      if (!inside.has(move.fromKey)) continue;
      inside.add(move.key);
      if (move.comments.length === 0 && move.symbols.length === 0) continue;
      kept.push({
        source,
        anchor: 'move',
        fromKey: move.fromKey,
        uci: move.uci,
        san: move.san,
        toKey: move.key,
        line: formatLine(chapter.startFen, move.path),
        startFen: chapter.startFen,
        path: move.path,
        text: move.comments.join(' '),
        symbols: move.symbols,
      });
    }

    // Gamebook-style studies often put their claim about a line in the chapter
    // name ("If 7) Ke3 - Mate in 2 after 8) Qe2"); anchor it to the line's end.
    const end = chapter.moves.filter((m) => m.mainline).at(-1);
    if (end && inside.has(end.key) && !/^(chapter|capítol|kapitel)\s*\d+$/i.test(chapterName)) {
      kept.push({
        source,
        anchor: 'move',
        fromKey: end.fromKey,
        uci: end.uci,
        san: end.san,
        toKey: end.key,
        line: formatLine(chapter.startFen, end.path),
        startFen: chapter.startFen,
        path: end.path,
        text: `Chapter: ${chapterName}`,
        symbols: [],
      });
    }

    // An intro describes the chapter's starting position; chapters that start
    // from move 1 but cover the Traxler get their intro anchored at its root.
    const introKey = scope.has(chapter.startKey) ? chapter.startKey : kept.length > 0 ? rootKey : undefined;
    if (chapter.intro.length > 0 && introKey) {
      kept.unshift({
        source,
        anchor: 'position',
        toKey: introKey,
        line: '(chapter intro)',
        startFen: chapter.startFen,
        path: [],
        text: chapter.intro.join(' '),
      });
    }

    if (kept.length === 0) collection.skipped.push({ item: `${study.url} / ${chapterName}`, reason: 'no annotations inside the tree' });
    collection.annotations.push(...kept);
  }
  return collection;
}
