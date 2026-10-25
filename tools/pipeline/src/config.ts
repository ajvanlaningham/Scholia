// Openings and courses. An opening is shared research (its tree; sources live
// in a common pool). A course teaches one opening from one side:
//
//   content/openings/<id>/opening.json   { id, title, root, side }
//   content/openings/<id>/tree.json
//   content/courses/<id>/course.json     { id, title, opening, learner, stance, status }
//   content/courses/<id>/lessons/*.json
//   content/courses/<id>/{candidates,coverage,dossier}.*
//
// Authored files are validated against tools/pipeline/schemas on load; the
// types below mirror those schemas.
import { readdir, readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { CONTENT_DIR } from './http.ts';
import { type SchemaKind, validate } from './schema.ts';
import type { Tree } from './tree.ts';

export type Side = 'white' | 'black';

export interface OpeningConfig {
  schemaVersion: number;
  id: string;
  title: string;
  /** Moves from the starting position to the opening's root, e.g. "1. e4 e5 2. Nf3 …". */
  root: string;
  /** Whose idea the opening is: the side a "wield" course teaches. */
  side: Side;
}

/** "wield": the learner plays the opening's idea. "face": the learner meets it. */
export type Stance = 'wield' | 'face';

/**
 * backlog → researching (tree and sources being built) → ready (enough sources
 * to teach) → drafting → review → published (every lesson reviewed).
 */
export type CourseStatus = 'backlog' | 'researching' | 'ready' | 'drafting' | 'review' | 'published';

export interface CourseConfig {
  schemaVersion: number;
  id: string;
  title: string;
  opening: string;
  learner: Side;
  stance: Stance;
  status: CourseStatus;
  /** Sources the overview cites, by key: { title, author? }. */
  sources?: Record<string, { title: string; author?: string }>;
  /**
   * "About this opening": a summary of cited sources, written like a lesson
   * explanation. Citations' `at` is relative to the opening's root position.
   */
  overview?: Explanation;
}

export interface Cite {
  source: string;
  /** Moves from the lesson's start position, e.g. "5.Nxf7 Bxf2+"; "" is the start itself. */
  at: string;
}

export interface Explanation {
  text: string | null;
  form?: string;
  status: 'drafted' | 'reviewed';
  cites: Cite[];
  /** Fingerprint of the cited text when the explanation was reviewed; stamped by the checker. */
  reviewedAgainst?: string;
}

export interface Step {
  move: string;
  /** The line follows a source over the engine's objection; reported, not rejected. */
  disputed?: boolean;
  prompt?: string;
  accept?: string[];
  explanation?: Explanation;
}

export interface Lesson {
  schemaVersion: number;
  id: string;
  course: string;
  title: string;
  /** One line on what the lesson covers (a description, not a chess claim). */
  summary?: string;
  learner: Side;
  start: string;
  status: 'drafted' | 'reviewed';
  sources: Record<string, { title: string; author?: string }>;
  intro?: Explanation;
  sections: { id: string; title: string; kind: 'main' | 'trap'; line: string; steps: Step[] }[];
}

export const openingDir = (id: string) => join(CONTENT_DIR, 'openings', id);
export const courseDir = (id: string) => join(CONTENT_DIR, 'courses', id);
export const lessonsDir = (courseId: string) => join(courseDir(courseId), 'lessons');

const readJson = async <T>(file: string): Promise<T> => JSON.parse(await readFile(file, 'utf8')) as T;

/** Reads and validates an opening or course file; any problem stops the command. */
async function readChecked<T extends { id: string }>(kind: SchemaKind, id: string, file: string, missing: string): Promise<T> {
  const data = await readJson<T>(file).catch((error: NodeJS.ErrnoException) => {
    throw error.code === 'ENOENT' ? new Error(missing) : new Error(`${file}: ${error.message}`);
  });
  const problems = validate(kind, data);
  if (problems.length === 0 && data.id !== id) problems.push(`"id" is "${data.id}", but the directory is ${id}`);
  if (problems.length) throw new Error(`${file} doesn't match the ${kind} schema:\n  ${problems.join('\n  ')}`);
  return data;
}

async function listDirs(parent: string): Promise<string[]> {
  const entries = await readdir(parent, { withFileTypes: true }).catch(() => []);
  return entries.filter((e) => e.isDirectory()).map((e) => e.name);
}

export async function loadOpening(id: string): Promise<OpeningConfig> {
  const file = join(openingDir(id), 'opening.json');
  return readChecked<OpeningConfig>('opening', id, file, `No opening "${id}": expected ${file} (pnpm new-course ${id} creates one)`);
}

export async function loadCourse(id: string): Promise<CourseConfig> {
  const file = join(courseDir(id), 'course.json');
  return readChecked<CourseConfig>('course', id, file, `No course "${id}": expected ${file}`);
}

export async function listOpenings(): Promise<OpeningConfig[]> {
  return Promise.all((await listDirs(join(CONTENT_DIR, 'openings'))).map(loadOpening));
}

export async function listCourses(): Promise<CourseConfig[]> {
  return Promise.all((await listDirs(join(CONTENT_DIR, 'courses'))).map(loadCourse));
}

export async function loadTree(openingId: string): Promise<Tree> {
  return readJson<Tree>(join(openingDir(openingId), 'tree.json')).catch(() => {
    throw new Error(`No tree for opening "${openingId}"; run: pnpm opening ${openingId}`);
  });
}

/** Lesson source files of a course (not review pages). */
export async function lessonFiles(courseId: string): Promise<string[]> {
  return (await readdir(lessonsDir(courseId)).catch(() => [])).filter((f) => f.endsWith('.json'));
}

/**
 * A course's lessons, each with its file name. A lesson that isn't valid JSON or
 * doesn't match the schema comes back with its problems and no lesson.
 */
export async function loadLessons(courseId: string): Promise<{ file: string; lesson?: Lesson; problems: string[] }[]> {
  return Promise.all(
    (await lessonFiles(courseId)).map(async (file) => {
      let data: unknown;
      try {
        data = await readJson(join(lessonsDir(courseId), file));
      } catch (error) {
        return { file, problems: [`not valid JSON (${(error as Error).message})`] };
      }
      const problems = validate('lesson', data);
      const id = (data as { id?: unknown }).id;
      if (problems.length === 0 && `${id}.json` !== file) problems.push(`"id" is "${id}", but the file is ${file}`);
      return problems.length ? { file, problems } : { file, lesson: data as Lesson, problems };
    }),
  );
}
