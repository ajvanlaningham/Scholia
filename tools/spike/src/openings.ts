import { cachedGet } from './http.ts';

export interface OpeningEntry {
  eco: string;
  name: string;
  /** Movetext from the starting position, e.g. "1. e4 e5 2. Nf3". */
  pgn: string;
}

// CC0: https://github.com/lichess-org/chess-openings
const DATASET_URL = 'https://raw.githubusercontent.com/lichess-org/chess-openings/master';
const FILES = ['a', 'b', 'c', 'd', 'e'];

export async function loadOpenings(): Promise<OpeningEntry[]> {
  const entries: OpeningEntry[] = [];
  for (const file of FILES) {
    const res = await cachedGet(`${DATASET_URL}/${file}.tsv`);
    if (res.status !== 200) throw new Error(`Opening dataset ${file}.tsv not found`);
    for (const row of res.body.trim().split('\n').slice(1)) {
      const [eco, name, pgn] = row.split('\t');
      if (eco && name && pgn) entries.push({ eco, name, pgn });
    }
  }
  return entries;
}
