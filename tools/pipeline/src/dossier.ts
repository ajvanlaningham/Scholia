// Side-by-side evidence for each top teaching candidate: everything each source
// says about the move, how each source judges it, and how that compares with
// the engine and with what players actually choose. This is the raw material
// for writing a lesson step; it decides nothing itself.
import { writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { type CourseConfig, courseDir } from './config.ts';
import { formatScore, moveLoss, whiteWinChance, winChanceFor } from './evaluation.ts';
import { type Counts, totalGames } from './lichess.ts';
import { loadSourceCollections, type MoveAnnotation, type SourceAnnotation } from './sources.ts';
import { edgeId, type Tree, type TreeEdge } from './tree.ts';

const TOP_N = 15;
// Engine verdicts, in win-chance points lost versus the best move.
const INACCURACY = 5;
const MISTAKE = 10;
// Below this win chance for the side to move, the game is already decided.
const DECIDED = 20;

type Verdict = 'good' | 'speculative' | 'dubious' | 'bad';

const SYMBOL_VERDICTS: Record<string, Verdict> = {
  '!!': 'good',
  '!': 'good',
  '□': 'good',
  '!?': 'speculative',
  '?!': 'dubious',
  '?': 'bad',
  '??': 'bad',
};

interface RankedCandidate {
  from: string;
  uci: string;
  line: string;
  signals: { signal: string; detail: string }[];
}

const engineVerdict = (loss: number | undefined): Verdict | undefined =>
  loss === undefined ? undefined : loss < INACCURACY ? 'good' : loss < MISTAKE ? 'dubious' : 'bad';

const sourceVerdict = (a: SourceAnnotation): Verdict | undefined =>
  a.symbols?.map((s) => SYMBOL_VERDICTS[s]).find((v) => v !== undefined);

// Position assessments, as the range of White's win chance (0–100) they claim.
// Ranges are generous: only a clear contradiction should be flagged.
const ASSESSMENTS: Record<string, [number, number]> = {
  '+−': [65, 100],
  '±': [52, 100],
  '⩲': [45, 100],
  '=': [30, 70],
  '⩱': [0, 55],
  '∓': [0, 48],
  '−+': [0, 35],
};

// "!?" claims practical interest, not objective soundness, so it never conflicts.
const conflicts = (source: Verdict, engine: Verdict) =>
  (source === 'good' && engine === 'bad') || (source === 'bad' && engine === 'good');

const share = (part: Counts | undefined, whole: Counts | undefined) =>
  part && whole && totalGames(whole) > 0 ? `${Math.round((100 * totalGames(part)) / totalGames(whole))}%` : '—';

const quote = (text: string) =>
  text
    .trim()
    .split('\n')
    .map((l) => `> ${l}`)
    .join('\n');

const documentOf = (a: SourceAnnotation) =>
  [a.source.title, a.source.author, a.source.kind === 'wiki' ? undefined : a.source.locator].filter(Boolean).join(' · ');

// Chapters of one study are one source when counting how many sources agree.
const sourceCount = (found: SourceAnnotation[]) => new Set(found.map((a) => `${a.source.title} · ${a.source.author ?? ''}`)).size;

export async function writeDossier(course: CourseConfig, tree: Tree, candidates: RankedCandidate[]): Promise<void> {
  const annotations = (await loadSourceCollections()).flatMap((c) => c.annotations);
  const nodes = new Map(tree.nodes.map((n) => [n.key, n]));
  const edges = new Map(tree.edges.map((e) => [edgeId(e.from, e.uci), e]));
  const byMove = Map.groupBy(
    annotations.filter((a): a is MoveAnnotation => a.anchor === 'move'),
    (a) => edgeId(a.fromKey, a.uci),
  );

  function sourcesSection(found: SourceAnnotation[], engine: Verdict | undefined): string[] {
    if (found.length === 0) return ['_No source discusses this move._'];
    return [...Map.groupBy(found, documentOf).entries()].flatMap(([doc, notes]) => {
      const verdict = notes.map(sourceVerdict).find((v) => v !== undefined);
      const symbols = [...new Set(notes.flatMap((n) => n.symbols ?? []))].join(' ');
      const flag = verdict && engine && conflicts(verdict, engine) ? ` ⚠ engine says ${engine}` : '';
      const texts = [...new Set(notes.map((n) => n.text).filter((t) => t.length > 0))];
      return [
        `**[${doc}](${notes[0]!.source.url})**${symbols ? ` judges it **${symbols}** (${verdict ?? 'unclassified'})` : ''}${flag}`,
        '',
        texts.length > 0 ? texts.map(quote).join('\n>\n') : '_Symbol only, no text._',
        '',
      ];
    });
  }

  function candidateSection(rank: number, c: RankedCandidate, edge: TreeEdge): { lines: string[]; row: string } {
    const from = nodes.get(edge.from)!;
    const to = nodes.get(edge.to)!;
    const found = byMove.get(edgeId(edge.from, edge.uci)) ?? [];
    const loss = moveLoss(from.sideToMove, edge.uci, from.evaluation, to.evaluation);
    const engine = engineVerdict(loss);
    const isBest = from.evaluation?.lines[0]?.uci[0] === edge.uci;
    const verdicts = found.map(sourceVerdict).filter((v): v is Verdict => v !== undefined);
    const disputed = engine !== undefined && verdicts.some((v) => conflicts(v, engine));
    const split = verdicts.some((a) => verdicts.some((b) => conflicts(a, b)));

    const options = (from.evaluation?.lines ?? []).map((l) => `${l.san[0]} ${formatScore(l)}`).join(' · ');
    const evalSource = from.evaluation ? `${from.evaluation.origin}, depth ${from.evaluation.depth}` : 'no evaluation';
    const engineText =
      loss === undefined ? 'unknown' : isBest ? 'best move' : `${engine}, loses ${loss.toFixed(0)} win-chance pts`;

    const lines = [
      `## ${rank}. ${edge.line}`,
      '',
      `Ranked for: ${c.signals.map((s) => `**${s.signal}** (${s.detail})`).join('; ')}`,
      '',
      '| | |',
      '|---|---|',
      `| Engine's options before the move | ${options || '—'} (${evalSource}) |`,
      `| Engine on ${edge.san} | ${formatScore(to.evaluation?.lines[0])} after the move: ${engineText} |`,
      `| Who plays ${edge.san} here | club ${share(edge.games?.lichess, from.games?.lichess)} · masters ${share(edge.games?.masters, from.games?.masters)} |`,
      '',
      `### Sources (${sourceCount(found)})`,
      '',
      ...sourcesSection(found, engine),
    ];
    if (disputed) lines.push('⚠ **A source disagrees with the engine.** Show both views in the lesson; check whether the source is older analysis or means practical rather than objective strength.', '');
    if (split) lines.push('⚠ **Sources disagree with each other.**', '');

    const sourceSymbols = [...new Set(found.flatMap((a) => a.symbols ?? []))].join(' ') || '—';
    const flags = [disputed && 'vs engine', split && 'between sources'].filter(Boolean).join(', ') || '—';
    return {
      lines,
      row: `| ${rank} | ${edge.line} | ${sourceCount(found)} | ${isBest ? 'best' : (engine ?? '—')} | ${sourceSymbols} | ${flags} |`,
    };
  }

  interface Claim {
    annotation: MoveAnnotation;
    claim: string;
    engine: string;
    conflict: boolean;
  }

  // Every judgment any source makes, checked against the engine.
  function claimsOf(a: MoveAnnotation): Claim[] {
    const edge = edges.get(edgeId(a.fromKey, a.uci));
    if (!edge) return [];
    const from = nodes.get(edge.from)!;
    const after = nodes.get(edge.to)!.evaluation?.lines[0];
    const claims: Claim[] = [];
    const verdict = sourceVerdict(a);
    if (verdict) {
      const loss = moveLoss(from.sideToMove, edge.uci, from.evaluation, nodes.get(edge.to)!.evaluation);
      const engine = engineVerdict(loss);
      const isBest = from.evaluation?.lines[0]?.uci[0] === edge.uci;
      const best = from.evaluation?.lines[0];
      // In a position already lost (or won), every move scores about the same, so
      // "?" means "walks into the finish" — a practical judgment the engine can't
      // contradict. The real mistake came earlier.
      const decided = best !== undefined && Math.abs(winChanceFor(from.sideToMove, best) - 50) > 50 - DECIDED;
      const engineText = loss === undefined ? 'no evaluation' : isBest ? 'best move' : `${engine}, loses ${loss.toFixed(0)} pts`;
      claims.push({
        annotation: a,
        claim: `${a.san}${a.symbols!.find((s) => SYMBOL_VERDICTS[s])} (${verdict})`,
        engine: decided ? `${engineText}; already decided (${formatScore(best)}): practical judgment` : engineText,
        conflict: !decided && engine !== undefined && conflicts(verdict, engine),
      });
    }
    for (const symbol of a.symbols ?? []) {
      const range = ASSESSMENTS[symbol];
      if (!range) continue;
      const white = after && whiteWinChance(after);
      claims.push({
        annotation: a,
        claim: `${symbol} after ${a.san}`,
        engine: after ? `${formatScore(after)} (White ${white!.toFixed(0)}% win chance)` : 'no evaluation',
        conflict: white !== undefined && (white < range[0] || white > range[1]),
      });
    }
    return claims;
  }

  const claims = annotations
    .filter((a): a is MoveAnnotation => a.anchor === 'move')
    .flatMap(claimsOf)
    .sort((a, b) => Number(b.conflict) - Number(a.conflict) || a.annotation.line.localeCompare(b.annotation.line));

  const sections = candidates.slice(0, TOP_N).map((c, i) => candidateSection(i + 1, c, edges.get(edgeId(c.from, c.uci))!));
  const overview = annotations.filter((a) => a.toKey === tree.root.key);

  const report = [
    `# ${course.title}: dossier`,
    '',
    `What every source says about the top ${sections.length} teaching candidates, next to the engine and game data.`,
    'Verdicts: a source\'s symbols (! ?! ? !?) vs the engine (good < 5, dubious < 10, bad ≥ 10 win-chance pts lost).',
    '',
    '| # | Line | Sources | Engine | Source symbols | Disagreement |',
    '|---|---|---|---|---|---|',
    ...sections.map((s) => s.row),
    '',
    `## Source claims checked (${claims.length}, ${claims.filter((c) => c.conflict).length} disputed)`,
    '',
    'Every move judgment and position assessment any source makes, against the engine. Disputed claims first.',
    '',
    '| | Line | Source | Claim | Engine | Comment |',
    '|---|---|---|---|---|---|',
    ...claims.map(
      (c) =>
        `| ${c.conflict ? '⚠' : '✓'} | ${c.annotation.line} | ${documentOf(c.annotation)} | ${c.claim} | ${c.engine} | ${c.annotation.text.replace(/\s+/g, ' ').replace(/\|/g, '\\|').slice(0, 120)} |`,
    ),
    '',
    `## Overview: the ${tree.opening} position itself`,
    '',
    ...sourcesSection(overview, undefined),
    ...sections.flatMap((s) => s.lines),
  ];

  await writeFile(join(courseDir(course.id), 'dossier.md'), report.join('\n'));
  console.log(`Wrote dossier.md for ${sections.length} candidates; ${claims.length} source claims checked, ${claims.filter((c) => c.conflict).length} disputed`);
}
