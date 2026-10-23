// Validates and compiles a course's lessons. Rules enforced:
//   - every line, step, and accepted move is legal;
//   - every citation resolves to a real source annotation at that position;
//   - explanation text never appears without a citation;
//   - accepted moves are ones the engine rates as good (or that keep a win);
//   - each lesson belongs to its course and teaches the course's side.
// Writes, per lesson:
//   - <id>.review.md beside the lesson: each draft above the full text it
//     cites, so a human can confirm the summary adds nothing;
//   - the compiled lesson (@scholia/lesson-format) for the web app.
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { type PlayedMove, playPgnMainline, playSan, playSanLine, playUci } from '@scholia/chess-core';
import type {
  Alternative,
  Citation,
  CompiledCourse,
  CompiledLesson,
  CourseIndex,
  CompiledSection,
  CourseLesson,
  EngineNote,
  LessonRef,
  NextOption,
  NextStep,
  Ply,
  Scholium,
} from '@scholia/lesson-format';
import { type CourseConfig, lessonFiles, lessonsDir } from './config.ts';
import { formatScore, moveLoss, winChanceFor } from './evaluation.ts';
import { REPO_ROOT } from './http.ts';
import { totalGames } from './lichess.ts';
import { loadSourceCollections, type MoveAnnotation, type SourceAnnotation } from './sources.ts';
import { edgeId, type Tree } from './tree.ts';

const WEB_CONTENT_DIR = process.env.SCHOLIA_WEB_CONTENT ?? join(REPO_ROOT, 'apps/web/public/content');
// Accepted moves may give up at most this many win-chance points...
const ACCEPTABLE_LOSS = 5;
// ...unless the learner is still this far ahead afterwards (win chance, 0–100):
// in a decided position, any move that keeps the win is a correct answer.
const STILL_WINNING = 80;
const FORMS = ['quote', 'paraphrase', 'model-summary', 'personal-note'];

interface Cite {
  source: string;
  /** Moves from the lesson's start position, e.g. "5.Nxf7 Bxf2+"; "" is the start itself. */
  at: string;
}

interface Explanation {
  text: string | null;
  form?: string;
  status: 'drafted' | 'reviewed';
  cites: Cite[];
}

interface Step {
  move: string;
  /** The line follows a source over the engine's objection; reported, not rejected. */
  disputed?: boolean;
  prompt?: string;
  accept?: string[];
  explanation?: Explanation;
}

interface Lesson {
  id: string;
  course: string;
  title: string;
  learner: 'white' | 'black';
  start: string;
  status: string;
  sources: Record<string, { title: string; author?: string }>;
  intro?: Explanation;
  sections: { id: string; title: string; kind: 'main' | 'trap'; line: string; steps: Step[] }[];
}

