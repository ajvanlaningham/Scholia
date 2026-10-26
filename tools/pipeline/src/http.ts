import { createHash } from 'node:crypto';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import { setTimeout as sleep } from 'node:timers/promises';

export const REPO_ROOT = resolve(import.meta.dirname, '../../..');
export const CONTENT_DIR = process.env.SCHOLIA_CONTENT_DIR ?? join(REPO_ROOT, 'content');

const CACHE_DIR = join(REPO_ROOT, '.cache', 'http');
// Wikimedia's User-Agent policy asks for contact details (an email or URL);
// clients without them get rate-limited much sooner.
const CONTACT = process.env.SCHOLIA_CONTACT;
const USER_AGENT = `Scholia/0.1 (private chess study tool${CONTACT ? `; ${CONTACT}` : ''})`;
// Lichess asks API clients to make one request at a time; stay well under that.
const MIN_INTERVAL_MS = 1000;
const HOST_INTERVAL_MS: Record<string, number> = { 'en.wikibooks.org': 2000 };
const RATE_LIMIT_BACKOFF_MS = 60_000;

let lastRequestAt = 0;
/** Cached responses older than this are refetched; undefined keeps them forever. */
let maxAgeMs: number | undefined;

export interface CachedResponse {
  status: number;
  body: string;
  /** When the response was fetched (epoch ms); missing on entries from before it was recorded. */
  fetchedAt?: number;
}

/** Makes cachedGet refetch entries older than `ms` (scheduled refreshes). */
export function setMaxCacheAge(ms: number | undefined): void {
  maxAgeMs = ms;
}

export class RateLimited extends Error {
  constructor(host: string) {
    super(`${host} keeps rate-limiting requests`);
  }
}

const cacheFile = (url: string) => join(CACHE_DIR, `${createHash('sha256').update(url).digest('hex')}.json`);

async function readCached(file: string): Promise<CachedResponse | undefined> {
  try {
    const cached = JSON.parse(await readFile(file, 'utf8')) as CachedResponse;
    const fresh = maxAgeMs === undefined || (cached.fetchedAt !== undefined && Date.now() - cached.fetchedAt < maxAgeMs);
    return fresh ? cached : undefined;
  } catch {
    return undefined; // Not cached yet.
  }
}

/** A cached response, without touching the network. */
export const cachedOnly = (url: string): Promise<CachedResponse | undefined> => readCached(cacheFile(url));

/**
 * GET with an on-disk cache and sequential pacing. 404s are cached as well, so
 * delete .cache/http (or use setMaxCacheAge) to re-query positions that had no data.
 */
export async function cachedGet(
  url: string,
  headers: Record<string, string> = {},
  /** Throw RateLimited after this many 429s in a row, instead of waiting indefinitely. */
  maxRateLimits = Infinity,
): Promise<CachedResponse> {
  const file = cacheFile(url);
  const cached = await readCached(file);
  if (cached) return cached;

  for (let limited = 0; ; ) {
    const host = new URL(url).host;
    const wait = lastRequestAt + (HOST_INTERVAL_MS[host] ?? MIN_INTERVAL_MS) - Date.now();
    if (wait > 0) await sleep(wait);
    lastRequestAt = Date.now();

    const res = await fetch(url, { headers: { 'User-Agent': USER_AGENT, ...headers } });
    if (res.status === 429) {
      if (++limited > maxRateLimits) throw new RateLimited(host);
      const retryAfter = Number(res.headers.get('retry-after')) * 1000 || RATE_LIMIT_BACKOFF_MS;
      console.warn(`Rate limited by ${host}; waiting ${retryAfter / 1000}s`);
      await sleep(retryAfter);
      continue;
    }
    if (res.status !== 200 && res.status !== 404) {
      throw new Error(`GET ${url} failed with ${res.status}: ${await res.text()}`);
    }

    const response: CachedResponse = { status: res.status, body: await res.text(), fetchedAt: Date.now() };
    await mkdir(CACHE_DIR, { recursive: true });
    await writeFile(file, JSON.stringify(response));
    return response;
  }
}
