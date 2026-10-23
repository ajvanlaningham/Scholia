# Scholia brand

- `scholia-logo-source.png`: the original raster logo (generated with ChatGPT). The S doubles as a chess knight.
- `scholia-lockup.svg` / `scholia-lockup-dark.svg`: the full logo (mark, "cholia", tagline), traced to vectors.
- `scholia-mark.svg` / `scholia-mark-dark.svg`: the S-knight alone.
- `favicon.svg`: the mark's red silhouette. It switches colour with the system theme. A copy lives in `apps/web/public/`.

Regenerate the SVGs (and `apps/web/src/app/brand/logo-paths.ts`) with `pnpm --filter @scholia/brand trace`. The script separates the red and ink layers by colour, traces each with potrace, and recolours them with the app palette.

The PNG favicons in `apps/web/public/` (`favicon-32.png`, `apple-touch-icon.png`) were rendered from `favicon.svg` in Chromium. Re-render them if the mark changes.

## Typeface and colours

The typeface is **Libre Caslon Text** (OFL), bundled in the app from `@fontsource/libre-caslon-text`. The wordmark is the traced mark followed by "cholia" in Libre Caslon Bold. The tagline "Beyond the Book" is in Libre Caslon Italic, in rubric red.

| Role | Light | Dark |
|---|---|---|
| Paper | `#F5F0E6` | `#191612` |
| Ink | `#2A2520` | `#ECE4D6` |
| Rubric red | `#9A3B26` | `#D9876F` |
| Teal (actions) | `#1F6B70` | `#5FB3B3` |
