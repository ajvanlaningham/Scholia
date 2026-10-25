// Fills the shared source pool (content/sources):
//   - Wikibooks "Chess Opening Theory" pages under an opening's root;
//   - the Lichess studies listed in content/sources/lichess-studies.txt,
//     keeping moves inside any opening's tree.
import { mkdir, readdir, readFile, rm, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { playPgnMainline } from '@scholia/chess-core';
import { listOpenings, loadTree, type OpeningConfig } from './config.ts';
import { exportStudy, studyAnnotations, studyId, studySummary, userTitle } from './lichess-studies.ts';
import { SOURCES_DIR } from './sources.ts';
import { fetchSubtree } from './wikibooks.ts';

const STUDY_LIST = join(SOURCES_DIR, 'lichess-studies.txt');
const STUDY_LIST_TEMPLATE = `# Lichess studies to use as sources, one URL or study ID per line.
# Find them at https://lichess.org/study/search and prefer authors you trust
# (titled players, coaches). Lines starting with # are ignored.
`;

export async function fetchWikibooks(opening: OpeningConfig): Promise<void> {
  const collection = await fetchSubtree(playPgnMainline(opening.root).moves.map((m) => m.san));
  await mkdir(SOURCES_DIR, { recursive: true });
  const file = join(SOURCES_DIR, `wikibooks-${opening.id}.json`);
  await writeFile(file, `${JSON.stringify(collection, null, 2)}\n`);

  const lengths = collection.annotations.map((a) => a.text.length).sort((a, b) => a - b);
  console.log(`Wikibooks: ${collection.annotations.length} pages anchored, ${collection.skipped.length} skipped`);
  console.log(`  text length: median ${lengths[Math.floor(lengths.length / 2)] ?? 0} chars, longest ${lengths.at(-1) ?? 0}`);
  for (const { item, reason } of collection.skipped) console.log(`  skipped ${item}: ${reason}`);
}

export async function fetchStudies(): Promise<void> {
  const token = process.env.LICHESS_TOKEN;
  // A study's moves count if they fall inside any opening's tree.
  const trees = await Promise.all((await listOpenings()).map((o) => loadTree(o.id).catch(() => undefined)));
  const scope = new Set<string>();
  const rootByKey = new Map<string, string>();
  for (const tree of trees.filter((t) => t !== undefined)) {
    for (const node of tree.nodes) {
      scope.add(node.key);
      if (!rootByKey.has(node.key)) rootByKey.set(node.key, tree.root.key);
    }
  }
  if (scope.size === 0) throw new Error('No opening trees yet; run: pnpm opening <id>');

  await mkdir(SOURCES_DIR, { recursive: true });
  const list = await readFile(STUDY_LIST, 'utf8').catch(async () => {
    await writeFile(STUDY_LIST, STUDY_LIST_TEMPLATE);
    return STUDY_LIST_TEMPLATE;
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
  if (ids.length === 0) console.log(`No studies listed; add URLs to ${STUDY_LIST}`);

  // One study that can't be fetched doesn't stop the others; its earlier export, if any, is kept.
  const failed: string[] = [];
  for (const id of ids) {
    let pgn: string;
    try {
      pgn = await exportStudy(id);
    } catch (error) {
      const status = /failed with (\d+)/.exec((error as Error).message)?.[1];
      const why = status === '403' ? 'export refused (403): the study is private, or its owner limits sharing' : (error as Error).message.slice(0, 200);
      console.log(`Study ${id}: ${why}`);
      failed.push(`${id} (${why})`);
      continue;
    }
    const study = studySummary(id, pgn);
    study.ownerTitle = await userTitle(study.owner, token);
    const collection = studyAnnotations(study, pgn, scope, (key) => rootByKey.get(key));
    await writeFile(join(SOURCES_DIR, `lichess-study-${id}.json`), `${JSON.stringify(collection, null, 2)}\n`);
    const author = study.ownerTitle ? `${study.ownerTitle} ${study.owner}` : study.owner;
    console.log(`Study "${study.name}" by ${author}: ${collection.annotations.length} annotations, ${collection.skipped.length} chapters skipped`);
  }

  // Drop output for studies no longer listed so courses only use the current list.
  for (const file of await readdir(SOURCES_DIR)) {
    const match = /^lichess-study-(\w+)\.json$/.exec(file);
    if (match && !ids.includes(match[1]!)) await rm(join(SOURCES_DIR, file));
  }
  if (failed.length) throw new Error(`${failed.length} listed ${failed.length === 1 ? 'study' : 'studies'} couldn't be fetched: ${failed.join('; ')}`);
}
