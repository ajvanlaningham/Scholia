// Starts new content from the schemas' shapes:
//
//   pnpm new-course <opening> [--title "Danish Gambit" --root "1. e4 e5 2. d4 exd4 3. c3"] [--side white] [--stance wield|face]
//     writes opening.json (unless the opening exists) and a course.json per stance
//   pnpm new-lesson <course> <lesson> --start "1. e4 e5 …" [--title "…"]
//     writes a lesson file with the course's learner and sources, ready for sections
//
// Nothing is overwritten. Every file written matches its schema.
import { mkdir, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { playPgnMainline } from '@scholia/chess-core';
import {
  type CourseConfig,
  courseDir,
  type Lesson,
  lessonsDir,
  loadCourse,
  loadOpening,
  type OpeningConfig,
  openingDir,
  type Side,
  type Stance,
} from './config.ts';
import { SCHEMA_VERSION, type SchemaKind, schemaRef, validate } from './schema.ts';

const WIKIBOOKS = { wikibooks: { title: 'Wikibooks: Chess Opening Theory' } };

const other = (side: Side): Side => (side === 'white' ? 'black' : 'white');

/** Plays `moves` from the initial position, with a readable error if they aren't legal. */
function play(moves: string, what: string) {
  try {
    return playPgnMainline(moves).moves;
  } catch (error) {
    throw new Error(`${what} "${moves}" isn't a legal line: ${(error as Error).message}`);
  }
}

export function newOpening(id: string, title: string, root: string, side?: Side): OpeningConfig {
  const moves = play(root, 'The root');
  if (moves.length === 0) throw new Error('The root needs at least one move');
  // The opening is the idea of whoever played its defining (last) move.
  const lastByWhite = moves.length % 2 === 1;
  return { schemaVersion: SCHEMA_VERSION, id, title, root, side: side ?? (lastByWhite ? 'white' : 'black') };
}

export function newCourse(opening: OpeningConfig, stance: Stance): CourseConfig {
  return {
    schemaVersion: SCHEMA_VERSION,
    id: `${opening.id}-${stance}`,
    title: `${stance === 'wield' ? 'Playing' : 'Facing'} the ${opening.title}`,
    opening: opening.id,
    learner: stance === 'wield' ? opening.side : other(opening.side),
    stance,
    status: 'backlog',
    sources: WIKIBOOKS,
  };
}

export function newLesson(course: CourseConfig, opening: OpeningConfig, id: string, start: string, title?: string): Lesson {
  const startKeys = play(start, 'The start').map((m) => m.key);
  const rootKey = play(opening.root, 'The opening root').at(-1)!.key;
  if (!startKeys.includes(rootKey)) {
    throw new Error(`The start "${start}" doesn't pass through the opening's root (${opening.root})`);
  }
  return {
    schemaVersion: SCHEMA_VERSION,
    id,
    course: course.id,
    title: title ?? id.charAt(0).toUpperCase() + id.slice(1).replaceAll('-', ' '),
    learner: course.learner,
    start,
    status: 'drafted',
    sources: course.sources ?? WIKIBOOKS,
    sections: [],
  };
}

/** Writes `data` as a `kind` file with its `$schema` first; refuses to overwrite. */
async function create(kind: SchemaKind, file: string, data: object): Promise<boolean> {
  const problems = validate(kind, data);
  if (problems.length) throw new Error(`Scaffolded ${kind} doesn't match its schema: ${problems.join('; ')}`);
  await mkdir(join(file, '..'), { recursive: true });
  try {
    await writeFile(file, `${JSON.stringify({ $schema: schemaRef(kind, file), ...data }, null, 2)}\n`, { flag: 'wx' });
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== 'EEXIST') throw error;
    console.log(`Exists, left alone: ${file}`);
    return false;
  }
  console.log(`Created ${file}`);
  return true;
}

export async function scaffoldCourses(
  openingId: string,
  options: { title?: string; root?: string; side?: Side; stance?: Stance },
): Promise<void> {
  const existing = await loadOpening(openingId).catch(() => undefined);
  if (existing && (options.title || options.root || options.side)) {
    console.log(`Opening "${openingId}" exists; --title, --root and --side are ignored.`);
  }
  if (!existing && (!options.title || !options.root)) {
    throw new Error(`Opening "${openingId}" is new: give it --title "…" and --root "1. e4 …"`);
  }
  const opening = existing ?? newOpening(openingId, options.title!, options.root!, options.side);
  if (!existing) await create('opening', join(openingDir(openingId), 'opening.json'), opening);

  const stances: Stance[] = options.stance ? [options.stance] : ['wield', 'face'];
  const courses = stances.map((stance) => newCourse(opening, stance));
  for (const course of courses) await create('course', join(courseDir(course.id), 'course.json'), course);

  console.log(`
Next:
  1. pnpm opening ${opening.id}     build the position tree (network; can take an hour)
  2. pnpm sources ${opening.id}     fetch Wikibooks and the listed Lichess studies
  3. pnpm opening ${opening.id}     again, to add source lines and evaluate them
  4. ${courses.map((c) => `pnpm course ${c.id}`).join('\n     ')}
                            candidates, coverage and a dossier to write lessons from
  5. pnpm new-lesson ${courses[0]!.id} <lesson-id> --start "${opening.root}"`);
}

export async function scaffoldLesson(courseId: string, lessonId: string, options: { start?: string; title?: string }): Promise<void> {
  if (!options.start) throw new Error('Give the lesson a --start "1. e4 …" (moves from the initial position)');
  const course = await loadCourse(courseId);
  const lesson = newLesson(course, await loadOpening(course.opening), lessonId, options.start, options.title);
  const created = await create('lesson', join(lessonsDir(courseId), `${lessonId}.json`), lesson);
  if (created) {
    console.log(`
Add sections: each is a line from the start, with steps at the moves to stop on.
The schema (its "$schema" path) describes every field. Then run: pnpm lessons`);
  }
}
