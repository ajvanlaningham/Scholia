// Fetches Wikibooks "Chess Opening Theory" commentary for the Traxler subtree
// into content/sources/wikibooks-traxler.json.
//
//   pnpm spike:wikibooks
import { mkdir, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { playPgnMainline } from '@scholia/chess-core';
import { SOURCES_DIR } from './sources.ts';
import { TRAXLER_ROOT_PGN } from './tree.ts';
import { fetchSubtree } from './wikibooks.ts';

const collection = await fetchSubtree(playPgnMainline(TRAXLER_ROOT_PGN).moves.map((m) => m.san));

await mkdir(SOURCES_DIR, { recursive: true });
const file = join(SOURCES_DIR, 'wikibooks-traxler.json');
await writeFile(file, `${JSON.stringify(collection, null, 2)}\n`);

const lengths = collection.annotations.map((a) => a.text.length).sort((a, b) => a - b);
console.log(`Wikibooks: ${collection.annotations.length} pages anchored, ${collection.skipped.length} skipped`);
console.log(`Text length: median ${lengths[Math.floor(lengths.length / 2)] ?? 0} chars, longest ${lengths.at(-1) ?? 0}`);
for (const { item, reason } of collection.skipped) console.log(`  skipped ${item}: ${reason}`);
console.log(`Wrote ${file}`);
