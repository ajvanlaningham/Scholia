// Traces brand/scholia-logo-source.png (a two-colour raster logo) into SVG.
//
//   pnpm --filter @scholia/brand trace
//
// The source has two inks on paper: rubric red and near-black ink. Each is
// separated into its own soft mask (keeping anti-aliased edges, so curves stay
// smooth), traced with potrace, and recoloured with the app's palette. The S
// that doubles as a knight ("the mark") is found as the connected shapes left
// of the wordmark and above the tagline.
//
// Writes to brand/:
//   scholia-lockup.svg, scholia-lockup-dark.svg   mark + "cholia" + tagline
//   scholia-mark.svg, scholia-mark-dark.svg       the S-knight alone
//   favicon.svg                                   the mark in red, light/dark aware
// and apps/web/src/app/brand/logo-paths.ts (path data for the header).
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { PNG } from 'pngjs';
import potrace from 'potrace';

const ROOT = resolve(import.meta.dirname, '../..');
const SOURCE = join(ROOT, 'brand/scholia-logo-source.png');
const OUT = join(ROOT, 'brand');
const PATHS_TS = join(ROOT, 'apps/web/src/app/brand/logo-paths.ts');

// The app's palette (apps/web/src/styles.scss), light and dark.
const COLORS = {
  light: { red: '#9A3B26', ink: '#2A2520' },
  dark: { red: '#D9876F', ink: '#ECE4D6' },
};

// Sampled from the source: paper, and the median of each ink.
const PAPER = [245, 240, 230];
const RED = [162, 61, 35];
const INK = [45, 39, 33];

const png = PNG.sync.read(readFileSync(SOURCE));
const { width, height } = png;
const n = width * height;
const clamp = (x) => Math.max(0, Math.min(1, x));
const lum = ([r, g, b]) => 0.299 * r + 0.587 * g + 0.114 * b;

// Soft membership of each pixel in each ink, 0..1.
const red = new Float32Array(n);
const ink = new Float32Array(n);
for (let i = 0; i < n; i++) {
  const r = png.data[i * 4], g = png.data[i * 4 + 1], b = png.data[i * 4 + 2];
  // Redness: how far red pulls ahead of green, relative to the red ink.
  red[i] = clamp((r - g - (PAPER[0] - PAPER[1])) / (RED[0] - RED[1] - (PAPER[0] - PAPER[1])));
  // Darkness not explained by redness is ink.
  const dark = clamp((lum(PAPER) - lum([r, g, b])) / (lum(PAPER) - lum(INK)));
  ink[i] = clamp(dark - red[i] * (lum(PAPER) - lum(RED)) / (lum(PAPER) - lum(INK)));
}

// Connected shapes (either ink above half), to find the mark.
const label = new Int32Array(n).fill(-1);
const boxes = [];
for (let start = 0; start < n; start++) {
  if (label[start] !== -1 || Math.max(red[start], ink[start]) < 0.5) continue;
  const id = boxes.length;
  const box = { minX: width, minY: height, maxX: 0, maxY: 0 };
  const stack = [start];
  label[start] = id;
  while (stack.length) {
    const p = stack.pop();
    const x = p % width, y = (p - x) / width;
    box.minX = Math.min(box.minX, x); box.maxX = Math.max(box.maxX, x);
    box.minY = Math.min(box.minY, y); box.maxY = Math.max(box.maxY, y);
    for (const q of [p - 1, p + 1, p - width, p + width]) {
      if (q < 0 || q >= n || label[q] !== -1) continue;
      if (Math.abs((q % width) - x) > 1) continue;
      if (Math.max(red[q], ink[q]) < 0.5) continue;
      label[q] = id;
      stack.push(q);
    }
  }
  boxes.push(box);
}

// The wordmark's first letter starts right of the mark; the tagline sits below.
const significant = boxes.map((b, id) => ({ ...b, id })).filter((b) => (b.maxX - b.minX) * (b.maxY - b.minY) > 40);
const taglineTop = Math.min(...significant.filter((b) => b.minY > height * 0.62).map((b) => b.minY));
const wordStart = Math.min(...significant.filter((b) => b.maxY < taglineTop && b.minX > width * 0.3).map((b) => b.minX));
const markIds = new Set(significant.filter((b) => b.maxY < taglineTop && b.maxX < wordStart + 40 && b.minX < wordStart).map((b) => b.id));
const union = (bs) => bs.reduce(
  (u, b) => ({ minX: Math.min(u.minX, b.minX), minY: Math.min(u.minY, b.minY), maxX: Math.max(u.maxX, b.maxX), maxY: Math.max(u.maxY, b.maxY) }),
  { minX: width, minY: height, maxX: 0, maxY: 0 },
);
const markBox = union(significant.filter((b) => markIds.has(b.id)));
const allBox = union(significant);
console.log(`${significant.length} shapes; mark = ${markIds.size} shapes at x ${markBox.minX}–${markBox.maxX}`);

