// Openings and courses. An opening is shared research (its tree; sources live
// in a common pool). A course teaches one opening from one side:
//
//   content/openings/<id>/opening.json   { id, title, root }
//   content/openings/<id>/tree.json
//   content/courses/<id>/course.json     { id, title, opening, learner, stance }
//   content/courses/<id>/lessons/*.json
//   content/courses/<id>/{candidates,coverage,dossier}.*
import { readdir, readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { CONTENT_DIR } from './http.ts';
import type { Tree } from './tree.ts';

export interface OpeningConfig {
  id: string;
  title: string;
  /** Moves from the starting position to the opening's root, e.g. "1. e4 e5 2. Nf3 …". */
  root: string;
}

/** "wield": the learner plays the opening's idea. "face": the learner meets it. */
export type Stance = 'wield' | 'face';

/**
 * backlog → researching (tree and sources being built) → ready (enough sources
 * to teach) → drafting → review → published (every lesson reviewed).
 */
export type CourseStatus = 'backlog' | 'researching' | 'ready' | 'drafting' | 'review' | 'published';

export interface CourseConfig {
  id: string;
  title: string;
  opening: string;
  learner: 'white' | 'black';
  stance: Stance;
  status: CourseStatus;
}

export const openingDir = (id: string) => join(CONTENT_DIR, 'openings', id);
export const courseDir = (id: string) => join(CONTENT_DIR, 'courses', id);
export const lessonsDir = (courseId: string) => join(courseDir(courseId), 'lessons');

const readJson = async <T>(file: string): Promise<T> => JSON.parse(await readFile(file, 'utf8')) as T;

async function listDirs(parent: string): Promise<string[]> {
  const entries = await readdir(parent, { withFileTypes: true }).catch(() => []);
  return entries.filter((e) => e.isDirectory()).map((e) => e.name);
}

export async function loadOpening(id: string): Promise<OpeningConfig> {
  return readJson<OpeningConfig>(join(openingDir(id), 'opening.json')).catch(() => {
    throw new Error(`No opening "${id}": expected ${join(openingDir(id), 'opening.json')}`);
  });
}

export async function loadCourse(id: string): Promise<CourseConfig> {
  return readJson<CourseConfig>(join(courseDir(id), 'course.json')).catch(() => {
    throw new Error(`No course "${id}": expected ${join(courseDir(id), 'course.json')}`);
  });
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
