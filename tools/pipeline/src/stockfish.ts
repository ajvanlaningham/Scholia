import { type ChildProcessWithoutNullStreams, spawn } from 'node:child_process';
import { createHash } from 'node:crypto';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { createInterface } from 'node:readline';
import { positionKey, sideToMove } from '@scholia/chess-core';
import { engineLine, type Evaluation } from './evaluation.ts';
import { REPO_ROOT } from './http.ts';

const CACHE_DIR = join(REPO_ROOT, '.cache', 'stockfish');

interface PvInfo {
  depth: number;
  nodes: number;
  uci: string[];
  cp?: number;
  mate?: number;
}

function parseInfo(line: string): (PvInfo & { multipv: number }) | undefined {
  const t = line.split(' ');
  if (t[0] !== 'info') return undefined;
  const pvAt = t.indexOf('pv');
  const scoreAt = t.indexOf('score');
  // Bound scores come from aspiration-window fail highs/lows; wait for the exact one.
  if (pvAt < 0 || scoreAt < 0 || t.includes('lowerbound') || t.includes('upperbound')) return undefined;
  const num = (name: string) => Number(t[t.indexOf(name) + 1] ?? 0);
  const kind = t[scoreAt + 1];
  const value = Number(t[scoreAt + 2]);
  return {
    multipv: t.includes('multipv') ? num('multipv') : 1,
    depth: num('depth'),
    nodes: num('nodes'),
    uci: t.slice(pvAt + 1),
    ...(kind === 'mate' ? { mate: value } : { cp: value }),
  };
}

export class Stockfish {
  name = 'Stockfish';
  private readonly listeners = new Set<(line: string) => void>();
  private readonly proc: ChildProcessWithoutNullStreams;

  private constructor(proc: ChildProcessWithoutNullStreams) {
    this.proc = proc;
    createInterface({ input: proc.stdout }).on('line', (line) => {
      for (const listener of this.listeners) listener(line);
    });
  }

  /** Resolves to undefined if the binary can't be started. */
  static start(path = process.env.STOCKFISH_PATH ?? 'stockfish'): Promise<Stockfish | undefined> {
    return new Promise((resolve) => {
      const proc = spawn(path, []);
      proc.once('error', () => resolve(undefined));
      proc.stdin.on('error', () => {});
      const engine = new Stockfish(proc);
      void engine
        .until((line) => {
          if (line.startsWith('id name ')) engine.name = line.slice('id name '.length);
          return line === 'uciok';
        })
        .then(() => resolve(engine));
      engine.send('uci');
    });
  }

  /**
   * Fixed node budget on one thread (the default) so results are reproducible.
   * Scores are converted to White's point of view.
   */
  async analyse(fen: string, opts: { nodes: number; multiPv: number }): Promise<Evaluation> {
    this.send(`setoption name MultiPV value ${opts.multiPv}`);
    this.send('isready');
    await this.until((line) => line === 'readyok');

    const pvs = new Map<number, PvInfo>();
    const done = this.until((line) => {
      const info = parseInfo(line);
      if (info) pvs.set(info.multipv, info);
      return line.startsWith('bestmove');
    });
    this.send(`position fen ${fen}`);
    this.send(`go nodes ${opts.nodes}`);
    await done;

    const sign = sideToMove(fen) === 'white' ? 1 : -1;
    const ranked = [...pvs.entries()].sort(([a], [b]) => a - b).map(([, pv]) => pv);
    // Checkmate or stalemate: the engine reports no principal variation.
    if (ranked.length === 0) return { origin: 'local-stockfish', engine: this.name, depth: 0, knodes: 0, lines: [] };
    return {
      origin: 'local-stockfish',
      engine: this.name,
      depth: Math.min(...ranked.map((pv) => pv.depth)),
      knodes: Math.round(Math.max(...ranked.map((pv) => pv.nodes)) / 1000),
      lines: ranked.map((pv) =>
        engineLine(fen, pv.uci, pv.mate === undefined ? { cp: sign * pv.cp! } : { mate: sign * pv.mate }),
      ),
    };
  }

  /**
   * analyse() with an on-disk cache keyed by engine version, search settings,
   * and position, so rebuilding a tree doesn't repeat local analysis.
   */
  async analyseCached(fen: string, opts: { nodes: number; multiPv: number }): Promise<Evaluation> {
    const id = `${this.name}|nodes=${opts.nodes}|multipv=${opts.multiPv}|${positionKey(fen)}`;
    const file = join(CACHE_DIR, `${createHash('sha256').update(id).digest('hex')}.json`);
    try {
      return JSON.parse(await readFile(file, 'utf8')) as Evaluation;
    } catch {
      // Not analysed with these settings yet.
    }
    const evaluation = await this.analyse(fen, opts);
    await mkdir(CACHE_DIR, { recursive: true });
    await writeFile(file, JSON.stringify(evaluation));
    return evaluation;
  }

  quit(): void {
    this.send('quit');
  }

  private send(command: string): void {
    this.proc.stdin.write(`${command}\n`);
  }

  private until(done: (line: string) => boolean): Promise<void> {
    return new Promise((resolve) => {
      const listener = (line: string) => {
        if (!done(line)) return;
        this.listeners.delete(listener);
        resolve();
      };
      this.listeners.add(listener);
    });
  }
}
