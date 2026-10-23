// Scheduled refresh, meant to run unattended (see tools/systemd):
//   1. refetch sources and game data older than REFRESH_MAX_AGE;
//   2. rebuild every opening's tree and every course's reports;
//   3. re-check every lesson, which flags reviews whose cited text changed;
//   4. write content/reports/<date>.md;
//   5. commit sources/, openings/ and reports/ to the content repo, then push.
//      Lessons are never committed automatically, so in-progress edits stay
//      the author's (though earlier commits of them are pushed).
// Each stage records its failure and the run continues.
import { execFile } from 'node:child_process';
import { createHash } from 'node:crypto';
import { access, mkdir, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { promisify } from 'node:util';
import { buildTree } from './build-tree.ts';
import { compileAllCourses } from './check-lessons.ts';
import { listCourses, listOpenings, loadTree } from './config.ts';
import { writeCoverage } from './coverage.ts';
import { writeDossier } from './dossier.ts';
import { fetchStudies, fetchWikibooks } from './fetch-sources.ts';
import { CONTENT_DIR, setMaxCacheAge } from './http.ts';
import { rankCandidates } from './rank-candidates.ts';
import { loadSourceCollections } from './sources.ts';

const REFRESH_MAX_AGE_MS = 6 * 24 * 60 * 60 * 1000;
const COMMITTED_PATHS = ['sources', 'openings', 'reports'];
const git = promisify(execFile);

interface Snapshot {
  /** Source annotation → fingerprint of its text and symbols, with a readable label. */
  sources: Map<string, { fingerprint: string; label: string }>;
  trees: Map<string, { positions: number; moves: number; best: Map<string, string | undefined> }>;
}

async function snapshot(): Promise<Snapshot> {
  const sources = new Map<string, { fingerprint: string; label: string }>();
  for (const collection of await loadSourceCollections()) {
    for (const a of collection.annotations) {
      const anchor = a.anchor === 'move' ? `${a.fromKey} ${a.uci}` : a.toKey;
      const fingerprint = createHash('sha256').update(JSON.stringify([a.text, a.symbols])).digest('hex');
      const label = `${a.source.title}${a.source.locator && a.source.kind !== 'wiki' ? `, ${a.source.locator}` : ''}: ${a.line}`;
      sources.set(`${collection.adapter}|${anchor}|${a.source.locator ?? ''}`, { fingerprint, label });
    }
  }
  const trees: Snapshot['trees'] = new Map();
  for (const opening of await listOpenings()) {
    const tree = await loadTree(opening.id).catch(() => undefined);
    if (!tree) continue;
    trees.set(opening.id, {
      positions: tree.nodes.length,
      moves: tree.edges.length,
      best: new Map(tree.nodes.map((n) => [n.key, n.evaluation?.lines[0]?.uci[0]])),
    });
  }
  return { sources, trees };
}

/** `refetch: false` reuses cached responses: the same run, without the network wait. */
export async function refresh({ refetch = true } = {}): Promise<void> {
  const startedAt = new Date();
  const errors: string[] = [];
  const stage = async (name: string, run: () => Promise<unknown>) => {
    try {
      await run();
    } catch (error) {
      errors.push(`${name}: ${(error as Error).message}`);
      console.error(`✗ ${name}:`, error);
    }
  };

  const before = await snapshot();
  const openings = await listOpenings();

  if (refetch) setMaxCacheAge(REFRESH_MAX_AGE_MS);
  for (const opening of openings) await stage(`Wikibooks for ${opening.id}`, () => fetchWikibooks(opening));
  await stage('Lichess studies', fetchStudies);
  for (const opening of openings) await stage(`tree for ${opening.id}`, () => buildTree(opening));
  setMaxCacheAge(undefined);

  for (const course of await listCourses()) {
    await stage(`reports for ${course.id}`, async () => {
      const tree = await loadTree(course.opening);
      const candidates = await rankCandidates(course, tree);
      await writeCoverage(course, tree, candidates);
      await writeDossier(course, tree, candidates);
    });
  }
  let results: Awaited<ReturnType<typeof compileAllCourses>> = [];
  await stage('lesson checks', async () => {
    results = await compileAllCourses();
  });

  const after = await snapshot();
  const report = renderReport(startedAt, new Date(), errors, before, after, results);
  const date = startedAt.toISOString().slice(0, 10);
  await mkdir(join(CONTENT_DIR, 'reports'), { recursive: true });
  const reportFile = join(CONTENT_DIR, 'reports', `${date}.md`);
  await writeFile(reportFile, report);
  console.log(`\nWrote ${reportFile}`);

  await commitGathered(date);
  await push();
}

function renderReport(
  startedAt: Date,
  finishedAt: Date,
  errors: string[],
  before: Snapshot,
  after: Snapshot,
  results: Awaited<ReturnType<typeof compileAllCourses>>,
): string {
  const lines = [
    `# Refresh ${startedAt.toISOString().slice(0, 10)}`,
    '',
    `Ran ${startedAt.toISOString()} to ${finishedAt.toISOString()}.`,
    '',
  ];
  if (errors.length) lines.push('## Errors', '', ...errors.map((e) => `- ${e}`), '');

  lines.push('## Courses', '', '| Course | Status | Reviewed | Publishable | Problems |', '|---|---|---|---|---|');
  for (const { course, problems } of results) {
    lines.push(`| ${course.title} | ${course.status} | ${course.review.reviewed}/${course.review.total} | ${course.publishable ? 'yes' : 'no'} | ${problems} |`);
  }
  const issues = results.flatMap((r) => r.issues.map((i) => `${r.course.id} / ${i}`));
  lines.push('', issues.length ? '### Problems\n' : 'No lesson problems.', ...issues.map((i) => `- ${i}`), '');

  const changed = [...after.sources].filter(([id, s]) => before.sources.has(id) && before.sources.get(id)!.fingerprint !== s.fingerprint);
  const added = [...after.sources.keys()].filter((id) => !before.sources.has(id));
  const removed = [...before.sources.keys()].filter((id) => !after.sources.has(id));
  lines.push('## Sources', '', `${after.sources.size} annotations: ${changed.length} changed, ${added.length} added, ${removed.length} removed.`, '');
  if (changed.length) lines.push('Changed text (any lesson citing these will show a stale review above):', '', ...changed.map(([, s]) => `- ${s.label}`), '');
  if (removed.length) lines.push('Removed:', '', ...removed.map((id) => `- ${before.sources.get(id)!.label}`), '');

  lines.push('## Trees', '');
  for (const [id, now] of after.trees) {
    const was = before.trees.get(id);
    const bestChanged = was ? [...now.best].filter(([key, uci]) => was.best.has(key) && was.best.get(key) !== uci).length : 0;
    lines.push(
      was
        ? `- ${id}: ${was.positions} → ${now.positions} positions, ${was.moves} → ${now.moves} moves; the engine's best move changed at ${bestChanged} positions`
        : `- ${id}: new, ${now.positions} positions`,
    );
  }
  return `${lines.join('\n')}\n`;
}

const inContent = (...args: string[]) => git('git', ['-C', CONTENT_DIR, ...args]);

/** Pushes the content repo, which makes the remote a weekly backup. Failures are logged, not fatal. */
async function push(): Promise<void> {
  const remote = await inContent('remote').then((r) => r.stdout.trim(), () => '');
  if (!remote) return;
  try {
    await inContent('push', '--quiet');
    console.log('Pushed the content repo.');
  } catch (error) {
    console.error(`✗ push failed: ${(error as Error).message}`);
    process.exitCode = 1;
  }
}

/** Commits gathered data and the report, if the content directory is a git repo with changes. */
async function commitGathered(date: string): Promise<void> {
  try {
    await access(join(CONTENT_DIR, '.git'));
  } catch {
    console.log('Content directory is not a git repo; nothing committed.');
    return;
  }
  await inContent('add', '--', ...COMMITTED_PATHS);
  const staged = await inContent('diff', '--cached', '--quiet', '--', ...COMMITTED_PATHS).then(
    () => false,
    () => true,
  );
  if (!staged) {
    console.log('No changes to commit.');
    return;
  }
  await inContent('commit', '-q', '-m', `Refresh ${date}`, '--', ...COMMITTED_PATHS);
  console.log(`Committed refresh ${date} to the content repo.`);
}
