// Scholia content pipeline.
//
//   pnpm opening <id>   build the opening's tree (explorer, sources, lessons, evaluations)
//   pnpm sources <id>   fetch Wikibooks for the opening, and every listed Lichess study
//   pnpm course <id>    rank candidates, write coverage and dossier, compile lessons
//   pnpm lessons        compile every course's lessons (fast; no network)
//
// Typical order for a new opening: opening → sources → opening (again, to add
// source lines and their evaluations) → course.
import { listCourses, loadCourse, loadOpening, loadTree } from './config.ts';
import { writeCoverage } from './coverage.ts';
import { writeDossier } from './dossier.ts';
import { fetchStudies, fetchWikibooks } from './fetch-sources.ts';
import { buildTree } from './build-tree.ts';
import { compileCourse, writeCourseIndex } from './check-lessons.ts';
import { rankCandidates } from './rank-candidates.ts';

const [command, id] = process.argv.slice(2);

async function compileAll(): Promise<number> {
  const compiled = [];
  let problems = 0;
  for (const course of await listCourses()) {
    console.log(`\n${course.title} (${course.id})`);
    const result = await compileCourse(course, await loadTree(course.opening));
    compiled.push(result.course);
    problems += result.problems;
  }
  await writeCourseIndex(compiled);
  return problems;
}

function requireId(): string {
  if (!id) throw new Error(`Usage: pnpm ${command} <id>`);
  return id;
}

switch (command) {
  case 'opening':
    await buildTree(await loadOpening(requireId()));
    break;
  case 'sources':
    await fetchWikibooks(await loadOpening(requireId()));
    await fetchStudies();
    break;
  case 'course': {
    const course = await loadCourse(requireId());
    const tree = await loadTree(course.opening);
    const candidates = await rankCandidates(course, tree);
    await writeCoverage(course, tree, candidates);
    await writeDossier(course, tree, candidates);
    if ((await compileAll()) > 0) process.exitCode = 1;
    break;
  }
  case 'lessons':
    if ((await compileAll()) > 0) process.exitCode = 1;
    break;
  default:
    console.error('Usage: pnpm opening|sources|course <id>, or pnpm lessons');
    process.exitCode = 2;
}
