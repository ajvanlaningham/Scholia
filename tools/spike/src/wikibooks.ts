// Adapter for the Wikibooks "Chess Opening Theory" book. Each page is one
// position, and its title spells out the moves that reach it, e.g.
// "Chess Opening Theory/1. e4/1...e5/2. Nf3". The page text discusses the last
// move in the title, so that move is the anchor.
import { playSanLine, positionKey, STARTING_FEN } from '@scholia/chess-core';
import { cachedGet } from './http.ts';
import type { SourceAnnotation, SourceCollection } from './sources.ts';
import { formatLine } from './tree.ts';

const API = 'https://en.wikibooks.org/w/api.php';
const BOOK = 'Chess Opening Theory';
const LICENSE = 'CC BY-SA 4.0';
// TextExtracts returns only one whole-page extract per request; batching applies
// to intro-only extracts, and extra titles silently come back without text.
const EXTRACT_BATCH = 1;

async function api<T>(params: Record<string, string>): Promise<T> {
  const query = new URLSearchParams({ format: 'json', formatversion: '2', ...params });
  const res = await cachedGet(`${API}?${query}`);
  if (res.status !== 200) throw new Error(`Wikibooks API returned ${res.status}`);
  return JSON.parse(res.body) as T;
}

/** ["e4", "e5", "Nf3"] → "Chess Opening Theory/1. e4/1...e5/2. Nf3". Titles omit check marks. */
export function bookTitle(sans: string[]): string {
  const segments = sans.map((san, i) => {
    const moveNo = Math.floor(i / 2) + 1;
    const move = san.replace(/[+#]$/, '');
    return i % 2 === 0 ? `${moveNo}. ${move}` : `${moveNo}...${move}`;
  });
  return [BOOK, ...segments].join('/');
}

/** Inverse of bookTitle. */
export function titleMoves(title: string): string[] {
  return title
    .slice(BOOK.length + 1)
    .split('/')
    .map((segment) => segment.replace(/^\d+\.+\s*/, ''));
}

/**
 * Pages head their text with the move, sometimes with an assessment, e.g.
 * "== 5. d4!? ==" or "=== 7. Kg1!? ===".
 */
function headingSymbols(text: string, san: string): string[] {
  const move = san.replace(/[+#]$/, '').replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const match = new RegExp(`^=+[^=\\n]*?${move}[+#]?([!?]{1,2})\\s*=+`, 'm').exec(text);
  return match?.[1] ? [match[1]] : [];
}

const pageUrl = (title: string) =>
  `https://en.wikibooks.org/wiki/${title.replaceAll(' ', '_').split('/').map(encodeURIComponent).join('/')}`;

async function listPages(prefix: string): Promise<string[]> {
  const titles: string[] = [];
  let apcontinue: string | undefined;
  do {
    const res = await api<{ query: { allpages: { title: string }[] }; continue?: { apcontinue: string } }>({
      action: 'query',
      list: 'allpages',
      apprefix: prefix,
      aplimit: 'max',
      ...(apcontinue && { apcontinue }),
    });
    titles.push(...res.query.allpages.map((p) => p.title));
    apcontinue = res.continue?.apcontinue;
  } while (apcontinue);
  return titles;
}

interface PageInfo {
  title: string;
  missing?: boolean;
  extract?: string;
  revisions?: { revid: number; timestamp: string }[];
}

async function fetchPages(titles: string[]): Promise<PageInfo[]> {
  const pages: PageInfo[] = [];
  for (let i = 0; i < titles.length; i += EXTRACT_BATCH) {
    const res = await api<{ query: { pages: PageInfo[] } }>({
      action: 'query',
      prop: 'extracts|revisions',
      explaintext: '1',
      exlimit: String(EXTRACT_BATCH),
      rvprop: 'ids|timestamp',
      titles: titles.slice(i, i + EXTRACT_BATCH).join('|'),
    });
    pages.push(...res.query.pages);
  }
  return pages;
}

/**
 * Fetches the page for the position after `sans` and every page below it,
 * anchoring each page's text to the last move in its title.
 */
export async function fetchSubtree(sans: string[]): Promise<SourceCollection> {
  const rootTitle = bookTitle(sans);
  const titles = await listPages(rootTitle);
  const pages = await fetchPages(titles);
  const collection: SourceCollection = {
    adapter: 'wikibooks',
    retrievedAt: new Date().toISOString(),
    annotations: [],
    skipped: [],
  };

  for (const page of pages) {
    const text = page.extract?.trim();
    if (page.missing || !text) {
      collection.skipped.push({ item: page.title, reason: 'no text' });
      continue;
    }
    const moves = titleMoves(page.title);
    let played;
    try {
      played = playSanLine(STARTING_FEN, moves);
    } catch (error) {
      collection.skipped.push({ item: page.title, reason: (error as Error).message });
      continue;
    }
    const last = played.at(-1)!;
    const revision = page.revisions?.[0];
    const annotation: SourceAnnotation = {
      source: {
        kind: 'wiki',
        title: `Wikibooks: ${BOOK}`,
        url: pageUrl(page.title),
        locator: formatLine(STARTING_FEN, played.map((m) => m.san)),
        ...(revision && { revision: `${revision.revid} (${revision.timestamp})` }),
        license: LICENSE,
      },
      anchor: 'move',
      fromKey: played.at(-2)?.key ?? positionKey(STARTING_FEN),
      uci: last.uci,
      san: last.san,
      toKey: last.key,
      line: formatLine(STARTING_FEN, played.map((m) => m.san)),
      startFen: STARTING_FEN,
      path: played.map((m) => m.san),
      text,
      symbols: headingSymbols(text, last.san),
    };
    collection.annotations.push(annotation);
  }
  return collection;
}
