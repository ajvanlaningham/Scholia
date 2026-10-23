// Scholia content pipeline.
//
//   pnpm opening <id>   build the opening's tree (explorer, sources, lessons, evaluations)
//   pnpm sources <id>   fetch Wikibooks for the opening, and every listed Lichess study
//   pnpm course <id>    rank candidates, write coverage and dossier, compile lessons
//   pnpm lessons        compile every course's lessons (fast; no network)
//   pnpm refresh        refetch, rebuild, re-check, report, commit gathered data
//                       (--cached: same, from cached responses)
//
// Typical order for a new opening: opening → sources → opening (again, to add
// source lines and their evaluations) → course.
import { loadCourse, loadOpening, loadTree } from './config.ts';
import { writeCoverage } from './coverage.ts';
import { writeDossier } from './dossier.ts';
import { fetchStudies, fetchWikibooks } from './fetch-sources.ts';
import { buildTree } from './build-tree.ts';
import { compileAllCourses } from './check-lessons.ts';
import { rankCandidates } from './rank-candidates.ts';
import { refresh } from './refresh.ts';

const [command, id] = process.argv.slice(2);

const compileAll = async () => (await compileAllCourses()).reduce((n, r) => n + r.problems, 0);

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
  case 'refresh':
    await refresh({ refetch: id !== '--cached' });
    break;
  case 'lessons':
    if ((await compileAll()) > 0) process.exitCode = 1;
    break;
  default:
    console.error('Usage: pnpm opening|sources|course <id>, pnpm lessons, or pnpm refresh [--cached]');
    process.exitCode = 2;
}
