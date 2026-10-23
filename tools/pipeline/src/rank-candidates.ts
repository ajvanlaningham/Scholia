// Ranks an opening's moves by how teachable they look for one course's
// learner. The result is a shortlist to check against published commentary,
// not a verdict: experts decide what's worth teaching.
import { writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { type CourseConfig, courseDir } from './config.ts';
import { type EngineLine, moveLoss, winChanceFor } from './evaluation.ts';
import { type Counts, totalGames } from './lichess.ts';
import type { Tree, TreeEdge, TreeNode } from './tree.ts';

const TOP_N = 30;

// Thresholds are in win-chance points (0–100) for the side making the move.
// Win chance flattens out in won/lost positions, so +5 → +8 counts for little
// while +0.5 → −1.5 counts for a lot.
const CLOSE_CHOICE = 5;
// The best move is this far ahead of the second best: an "only move".
const ONLY_MOVE = 15;
const MISTAKE = 10;
const BLUNDER = 20;
// A move this share of club players choose counts as "the popular move".
const POPULAR_SHARE = 0.3;
// Masters and club shares this far apart suggest an idea club players miss.
const SHARE_GAP = 0.25;
// Below this many games at a position, its move shares are noise.
const MIN_GAMES = { masters: 10, lichess: 50 };

const WEIGHTS = {
  trap: 3, // the opponent's popular mistake: a chance for the learner
  punish: 3, // the learner's best reply to a trap
  pitfall: 3, // the learner's side's popular mistake: something to avoid
  refutation: 3,
  swing: 2,
  onlyMove: 2,
  decision: 1.5,
  mastersClubGap: 1,
  namedLine: 1,
} as const;
type Signal = keyof typeof WEIGHTS;

// Lessons prompt on the learner's moves, so the opponent's choices matter less,
// except their mistakes (traps), which are counted at full weight.
const OPPONENT_FACTOR = 0.5;
const FULL_WEIGHT_FOR_OPPONENT: Signal[] = ['trap', 'swing', 'namedLine'];

export interface Candidate {
  from: string;
  uci: string;
  line: string;
  byLearner: boolean;
  score: number;
  reach: { club: number; masters: number };
  signals: { signal: Signal; detail: string }[];
}

const share = (part: Counts | undefined, whole: Counts | undefined): number =>
  part && whole && totalGames(whole) > 0 ? totalGames(part) / totalGames(whole) : 0;
const pct = (x: number) => `${Math.round(x * 100)}%`;
const NO_GAMES: Counts = { white: 0, draws: 0, black: 0 };
const clubGames = (edge: TreeEdge | undefined) => (edge?.games?.lichess ? totalGames(edge.games.lichess) : 0);

export async function rankCandidates(course: CourseConfig, tree: Tree): Promise<Candidate[]> {
  const nodes = new Map(tree.nodes.map((n) => [n.key, n]));
  const children = Map.groupBy(tree.edges, (e) => e.from);
  const parents = Map.groupBy(tree.edges, (e) => e.to);
  const byLearner = (edge: TreeEdge) => nodes.get(edge.from)!.sideToMove === course.learner;

  // Taking back on the square the opponent just captured on. Usually the only
  // move, but rarely worth a lesson.
  const isRecapture = (edge: TreeEdge) =>
    edge.san.includes('x') && (parents.get(edge.from) ?? []).some((p) => p.uci.slice(2, 4) === edge.uci.slice(2, 4));

  const forMover = (node: TreeNode, line: EngineLine) => winChanceFor(node.sideToMove, line);

  const loss = (edge: TreeEdge): number | undefined => {
    const from = nodes.get(edge.from)!;
    return moveLoss(from.sideToMove, edge.uci, from.evaluation, nodes.get(edge.to)!.evaluation);
  };

  /** A popular move that loses at least MISTAKE points, with its club share and loss. */
  const popularMistake = (edge: TreeEdge) => {
    const from = nodes.get(edge.from)!;
    const clubShare = share(edge.games?.lichess, from.games?.lichess);
    const lost = loss(edge);
    return lost !== undefined && lost >= MISTAKE && clubShare >= POPULAR_SHARE ? { clubShare, lost } : undefined;
  };

  function signalsFor(edge: TreeEdge): Candidate['signals'] {
    const from = nodes.get(edge.from)!;
    const to = nodes.get(edge.to)!;
    const siblings = children.get(edge.from) ?? [];
    const lines = from.evaluation?.lines ?? [];
    const clubShare = share(edge.games?.lichess, from.games?.lichess);
    const lost = loss(edge);
    const isBest = lines[0]?.uci[0] === edge.uci;
    const signals: Candidate['signals'] = [];

    const mistake = popularMistake(edge);
    if (mistake) {
      const detail = `${pct(mistake.clubShare)} of club players choose it; costs ${mistake.lost.toFixed(0)} win-chance pts vs ${lines[0]!.san[0]}`;
      signals.push({ signal: byLearner(edge) ? 'pitfall' : 'trap', detail });
    } else if (lost !== undefined && lost >= BLUNDER) {
      signals.push({ signal: 'swing', detail: `costs ${lost.toFixed(0)} win-chance pts vs ${lines[0]!.san[0]}` });
    }

    // The learner's best reply right after the opponent's popular mistake.
    const trapBefore = (parents.get(edge.from) ?? []).find((p) => !byLearner(p) && popularMistake(p));
    if (byLearner(edge) && isBest && trapBefore) {
      signals.push({ signal: 'punish', detail: `best reply to the popular mistake ${trapBefore.san}` });
    }

    const popular = siblings.reduce<TreeEdge | undefined>((top, e) => (clubGames(e) > clubGames(top) ? e : top), undefined);
    const popularLoss = popular && loss(popular);
    if (isBest && popular && popular !== edge && popularLoss !== undefined && popularLoss >= MISTAKE) {
      signals.push({
        signal: 'refutation',
        detail: `engine's choice, but club players usually play ${popular.san} (costs ${popularLoss.toFixed(0)} pts)`,
      });
    }

    const runnerUp = lines[1];
    if (isBest && runnerUp && !isRecapture(edge)) {
      const margin = forMover(from, lines[0]!) - forMover(from, runnerUp);
      if (margin >= ONLY_MOVE) {
        signals.push({ signal: 'onlyMove', detail: `${margin.toFixed(0)} win-chance pts better than ${runnerUp.san[0]}` });
      }
    }

    const close = lines.filter((l) => forMover(from, lines[0]!) - forMover(from, l) <= CLOSE_CHOICE);
    if (close.length >= 2 && close.some((l) => l.uci[0] === edge.uci)) {
      signals.push({ signal: 'decision', detail: `one of ${close.length} near-equal options (${close.map((l) => l.san[0]).join(', ')})` });
    }

    const reliable = (db: 'masters' | 'lichess') => totalGames(from.games?.[db] ?? NO_GAMES) >= MIN_GAMES[db];
    const mastersShare = share(edge.games?.masters, from.games?.masters);
    if (reliable('masters') && reliable('lichess') && Math.abs(mastersShare - clubShare) >= SHARE_GAP) {
      signals.push({ signal: 'mastersClubGap', detail: `masters ${pct(mastersShare)} vs club ${pct(clubShare)}` });
    }

    if (to.openings.length > 0) {
      signals.push({ signal: 'namedLine', detail: to.openings.map((o) => o.name.split(', ').at(-1)).join('; ') });
    }
    return signals;
  }

  const candidates: Candidate[] = tree.edges
    .map((edge) => {
      const to = nodes.get(edge.to)!;
      const learnerMove = byLearner(edge);
      const signals = signalsFor(edge);
      const weight = signals.reduce(
        (sum, s) => sum + WEIGHTS[s.signal] * (learnerMove || FULL_WEIGHT_FOR_OPPONENT.includes(s.signal) ? 1 : OPPONENT_FACTOR),
        0,
      );
      // Square root so reach orders candidates without drowning out the signals;
      // the floor keeps unreached lines (dataset, sources) on the list.
      const reach = Math.max(to.reach.lichess, to.reach.masters, 0.001);
      return {
        from: edge.from,
        uci: edge.uci,
        line: edge.line,
        byLearner: learnerMove,
        score: Math.round(100 * Math.sqrt(reach) * weight) / 10,
        reach: { club: to.reach.lichess, masters: to.reach.masters },
        signals,
      };
    })
    .filter((c) => c.score > 0)
    .sort((a, b) => b.score - a.score);

  const report = [
    `# ${course.title}: teaching candidates`,
    '',
    `Learner plays ${course.learner}. Ranked from the ${tree.opening} tree (${tree.generatedAt}). A shortlist to check against published commentary, not a verdict.`,
    '',
    `Score = √reach × signal weights (${Object.entries(WEIGHTS).map(([k, v]) => `${k} ${v}`).join(', ')}); the opponent's moves count ×${OPPONENT_FACTOR} except ${FULL_WEIGHT_FOR_OPPONENT.join(', ')}.`,
    "Win-chance points use Lichess's model; before/after evaluations come from separate searches, so small differences are noise.",
    '',
    '| # | Line | Whose | Score | Club reach | Masters reach | Why |',
    '|---|---|---|---|---|---|---|',
    ...candidates
      .slice(0, TOP_N)
      .map(
        (c, i) =>
          `| ${i + 1} | ${c.line} | ${c.byLearner ? 'yours' : 'opponent'} | ${c.score} | ${pct(c.reach.club)} | ${pct(c.reach.masters)} | ${c.signals.map((s) => `**${s.signal}**: ${s.detail}`).join('<br>')} |`,
      ),
    '',
    `${candidates.length} of ${tree.edges.length} moves have at least one signal; the top ${Math.min(TOP_N, candidates.length)} are shown.`,
    '',
  ];

  const dir = courseDir(course.id);
  await writeFile(join(dir, 'candidates.md'), report.join('\n'));
  await writeFile(join(dir, 'candidates.json'), `${JSON.stringify(candidates, null, 2)}\n`);
  console.log(`Candidates: ${candidates.length} of ${tree.edges.length} moves have signals`);
  return candidates;
}
