// Exports the Lichess studies listed in content/sources/lichess-studies.txt and
// keeps their annotations inside the Traxler tree, one file per study.
//
//   pnpm spike:studies
import { mkdir, readdir, readFile, rm, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { exportStudy, studyAnnotations, studyId, studySummary, userTitle } from './lichess-studies.ts';
import { SOURCES_DIR } from './sources.ts';
import { type Tree, TRAXLER_DIR } from './tree.ts';

const LIST_FILE = join(SOURCES_DIR, 'lichess-studies.txt');
const TEMPLATE = `# Lichess studies to use as sources, one URL or study ID per line.
# Find them at https://lichess.org/study/search?q=traxler and prefer authors you
# trust (titled players, coaches). Lines starting with # are ignored.
`;

const token = process.env.LICHESS_TOKEN;
const tree = JSON.parse(await readFile(join(TRAXLER_DIR, 'tree.json'), 'utf8')) as Tree;
const scope = new Set(tree.nodes.map((n) => n.key));

await mkdir(SOURCES_DIR, { recursive: true });
const list = await readFile(LIST_FILE, 'utf8').catch(async () => {
  await writeFile(LIST_FILE, TEMPLATE);
  return TEMPLATE;
});
const ids = [
  ...new Set(
    list
      .split('\n')
      .map((line) => line.trim())
      .filter((line) => line && !line.startsWith('#'))
      .map(studyId),
  ),
];
if (ids.length === 0) console.log(`No studies listed; add URLs to ${LIST_FILE}`);

for (const id of ids) {
  const pgn = await exportStudy(id);
  const study = studySummary(id, pgn);
  study.ownerTitle = await userTitle(study.owner, token);
  const collection = studyAnnotations(study, pgn, scope, tree.root.key);
  await writeFile(join(SOURCES_DIR, `lichess-study-${id}.json`), `${JSON.stringify(collection, null, 2)}\n`);
  const author = study.ownerTitle ? `${study.ownerTitle} ${study.owner}` : study.owner;
  console.log(
    `${study.name} by ${author}: ${collection.annotations.length} annotations, ${collection.skipped.length} chapters skipped`,
  );
}

// Drop output for studies no longer listed so coverage only uses the current list.
for (const file of await readdir(SOURCES_DIR)) {
  const match = /^lichess-study-(\w+)\.json$/.exec(file);
  if (match && !ids.includes(match[1]!)) await rm(join(SOURCES_DIR, file));
}
