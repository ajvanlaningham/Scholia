// Joins teaching candidates against gathered source commentary on position
// keys, so a source's move order doesn't matter. Run after spike:candidates and
// at least one source adapter.
//
//   pnpm spike:coverage
import { readFile, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { loadSourceCollections, type MoveAnnotation } from './sources.ts';
import { edgeId, type Tree, TRAXLER_DIR } from './tree.ts';

const TOP_N = 30;
// Shorter source texts are usually a sentence pointing at the next move, not an explanation.
const SUBSTANTIVE_CHARS = 200;
const SNIPPET_CHARS = 160;

interface RankedCandidate {
  from: string;
  uci: string;
  line: string;
  score: number;
}

const tree = JSON.parse(await readFile(join(TRAXLER_DIR, 'tree.json'), 'utf8')) as Tree;
const candidates = JSON.parse(await readFile(join(TRAXLER_DIR, 'candidates.json'), 'utf8')) as RankedCandidate[];
const collections = await loadSourceCollections();
const annotations = collections.flatMap((c) => c.annotations);
if (annotations.length === 0) throw new Error('No source collections found; run a source adapter first');
const moveNotes = annotations.filter((a): a is MoveAnnotation => a.anchor === 'move');

const byMove = Map.groupBy(moveNotes, (a) => edgeId(a.fromKey, a.uci));
const nodes = new Map(tree.nodes.map((n) => [n.key, n]));
const treeEdges = new Map(tree.edges.map((e) => [edgeId(e.from, e.uci), e]));
const rankOf = new Map(candidates.map((c, i) => [edgeId(c.from, c.uci), i + 1]));

const snippet = (text: string) => {
  const flat = text.replace(/\s+/g, ' ').replace(/\|/g, '\\|').trim();
  return flat.length > SNIPPET_CHARS ? `${flat.slice(0, SNIPPET_CHARS)}…` : flat;
};
const cite = (a: MoveAnnotation) => {
  const by = a.source.author ? ` (${a.source.author})` : '';
  const where = a.source.kind === 'wiki' ? '' : `, ${a.source.locator}`;
  const judged = a.symbols?.length ? ` **${a.san}${a.symbols.join('')}**` : '';
  return `[${a.source.title}${by}${where}](${a.source.url})${judged} (${a.text.length} chars): “${snippet(a.text)}”`;
};
const status = (found: MoveAnnotation[]) =>
  found.length === 0 ? '✗ gap' : found.some((a) => a.text.length >= SUBSTANTIVE_CHARS) ? '✓ substantive' : '◐ thin';
const pct = (x: number) => `${Math.round(x * 100)}%`;

const top = candidates.slice(0, TOP_N).map((c) => ({ ...c, found: byMove.get(edgeId(c.from, c.uci)) ?? [] }));
const tally = Map.groupBy(top, (c) => status(c.found));

const discussedElsewhere = [...byMove.entries()]
  .filter(([id]) => treeEdges.has(id) && (rankOf.get(id) ?? Infinity) > TOP_N)
  .map(([id, found]) => ({ edge: treeEdges.get(id)!, rank: rankOf.get(id), found }))
  .sort((a, b) => nodes.get(b.edge.to)!.reach.lichess - nodes.get(a.edge.to)!.reach.lichess);

const outsideTree = [...byMove.entries()].filter(([id]) => !treeEdges.has(id)).map(([, found]) => found);

const report = [
  '# Traxler source coverage',
  '',
  `Sources: ${collections.map((c) => `${c.adapter} (${c.annotations.length} annotations, retrieved ${c.retrievedAt.slice(0, 10)})`).join('; ')}.`,
  '',
  `Top ${top.length} candidates: ${(['✓ substantive', '◐ thin', '✗ gap'] as const).map((s) => `${tally.get(s)?.length ?? 0} ${s}`).join(', ')}.`,
  `Substantive means at least one source text of ${SUBSTANTIVE_CHARS}+ characters anchored to the move. Length isn't quality: read them.`,
  '',
  '## Top candidates',
  '',
  '| # | Line | Coverage | Sources |',
  '|---|---|---|---|',
  ...top.map((c, i) => `| ${i + 1} | ${c.line} | ${status(c.found)} | ${c.found.map(cite).join('<br>') || '—'} |`),
  '',
  '## Discussed by sources, but ranked low or not at all',
  '',
  'Moves experts chose to write about that the ranking missed. Many of these suggest the weights need adjusting.',
  '',
  '| Line | Rank | Club reach | Sources |',
  '|---|---|---|---|',
  ...discussedElsewhere.map(
    (d) => `| ${d.edge.line} | ${d.rank ?? 'no signals'} | ${pct(nodes.get(d.edge.to)!.reach.lichess)} | ${d.found.map(cite).join('<br>')} |`,
  ),
  '',
  '## Source moves outside the tree',
  '',
  'Lines a source covers that club and master games rarely reach. Theoretical importance can still justify adding them.',
  '',
  '| Line (source move order) | Sources |',
  '|---|---|',
  ...outsideTree.map((found) => `| ${found[0]!.line} | ${found.map(cite).join('<br>')} |`),
  '',
];

await writeFile(join(TRAXLER_DIR, 'coverage.md'), report.join('\n'));
console.log(
  `Top ${top.length}: ${tally.get('✓ substantive')?.length ?? 0} substantive, ${tally.get('◐ thin')?.length ?? 0} thin, ${tally.get('✗ gap')?.length ?? 0} gaps`,
);
console.log(`${discussedElsewhere.length} sourced moves ranked low; ${outsideTree.length} outside the tree. Wrote coverage.md`);