export async function compileCourse(
  course: CourseConfig,
  tree: Tree,
): Promise<{ course: CompiledCourse; problems: number }> {
  const LESSONS_DIR = lessonsDir(course.id);
  const nodes = new Map(tree.nodes.map((n) => [n.key, n]));
  const edges = new Map(tree.edges.map((e) => [edgeId(e.from, e.uci), e]));
  const annotations = (await loadSourceCollections()).flatMap((c) => c.annotations);
  const byMove = Map.groupBy(
    annotations.filter((a): a is MoveAnnotation => a.anchor === 'move'),
    (a) => edgeId(a.fromKey, a.uci),
  );

  /** "5.Nxf7 Bxf2+ 6.Kf1" → ["Nxf7", "Bxf2+", "Kf1"] */
  const sansOf = (numbered: string) =>
    numbered
      .split(/\s+/)
      .map((t) => t.replace(/^\d+\.+/, ''))
      .filter((t) => t.length > 0);

  /** "7...Qh4" for Black's 7th move, "8.g3" for White's 8th. */
  function label(fenBefore: string, san: string): string {
    const [, turn, , , , fullmove] = fenBefore.split(' ');
    return turn === 'w' ? `${fullmove}.${san}` : `${fullmove}...${san}`;
  }

  const cleanSourceText = (text: string) =>
    text
      .split(/^==+ ?(?:Theory table|References|See also|External links) ?==+$/m)[0]!
      .replace(/\n{3,}/g, '\n\n')
      .trim();

  const citationOf = (a: SourceAnnotation): Citation => ({
    title: a.source.title,
    ...(a.source.author && { author: a.source.author }),
    ...(a.source.kind !== 'wiki' && a.source.locator && { locator: a.source.locator }),
    ...(a.source.url && { url: a.source.url }),
    symbols: a.symbols ?? [],
    text: cleanSourceText(a.text),
  });

  /** Engine verdict on playing `uci` from `fen`, scored in win-chance points against the best move. */
  function engineNote(fen: string, fromKey: string, uci: string): EngineNote & { loss?: number; keepsWin?: boolean } {
    const from = nodes.get(fromKey);
    const toKey = playUci(fen, uci).key;
    const before = from?.evaluation;
    const after = nodes.get(toKey)?.evaluation?.lines[0] ?? before?.lines.find((l) => l.uci[0] === uci);
    const loss = from && moveLoss(from.sideToMove, uci, before, nodes.get(toKey)?.evaluation);
    const edge = edges.get(edgeId(fromKey, uci));
    const club =
      edge?.games?.lichess && from?.games?.lichess
        ? `${Math.round((100 * totalGames(edge.games.lichess)) / totalGames(from.games.lichess))}% of club players`
        : undefined;
    return {
      verdict: loss === undefined ? 'not evaluated' : before?.lines[0]?.uci[0] === uci ? 'best' : `loses ${loss.toFixed(0)} pts`,
      scoreAfter: formatScore(after),
      good: loss !== undefined && loss < ACCEPTABLE_LOSS,
      ...(club && { club }),
      ...(loss !== undefined && { loss }),
      ...(after && from && { keepsWin: winChanceFor(from.sideToMove, after) >= STILL_WINNING }),
    };
  }

  const quote = (text: string) =>
    text
      .split('\n')
      .map((l) => `> ${l}`)
      .join('\n');

  function reviewScholium(scholium: Scholium | undefined): string[] {
    if (!scholium) return ['_No source commentary: the learner sees the move and the engine evaluation only._', ''];
    const lines = [
      scholium.text === null
        ? '_No text; the source contributes only its judgment._'
        : `**Draft (${scholium.form}, ${scholium.status}):** ${scholium.text}`,
      '',
    ];
    for (const c of scholium.citations) {
      const by = c.author ? ` (${c.author})` : '';
      const where = c.locator ? `, ${c.locator}` : '';
      const symbols = c.symbols.length ? ` ${c.symbols.join('')}` : '';
      lines.push(`<details><summary>Cited: <a href="${c.url}">${c.title}${by}${where}</a>${symbols}</summary>`, '');
      lines.push(c.text ? quote(c.text) : '> _(symbol only)_', '', '</details>', '');
    }
    return lines;
  }

  /** Lessons by the position key they start from, so sections can link to what follows. */
  const files = await lessonFiles(course.id);
  const lessons = await Promise.all(
    files.map(async (f) => JSON.parse(await readFile(join(LESSONS_DIR, f), 'utf8')) as Lesson),
  );
  const lessonsStartingAt = Map.groupBy(
    lessons.map((l) => ({ key: playPgnMainline(l.start).moves.at(-1)?.key ?? '', ref: { id: l.id, title: l.title } })),
    (l) => l.key,
  );
  const startingAt = (key: string, except: string): LessonRef[] =>
    (lessonsStartingAt.get(key) ?? []).map((l) => l.ref).filter((r) => r.id !== except);

  const clubPercent = (note: EngineNote) => Number.parseInt(note.club ?? '0', 10);

  /** The position a section ends in, the opponent's (or learner's) options there, and linked lessons. */
  function nextStep(lessonId: string, fen: string, key: string): NextStep {
    const from = nodes.get(key);
    const ucis = new Set([
      ...tree.edges.filter((e) => e.from === key).map((e) => e.uci),
      ...(from?.evaluation?.lines.map((l) => l.uci[0]!) ?? []),
    ]);
    const options: NextOption[] = [...ucis].map((uci) => {
      const { loss: _loss, keepsWin: _keepsWin, ...engine } = engineNote(fen, key, uci);
      const move = playUci(fen, uci);
      return {
        san: move.san,
        uci,
        engine,
        citations: (byMove.get(edgeId(key, uci)) ?? []).map(citationOf),
        lessons: startingAt(move.key, lessonId),
      };
    });
    options.sort((a, b) => clubPercent(b.engine) - clubPercent(a.engine) || Number(b.engine.verdict === 'best') - Number(a.engine.verdict === 'best'));
    return { fen, lessons: startingAt(key, lessonId), options };
  }

  function compile(lesson: Lesson, problems: string[], notes: string[]): CompiledLesson {
    const startMoves = playPgnMainline(lesson.start).moves;
    const rootFen = startMoves.at(-1)!.fen;
    const rootKey = startMoves.at(-1)!.key;

    function resolveCite(cite: Cite, where: string): SourceAnnotation | undefined {
      const ref = lesson.sources[cite.source];
      if (!ref) {
        problems.push(`${where}: unknown source "${cite.source}"`);
        return undefined;
      }
      let key = rootKey;
      try {
        key = playSanLine(rootFen, sansOf(cite.at)).at(-1)?.key ?? rootKey;
      } catch (error) {
        problems.push(`${where}: citation "${cite.at}" is not a legal line (${(error as Error).message})`);
        return undefined;
      }
      const found = annotations.find(
        (a) => a.toKey === key && a.source.title === ref.title && (!ref.author || a.source.author === ref.author),
      );
      if (!found) problems.push(`${where}: no ${cite.source} annotation at "${cite.at || 'the start'}"`);
      return found;
    }

    function scholium(explanation: Explanation | undefined, where: string): Scholium | undefined {
      if (!explanation) return undefined;
      if (explanation.text !== null && explanation.cites.length === 0) problems.push(`${where}: explanation text without a citation`);
      if (explanation.text !== null && !FORMS.includes(explanation.form ?? '')) problems.push(`${where}: missing or unknown form`);
      return {
        text: explanation.text,
        ...(explanation.form && { form: explanation.form }),
        status: explanation.status,
        citations: explanation.cites
          .map((c) => resolveCite(c, where))
          .filter((a): a is SourceAnnotation => a !== undefined)
          .map(citationOf),
      };
    }

    const sections: CompiledSection[] = [];
    for (const section of lesson.sections) {
      let moves: PlayedMove[];
      try {
        moves = playPgnMainline(`${lesson.start} ${section.line}`).moves.slice(startMoves.length);
      } catch (error) {
        problems.push(`${section.id}: illegal line (${(error as Error).message})`);
        continue;
      }
      const fensBefore = [rootFen, ...moves.map((m) => m.fen)];
      const keysBefore = [rootKey, ...moves.map((m) => m.key)];
      const plies: Ply[] = moves.map((m, i) => {
        const { loss: _loss, keepsWin: _keepsWin, ...engine } = engineNote(fensBefore[i]!, keysBefore[i]!, m.uci);
        return {
          label: label(fensBefore[i]!, m.san),
          san: m.san,
          uci: m.uci,
          fenBefore: fensBefore[i]!,
          fenAfter: m.fen,
          byLearner: (fensBefore[i]!.split(' ')[1] === 'w') === (lesson.learner === 'white'),
          engine,
        };
      });

      let lastIndex = -1;
      for (const step of section.steps) {
        const where = `${section.id} ${step.move}`;
        const index = plies.findIndex((p) => p.label === step.move);
        if (index < 0) {
          problems.push(`${where}: move not in the section's line`);
          continue;
        }
        if (index <= lastIndex) problems.push(`${where}: steps out of order`);
        lastIndex = index;
        const ply = plies[index]!;
        const fen = ply.fenBefore;
        const fromKey = keysBefore[index]!;
        const compiledScholium = scholium(step.explanation, where);

        if (!ply.byLearner) {
          if (step.prompt || step.accept) problems.push(`${where}: opponent step has a prompt or accepted moves`);
          ply.step = { accept: [], ...(compiledScholium && { scholium: compiledScholium }) };
          continue;
        }

        if (!step.prompt) problems.push(`${where}: learner step without a prompt`);
        const accepted = (step.accept ?? []).flatMap((san) => {
          try {
            return [playSan(fen, san)];
          } catch {
            problems.push(`${where}: accepted move ${san} is illegal`);
            return [];
          }
        });
        if (accepted.length === 0) problems.push(`${where}: learner step accepts no moves`);
        if (ply.engine.verdict === 'not evaluated') problems.push(`${where}: the engine hasn't evaluated ${ply.san} (run spike:traxler)`);
        if (!accepted.some((m) => m.uci === ply.uci)) problems.push(`${where}: the line's move isn't accepted`);
        for (const m of accepted) {
          const note = engineNote(fen, fromKey, m.uci);
          if (note.loss === undefined || note.loss < ACCEPTABLE_LOSS) continue;
          if (note.keepsWin) notes.push(`${where}: ${m.san} ${note.verdict} but still wins (${note.scoreAfter})`);
          else if (step.disputed && m.uci === ply.uci) notes.push(`${where}: disputed, ${m.san} ${note.verdict} (source over engine)`);
          else problems.push(`${where}: accepted ${m.san} ${note.verdict}${m.uci === ply.uci ? ' (mark the step "disputed" if a source supports it)' : ''}`);
        }

        // Other moves the learner might try: the engine's candidates, moves played
        // in games, and anything a source discusses here.
        const from = nodes.get(fromKey);
        const candidateUcis = new Set([
          ...(from?.evaluation?.lines.map((l) => l.uci[0]!) ?? []),
          ...tree.edges.filter((e) => e.from === fromKey).map((e) => e.uci),
          ...accepted.map((m) => m.uci),
        ]);
        candidateUcis.delete(ply.uci);
        const alternatives: Alternative[] = [...candidateUcis].map((uci) => {
          const { loss, keepsWin: _keepsWin, ...engine } = engineNote(fen, fromKey, uci);
          const isAccepted = accepted.some((m) => m.uci === uci);
          return {
            san: playUci(fen, uci).san,
            uci,
            accepted: isAccepted,
            engine,
            citations: (byMove.get(edgeId(fromKey, uci)) ?? []).map(citationOf),
          };
        });

        const best = from?.evaluation?.lines[0];
        const dispute =
          step.disputed && best && best.uci[0] !== ply.uci
            ? { engineBest: best.san[0]!, bestScore: formatScore(best), lineScore: ply.engine.scoreAfter }
            : undefined;
        ply.step = {
          prompt: step.prompt ?? '',
          accept: accepted.map((m) => m.uci),
          ...(compiledScholium && { scholium: compiledScholium }),
          ...(dispute && { dispute }),
          alternatives,
        };
      }

      const firstStep = plies.findIndex((p) => p.step !== undefined);
      sections.push({
        id: section.id,
        title: section.title,
        kind: section.kind,
        plies,
        firstStep: Math.max(firstStep, 0),
        next: nextStep(lesson.id, fensBefore.at(-1)!, keysBefore.at(-1)!),
      });
    }

    const intro = scholium(lesson.intro, 'intro');
    return {
      id: lesson.id,
      course: lesson.course,
      title: lesson.title,
      status: lesson.status,
      learner: lesson.learner,
      start: lesson.start,
      startFen: rootFen,
      ...(intro && { intro }),
      sections,
    };
  }

  function review(lesson: CompiledLesson, problems: string[], notes: string[]): string {
    const lines = [
      `# ${lesson.title}`,
      '',
      problems.length ? `⚠ ${problems.length} problem(s): see the end of this page.` : '✓ All checks pass.',
      '',
      `Status: **${lesson.status}** · Learner plays ${lesson.learner} · Starts after ${lesson.start}`,
      '',
      'Each draft sits above the full text it cites. A draft should restate its sources and add nothing. Mark a step `reviewed` in the JSON once you agree.',
      '',
      '## Introduction',
      '',
      ...reviewScholium(lesson.intro),
    ];
    for (const section of lesson.sections) {
      lines.push(`## ${section.kind === 'trap' ? 'Trap' : 'Line'}: ${section.title}`, '', `\`${section.plies.map((p) => p.label).join(' ')}\``, '');
      for (const ply of section.plies) {
        if (!ply.step) continue;
        lines.push(`### ${ply.label}${ply.byLearner ? ' (your move)' : ''}`, '');
        if (ply.byLearner) {
          const accepted = ply.step.accept.map((uci) => playUci(ply.fenBefore, uci).san);
          lines.push(`**Prompt:** ${ply.step.prompt}`, '', `Accepts: ${accepted.join(', ')}`, '');
        }
        lines.push(`Engine on ${ply.san}: ${ply.engine.verdict} (${ply.engine.scoreAfter} after)${ply.engine.club ? ` · ${ply.engine.club}` : ''}`, '');
        lines.push(...reviewScholium(ply.step.scholium));
      }
    }
    if (problems.length) lines.push('## Problems', '', ...problems.map((p) => `- ${p}`), '');
    if (notes.length) lines.push('## Notes', '', ...notes.map((n) => `- ${n}`), '');
    return lines.join('\n');
  }

  await mkdir(join(WEB_CONTENT_DIR, 'lessons', course.id), { recursive: true });
  await mkdir(join(WEB_CONTENT_DIR, 'courses'), { recursive: true });
  const compiledLessons: CompiledLesson[] = [];
  let totalProblems = 0;

  for (const [i, lesson] of lessons.entries()) {
    const problems: string[] = [];
    const notes: string[] = [];
    if (lesson.course !== course.id) problems.push(`${lesson.id}: "course" is "${lesson.course}", expected "${course.id}"`);
    if (lesson.learner !== course.learner) problems.push(`${lesson.id}: learner is ${lesson.learner}, but the course teaches ${course.learner}`);
    const compiled = compile(lesson, problems, notes);
    totalProblems += problems.length;
    compiledLessons.push(compiled);

    await writeFile(join(LESSONS_DIR, files[i]!.replace(/\.json$/, '.review.md')), review(compiled, problems, notes));
    await writeFile(join(WEB_CONTENT_DIR, 'lessons', course.id, `${lesson.id}.json`), `${JSON.stringify(compiled, null, 2)}\n`);

    console.log(`Lesson ${lesson.id}: ${compiled.sections.length} sections, ${problems.length} problems, ${notes.length} notes`);
    for (const p of problems) console.log(`  ✗ ${p}`);
    for (const n of notes) console.log(`  · ${n}`);
  }

  // Course order: each lesson right after the lesson it continues from.
  const continues = new Map<string, { lesson: string; section: string }>();
  for (const l of compiledLessons) {
    for (const s of l.sections) {
      for (const ref of [...s.next.lessons, ...s.next.options.flatMap((o) => o.lessons)]) {
        if (!continues.has(ref.id)) continues.set(ref.id, { lesson: l.id, section: s.id });
      }
    }
  }
  const ordered: CourseLesson[] = [];
  const visit = (l: CompiledLesson) => {
    if (ordered.some((o) => o.id === l.id)) return;
    const from = continues.get(l.id);
    ordered.push({ id: l.id, title: l.title, status: l.status, sections: l.sections.length, ...(from && { continues: from }) });
    const sectionOrder = (c: CompiledLesson) => l.sections.findIndex((s) => s.id === continues.get(c.id)?.section);
    const children = compiledLessons.filter((c) => continues.get(c.id)?.lesson === l.id);
    for (const child of children.sort((a, b) => sectionOrder(a) - sectionOrder(b))) visit(child);
  };
  for (const root of compiledLessons.filter((l) => !continues.has(l.id))) visit(root);
  for (const l of compiledLessons) visit(l); // lessons in a cycle

  const compiledCourse: CompiledCourse = {
    id: course.id,
    title: course.title,
    opening: course.opening,
    learner: course.learner,
    stance: course.stance,
    lessons: ordered,
  };
  await writeFile(join(WEB_CONTENT_DIR, 'courses', `${course.id}.json`), `${JSON.stringify(compiledCourse, null, 2)}\n`);
  return { course: compiledCourse, problems: totalProblems };
}

/** Lists every compiled course for the web app's home page. */
export async function writeCourseIndex(courses: CompiledCourse[]): Promise<void> {
  const index: CourseIndex = {
    courses: courses.map(({ lessons, ...summary }) => ({ ...summary, lessons: lessons.length })),
  };
  await mkdir(WEB_CONTENT_DIR, { recursive: true });
  await writeFile(join(WEB_CONTENT_DIR, 'index.json'), `${JSON.stringify(index, null, 2)}\n`);
}
