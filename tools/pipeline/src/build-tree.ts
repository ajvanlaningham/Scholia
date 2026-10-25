// Builds an opening's tree: named lines from the Lichess opening dataset, moves
// players actually choose (Lichess explorer), lines that sources and lessons
// cover, and evaluations for every position (Lichess cloud, then local
// Stockfish). Writes content/openings/<id>/tree.json.
//
// Env: LICHESS_TOKEN (enables explorer expansion), STOCKFISH_PATH.
import { mkdir, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { type PlayedMove, playPgnMainline, playSanLine, playUci, positionKey, sideToMove } from '@scholia/chess-core';
import { listCourses, loadLessons, type OpeningConfig, openingDir } from './config.ts';
import { cloudEval, type Counts, explorer, type ExplorerDb, totalGames } from './lichess.ts';
import { loadOpenings } from './openings.ts';
import { loadSourceCollections } from './sources.ts';
import { Stockfish } from './stockfish.ts';
import { edgeId, type EdgeOrigin, formatLine, type Tree, type TreeEdge, type TreeNode } from './tree.ts';

// Explorer expansion. A position is kept if at least MIN_REACH of the games
// reaching the opening's root (in either database) pass through it. Dataset
// lines are always included regardless.
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

/** Every section line of every course on this opening, as moves from the start. */
async function lessonLines(openingId: string): Promise<PlayedMove[][]> {
  const lines: PlayedMove[][] = [];
  for (const course of (await listCourses()).filter((c) => c.opening === openingId)) {
    // Lessons that don't match the schema are reported by `pnpm lessons`.
    for (const { lesson } of await loadLessons(course.id)) {
      if (!lesson) continue;
      for (const section of lesson.sections) {
        try {
          lines.push(playPgnMainline(`${lesson.start} ${section.line}`).moves);
        } catch {
          // Invalid lines are reported by `pnpm lessons`.
        }
      }
    }
  }
  return lines;
}

export async function buildTree(opening: OpeningConfig): Promise<void> {
  const outDir = openingDir(opening.id);
  const token = process.env.LICHESS_TOKEN;

  const rootMove = playPgnMainline(opening.root).moves.at(-1)!;
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
      edge = { from: from.key, to: node.key, uci: move.uci, san: move.san, line: formatLine(root.fen, [...from.path, move.san]), origins: [] };
      edges.set(id, edge);
    }
    if (!edge.origins.includes(origin)) edge.origins.push(origin);
    return { node, edge };
  }

  /** Adds a line's moves from the point where it reaches the tree; earlier moves are its approach. */
  function addLine(moves: PlayedMove[], origin: EdgeOrigin, startKey?: string): void {
    let node = startKey ? nodes.get(startKey) : undefined;
    for (const move of moves) node = node ? addEdge(node, move.uci, origin).node : nodes.get(move.key);
  }

  // 1. Named lines from the Lichess opening dataset that pass through the root,
  // matched by position so other move orders count too.
  let named = 0;
  for (const entry of await loadOpenings()) {
    const moves = playPgnMainline(entry.pgn).moves;
    const at = moves.findIndex((m) => m.key === root.key);
    if (at < 0) continue;
    named++;
    if (at === moves.length - 1) {
      root.openings.push({ eco: entry.eco, name: entry.name });
      continue;
    }
    addLine(moves.slice(at + 1), 'dataset', root.key);
    nodes.get(moves.at(-1)!.key)!.openings.push({ eco: entry.eco, name: entry.name });
  }
  console.log(`Dataset: ${named} named lines, ${nodes.size} positions`);

  // 2. Breadth-first expansion by how often positions are actually reached.
  // Transpositions have equal ply counts, so every parent of a position is
  // processed (and its reach added) before the position itself is expanded.
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

  // 3. Lines that sources discuss, even where games rarely go, so every claim a
  // source makes gets an engine evaluation.
  const sizeBeforeSources = nodes.size;
  for (const annotation of (await loadSourceCollections()).flatMap((c) => c.annotations)) {
    addLine(playSanLine(annotation.startFen, annotation.path), 'source', positionKey(annotation.startFen));
  }
  console.log(`Sources: ${nodes.size - sizeBeforeSources} positions added from source lines`);

  // 4. Lesson lines, so every move a lesson teaches gets an evaluation, then the
  // positions where lesson sections end, expanded by local frequency.
  const sizeBeforeLessons = nodes.size;
  const lines = await lessonLines(opening.id);
  for (const moves of lines) addLine(moves, 'lesson');
  console.log(`Lessons: ${nodes.size - sizeBeforeLessons} positions added from lesson lines`);

  if (token) {
    const sizeBeforeFocus = nodes.size;
    for (const key of new Set(lines.map((moves) => moves.at(-1)!.key))) {
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

  // 5. Evaluations: Lichess cloud first, local Stockfish for the rest.
  const engine = await Stockfish.start();
  if (!engine) console.log('Stockfish not found (set STOCKFISH_PATH): positions missing from the cloud stay unevaluated');
  const evalStats = { cloud: 0, local: 0, none: 0 };
  for (const node of nodes.values()) {
    node.evaluation =
      (await cloudEval(node.fen, MULTI_PV)) ?? (await engine?.analyseCached(node.fen, { nodes: LOCAL_NODES, multiPv: MULTI_PV }));
    evalStats[node.evaluation?.origin === 'lichess-cloud' ? 'cloud' : node.evaluation ? 'local' : 'none']++;
    process.stdout.write(`\rEvaluations: ${evalStats.cloud} cloud, ${evalStats.local} local, ${evalStats.none} none`);
  }
  console.log();
  engine?.quit();

  const tree: Tree = {
    opening: opening.title,
    generatedAt: new Date().toISOString(),
    root: { approach: opening.root, fen: root.fen, key: root.key },
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
    edges: [...edges.values()].sort(
      (a, b) =>
        nodes.get(a.from)!.path.length - nodes.get(b.from)!.path.length ||
        nodes.get(b.to)!.reach.lichess - nodes.get(a.to)!.reach.lichess ||
        a.line.localeCompare(b.line),
    ),
  };
  await mkdir(outDir, { recursive: true });
  await writeFile(join(outDir, 'tree.json'), `${JSON.stringify(tree, null, 2)}\n`);
  console.log(`Wrote ${nodes.size} positions and ${edges.size} moves to ${outDir}`);
}