/** A mask PNG (black = shape) from memberships, optionally restricted to the mark's shapes. */
function maskPng(membership, onlyMark) {
  const out = new PNG({ width, height });
  for (let i = 0; i < n; i++) {
    const x = i % width, y = (i - x) / width;
    let m = membership[i];
    if (onlyMark) {
      const inBox = x >= markBox.minX - 3 && x <= markBox.maxX + 3 && y >= markBox.minY - 3 && y <= markBox.maxY + 3;
      if (!inBox || (label[i] !== -1 && !markIds.has(label[i]))) m = 0;
    }
    const v = Math.round(255 * (1 - m));
    out.data[i * 4] = out.data[i * 4 + 1] = out.data[i * 4 + 2] = v;
    out.data[i * 4 + 3] = 255;
  }
  return PNG.sync.write(out);
}

const trace = (buffer) =>
  new Promise((ok, fail) =>
    potrace.trace(buffer, { threshold: 128, turdSize: 4, optTolerance: 0.3 }, (err, svg) => (err ? fail(err) : ok(svg))),
  );
const pathData = (svg) => [...svg.matchAll(/ d="([^"]+)"/g)].map((m) => m[1]).join(' ');

const layers = {
  lockup: { red: pathData(await trace(maskPng(red, false))), ink: pathData(await trace(maskPng(ink, false))) },
  mark: { red: pathData(await trace(maskPng(red, true))), ink: pathData(await trace(maskPng(ink, true))) },
};

const PAD = 8;
const viewBox = (b) => `${b.minX - PAD} ${b.minY - PAD} ${b.maxX - b.minX + 2 * PAD} ${b.maxY - b.minY + 2 * PAD}`;
const svg = (box, paths, colors, title) => `<svg xmlns="http://www.w3.org/2000/svg" viewBox="${viewBox(box)}" role="img" aria-label="${title}">
  <title>${title}</title>
  <path fill="${colors.red}" fill-rule="evenodd" d="${paths.red}"/>
  <path fill="${colors.ink}" fill-rule="evenodd" d="${paths.ink}"/>
</svg>
`;

mkdirSync(OUT, { recursive: true });
writeFileSync(join(OUT, 'scholia-lockup.svg'), svg(allBox, layers.lockup, COLORS.light, 'Scholia: Beyond the Book'));
writeFileSync(join(OUT, 'scholia-lockup-dark.svg'), svg(allBox, layers.lockup, COLORS.dark, 'Scholia: Beyond the Book'));
writeFileSync(join(OUT, 'scholia-mark.svg'), svg(markBox, layers.mark, COLORS.light, 'Scholia'));
writeFileSync(join(OUT, 'scholia-mark-dark.svg'), svg(markBox, layers.mark, COLORS.dark, 'Scholia'));

// Favicons are tiny: the red silhouette alone reads best, and follows the theme.
writeFileSync(
  join(OUT, 'favicon.svg'),
  `<svg xmlns="http://www.w3.org/2000/svg" viewBox="${viewBox(markBox)}">
  <style>path { fill: ${COLORS.light.red}; } @media (prefers-color-scheme: dark) { path { fill: ${COLORS.dark.red}; } }</style>
  <path fill-rule="evenodd" d="${layers.mark.red}"/>
</svg>
`,
);

mkdirSync(dirname(PATHS_TS), { recursive: true });
writeFileSync(
  PATHS_TS,
  `// Generated by tools/brand/trace-logo.mjs from brand/scholia-logo-source.png. Don't edit.
export const MARK_VIEWBOX = '${viewBox(markBox)}';
export const MARK_RED = '${layers.mark.red}';
export const MARK_INK = '${layers.mark.ink}';
`,
);

for (const [name, paths] of Object.entries(layers)) {
  console.log(`${name}: red ${paths.red.length} chars, ink ${paths.ink.length} chars`);
}
console.log(`Wrote SVGs to ${OUT} and ${PATHS_TS}`);
