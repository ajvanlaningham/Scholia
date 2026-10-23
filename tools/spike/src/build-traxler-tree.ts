// Phase 0 spike: build a validated Traxler move tree with frequencies, engine
// evaluations, and empty explanation slots to fill from published commentary.
//
//   pnpm spike:traxler
//
// Env: LICHESS_TOKEN (enables explorer expansion), STOCKFISH_PATH,
// SCHOLIA_CONTENT_DIR (defaults to <repo>/content, which is gitignored).
import { mkdir, readdir, readFile, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { playPgnMainline, playSanLine, playUci, positionKey, sideToMove } from '@scholia/chess-core';
import { formatScore } from './evaluation.ts';
import { cloudEval, type Counts, explorer, type ExplorerDb, totalGames } from './lichess.ts';
import { loadOpenings } from './openings.ts';
import { loadSourceCollections } from './sources.ts';
import { Stockfish } from './stockfish.ts';
import {
  edgeId,
  type EdgeOrigin,
  type Explanation,
  formatLine,
  type Tree,
  type TreeEdge,
  type TreeNode,
  TRAXLER_DIR,
  TRAXLER_ROOT_PGN as ROOT_PGN,
} from './tree.ts';

const OUT_DIR = TRAXLER_DIR;

// Explorer expansion. A position is kept if at least MIN_REACH of the games
// reaching the Traxler (in either database) pass through it. Dataset lines are
// always included regardless.
const MIN_REACH = 0.01;
// Below this many games at a position, its move shares are noise and don't count.
const MIN_GAMES: Record<ExplorerDb, number> = { masters: 10, lichess: 50 };
// Safety limits; reaching them means MIN_REACH is too low.
const MAX_PLIES = 12;
const MAX_NODES = 500;
const DATABASES: ExplorerDb[] = ['lichess', 'masters'];

// Where a lesson section ends, expand this many plies further, keeping moves
// played in at least this share of games from that position. Lessons that
// continue from there need game data even below the global reach cutoff.
const FOCUS_PLIES = 4;
const FOCUS_MIN_SHARE = 0.1;

const MULTI_PV = 3;
const LOCAL_NODES = 5_000_000;

const counts = ({ white, draws, black }: Counts): Counts => ({ white, draws, black });

const rootGame = playPgnMainline(ROOT_PGN);
const rootMove = rootGame.moves.at(-1)!;
const root: TreeNode = {
  key: rootMove.key,
  fen: rootMove.fen,
  sideToMove: sideToMove(rootMove.fen),
  path: [],
  openings: [],
  reach: { lichess: 1, masters: 1 },
};
const nodes = new Map<string, TreeNode>([[root.key, root]]);
const edges = new Map<string, TreeEdge>();

function addEdge(from: TreeNode, uci: string, origin: EdgeOrigin): { node: TreeNode; edge: TreeEdge } {
  const move = playUci(from.fen, uci);
  let node = nodes.get(move.key);
  if (!node) {
    node = {
      key: move.key,
      fen: move.fen,
      sideToMove: sideToMove(move.fen),
      path: [...from.path, move.san],
      openings: [],
      reach: { lichess: 0, masters: 0 },
    };
    nodes.set(node.key, node);
  }
  const id = edgeId(from.key, move.uci);
  let edge = edges.get(id);
  if (!edge) {
    edge = {
      from: from.key,
      to: node.key,
      uci: move.uci,
      san: move.san,
      line: formatLine(root.fen, [...from.path, move.san]),
      origins: [],
      explanation: { status: 'missing', text: null, sources: [] },
    };
    edges.set(id, edge);
  }
  if (!edge.origins.includes(origin)) edge.origins.push(origin);
  return { node, edge };
}

// 1. Named lines from the Lichess opening dataset.
const datasetLines = (await loadOpenings()).filter((o) => o.pgn.startsWith(ROOT_PGN));
for (const opening of datasetLines) {
  let node = root;
  for (const move of playPgnMainline(opening.pgn).moves.slice(rootGame.moves.length)) {
    node = addEdge(node, move.uci, 'dataset').node;
  }
  node.openings.push({ eco: opening.eco, name: opening.name });
}
root.openings = datasetLines.filter((o) => o.pgn === ROOT_PGN).map(({ eco, name }) => ({ eco, name }));
console.log(`Dataset: ${datasetLines.length} named lines, ${nodes.size} positions`);

// 2. Breadth-first expansion by how often positions are actually reached.
// Transpositions have equal ply counts, so every parent of a position is
// processed (and its reach added) before the position itself is expanded.
const token = process.env.LICHESS_TOKEN;
let hitMaxNodes = false;
if (token) {
  const queue = [root];
  const queued = new Set([root.key]);
  while (queue.length > 0) {
    const node = queue.shift()!;
    if (node.path.length >= MAX_PLIES) continue;
    for (const db of DATABASES) {
      const result = await explorer(db, node.fen, token);
      (node.games ??= {})[db] = counts(result);
      const total = totalGames(result);
      const reliable = total >= MIN_GAMES[db];
      for (const move of result.moves) {
        const reach = reliable ? node.reach[db] * (totalGames(move) / total) : 0;
        let edge = edges.get(edgeId(node.key, playUci(node.fen, move.uci).uci));
        if (reach >= MIN_REACH) {
          if (!edge && nodes.size >= MAX_NODES) {
            hitMaxNodes = true;
            continue;
          }
          edge = addEdge(node, move.uci, 'explorer').edge;
        }
        if (!edge) continue;
        (edge.games ??= {})[db] = counts(move);
        nodes.get(edge.to)!.reach[db] += reach;
      }
    }
    for (const edge of edges.values()) {
      if (edge.from === node.key && !queued.has(edge.to)) {
        queued.add(edge.to);
        queue.push(nodes.get(edge.to)!);
      }
    }
    process.stdout.write(`\rExplorer: ${queued.size} positions queued, ${nodes.size} in tree`);
  }
  console.log();
  if (hitMaxNodes) console.warn(`Hit MAX_NODES (${MAX_NODES}); raise MIN_REACH for a complete tree`);
} else {
  console.log('LICHESS_TOKEN not set: skipping explorer expansion (tree is dataset lines only)');
}

// 2b. Lines that sources discuss, even where games rarely go, so every claim a
// source makes gets an engine evaluation. A source's moves before it reaches
// the tree (e.g. a different move order into the Traxler) are skipped.
const sizeBeforeSources = nodes.size;
for (const annotation of (await loadSourceCollections()).flatMap((c) => c.annotations)) {
  let node = nodes.get(positionKey(annotation.startFen));
  for (const move of playSanLine(annotation.startFen, annotation.path)) {
    node = node ? addEdge(node, move.uci, 'source').node : nodes.get(move.key);
  }
}
console.log(`Sources: ${nodes.size - sizeBeforeSources} positions added from source lines`);

// 2c. Lesson lines, so every move a lesson teaches gets an evaluation, and the
// positions where lesson sections end, expanded by local frequency.
async function lessonLines(): Promise<ReturnType<typeof playPgnMainline>['moves'][]> {
  const dir = join(OUT_DIR, 'lessons');
  const files = (await readdir(dir).catch(() => [])).filter((f) => f.endsWith('.json'));
  const lines = [];
  for (const file of files) {
    const lesson = JSON.parse(await readFile(join(dir, file), 'utf8')) as { start: string; sections: { line: string }[] };
    for (const section of lesson.sections) {
      try {
        lines.push(playPgnMainline(`${lesson.start} ${section.line}`).moves);
      } catch {
        // Invalid lines are reported by spike:lessons.
      }
    }
  }
  return lines;
}

const sizeBeforeLessons = nodes.size;
const lines = await lessonLines();
for (const moves of lines) {
  // Moves before the line reaches the tree (the approach from move 1) are skipped.
  let node: TreeNode | undefined;
  for (const move of moves) node = node ? addEdge(node, move.uci, 'lesson').node : nodes.get(move.key);
}
console.log(`Lessons: ${nodes.size - sizeBeforeLessons} positions added from lesson lines`);

const lessonEndings = () => [...new Set(lines.map((moves) => moves.at(-1)!.key))];

if (token) {
  const sizeBeforeFocus = nodes.size;
  for (const key of lessonEndings()) {
    const start = nodes.get(key);
    if (!start) continue;
    // Share of games from the focus position that reach each position.
    const local = new Map([[start.key, 1]]);
    let frontier = [start];
    for (let ply = 0; ply < FOCUS_PLIES && frontier.length > 0; ply++) {
      const next: TreeNode[] = [];
      for (const node of frontier) {
        for (const db of DATABASES) {
          const result = await explorer(db, node.fen, token);
          (node.games ??= {})[db] = counts(result);
          const total = totalGames(result);
          if (total < MIN_GAMES[db]) continue;
          for (const move of result.moves) {
            const share = (local.get(node.key)! * totalGames(move)) / total;
            if (share < FOCUS_MIN_SHARE) continue;
            const { node: child, edge } = addEdge(node, move.uci, 'explorer');
            (edge.games ??= {})[db] = counts(move);
            if (!local.has(child.key)) next.push(child);
            local.set(child.key, Math.max(local.get(child.key) ?? 0, share));
          }
        }
      }
      frontier = next;
    }
  }
  console.log(`Lesson endings: ${nodes.size - sizeBeforeFocus} positions added past where sections end`);
}

// 3. Evaluations: Lichess cloud first, local Stockfish for the rest.
const engine = await Stockfish.start();
if (!engine) console.log('Stockfish not found (set STOCKFISH_PATH): positions missing from the cloud stay unevaluated');
const evalStats = { cloud: 0, local: 0, none: 0 };
for (const node of nodes.values()) {
  node.evaluation =
    (await cloudEval(node.fen, MULTI_PV)) ??
    (await engine?.analyse(node.fen, { nodes: LOCAL_NODES, multiPv: MULTI_PV }));
  evalStats[node.evaluation?.origin === 'lichess-cloud' ? 'cloud' : node.evaluation ? 'local' : 'none']++;
  process.stdout.write(`\rEvaluations: ${evalStats.cloud} cloud, ${evalStats.local} local, ${evalStats.none} none`);
}
console.log();
engine?.quit();

// 4. Carry over explanations from a previous run so re-running never loses work.
const outFile = join(OUT_DIR, 'tree.json');
const previous = await readFile(outFile, 'utf8').then(
  (text) => JSON.parse(text) as Tree,
  () => undefined,
);
const orphanedExplanations = [...(previous?.orphanedExplanations ?? [])];
for (const old of previous?.edges ?? []) {
  const edge = edges.get(edgeId(old.from, old.uci));
  if (edge) edge.explanation = old.explanation;
  else if (old.explanation.status !== 'missing') {
    orphanedExplanations.push({ from: old.from, uci: old.uci, line: old.line, explanation: old.explanation });
  }
}

const sortedEdges = [...edges.values()].sort(
  (a, b) =>
    nodes.get(a.from)!.path.length - nodes.get(b.from)!.path.length ||
    nodes.get(b.to)!.reach.lichess - nodes.get(a.to)!.reach.lichess ||
    a.line.localeCompare(b.line),
);
const tree: Tree = {
  opening: 'Traxler Counterattack',
  generatedAt: new Date().toISOString(),
  root: { approach: ROOT_PGN, fen: root.fen, key: root.key },
  settings: {
    minReach: MIN_REACH,
    minGames: MIN_GAMES,
    maxPlies: MAX_PLIES,
    maxNodes: MAX_NODES,
    hitMaxNodes,
    multiPv: MULTI_PV,
    localNodes: LOCAL_NODES,
    explorer: Boolean(token),
  },
  nodes: [...nodes.values()],
  edges: sortedEdges,
  orphanedExplanations,
};

// 5. A human-readable checklist for the sourcing audit.
const percent = (x: number) => (x > 0 ? `${(x * 100).toFixed(1)}%` : '—');
const checklist = [
  '# Traxler sourcing checklist',
  '',
  `Generated ${tree.generatedAt} from \`tree.json\`. Fill explanations in \`tree.json\`; this file is regenerated.`,
  '',
  'Reach = share of Traxler games (club 1400–2000 / masters) that reach the position after the move.',
  '',
  '| Line | Origin | Club reach | Masters reach | Eval after | Explanation |',
  '|---|---|---|---|---|---|',
  ...sortedEdges.map((e) => {
    const to = nodes.get(e.to)!;
    const sources = e.explanation.sources.length;
    const status = e.explanation.status === 'missing' ? '☐ missing' : `${e.explanation.status} (${sources} source${sources === 1 ? '' : 's'})`;
    return `| ${e.line} | ${e.origins.join(', ')} | ${percent(to.reach.lichess)} | ${percent(to.reach.masters)} | ${formatScore(to.evaluation?.lines[0])} | ${status} |`;
  }),
  '',
];

await mkdir(OUT_DIR, { recursive: true });
await writeFile(outFile, `${JSON.stringify(tree, null, 2)}\n`);
await writeFile(join(OUT_DIR, 'sourcing-checklist.md'), checklist.join('\n'));

const filled = sortedEdges.filter((e) => e.explanation.status !== 'missing').length;
console.log(`Wrote ${nodes.size} positions and ${edges.size} moves to ${OUT_DIR}`);
console.log(`Explanations: ${filled}/${edges.size} filled`);
