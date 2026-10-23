# Scholia
## Project Proposal — Self-Hosted Chess Tutor

**Status:** Concept, revised after architecture review  
**Version:** 0.2 — October 23, 2026  
**Tagline:** *Beyond the Book*  
**Audience:** One developer / chess learner plus a few family members; private, not a public release

---

## Revision history

| Version | Changes |
|---|---|
| 0.1 | Initial concept: Angular + ASP.NET Core + SQLite + Stockfish; strict open-licensing posture. |
| 0.2 | **All-TypeScript stack** (Angular + Node + shared chessops-based `chess-core`). **Private-use sourcing posture:** official APIs first, scraping allowed as a last resort, content kept outside the code repo. Family profiles (no auth) added to the data model. `Line` added as the primary teaching object. Phase 0 reworked to start with a Lichess study and a TS spike. Lichess cloud evals added as an analysis source. **Published expert commentary is the primary source of explanations; AI may only summarize cited sources, never originate explanations.** |

---

## 1. Executive summary

**Scholia** is a local-first chess teaching application designed to connect *opening theory, explanatory chess literature, interactive practice, and a player's actual games*. Its primary purpose is to help players understand **why** moves work—not merely memorize engine-approved sequences.

A user should be able to choose a named idea (e.g., the **Traxler Counterattack**), explore its important variations, receive source-backed explanations of the threats and strategic ideas, play through coached lines, and practice against plausible responses. Scholia should also import games from Lichess and Chess.com, analyze them locally, identify recurring mistakes, and recommend lessons that address the user's weaknesses.

The key hypothesis is that openly available chess data, gathered explanatory material, personally authored notes, and local engine analysis can support an effective interactive tutor without a paid opening-course subscription. **Whether enough good explanatory content can be assembled is the primary unknown and should be tested first.**

Scholia should be useful without an AI subscription or hosted infrastructure. **Published expert commentary is the primary source of explanations.** Language models may help summarize, condense, and adapt that commentary for a lesson, but they do not originate chess explanations and must never become the authority for move legality, tactics, or evaluations.

## 2. Problem and opportunity

Existing chess tools often excel at one of several things: opening memorization, engine analysis, tactical puzzles, or game review. A learner who asks “Why does this gambit work, what are the critical alternatives, and how often do opponents at my level actually play them?” may need to switch between several tools and external articles.

Scholia aims to bridge those workflows:

1. **Learn:** Find an opening by name and grasp its plans, threats, tradeoffs, and critical branches.
2. **Explore:** Walk a branching, transposition-aware move graph rather than a rigid list.
3. **Practice:** Play guided variations and receive explanations for mistakes and reasonable alternatives.
4. **Apply:** Play normal games on an existing platform.
5. **Reflect:** Import those games, find recurring weaknesses, and choose the next lesson on evidence rather than guesswork.

The competitive differentiation is **instruction tied to verifiable board positions and to the user's actual play**, not just recall drills or a prettier evaluation bar. Note that Lichess studies already cover much of guided-line playback; Scholia's distinctive value is most likely in connecting lessons to each user's own games (Phases 2–3).

## 3. Product principles

- **Understanding before memorization:** Explain the intent behind a move; give users opportunities to predict threats and plans.
- **Experts explain, tools assist:** Explanations come from published chess expert commentary. Engines verify claims; language models only summarize existing sources.
- **Evidence with provenance:** Separate established game facts, engine evaluations, authored interpretations, and generated prose. Record where every explanation came from, because provenance determines how much to trust it.
- **Local-first and self-hostable:** Core features work with a locally controlled database and engine. External API access is optional for imports and statistics.
- **Private first, open-source possible:** Scholia is for personal and family use. Keep the code repository free of gathered third-party content so the code could be published later without a content audit.
- **User-controlled:** Import/export PGN and structured training data; no dependency on one playing platform.
- **Small, testable increments:** Validate that a lesson teaches effectively before adding large-scale ingestion or sophisticated AI.
- **Fair play:** Scholia is a study and *post-game* analysis tool, not a live-game assistance overlay.

## 4. Target user experience

### 4.1 Named-idea discovery

Search `Traxler Counterattack`. Scholia shows a concise overview, the position where the idea starts, its tactical and strategic themes, prerequisite concepts, representative master games if available, and a short set of ranked variations. Ranking should distinguish **theoretical importance**, **engine soundness**, **master frequency**, and **frequency in games near the user's rating**. These are not interchangeable.

### 4.2 Guided lesson

The board opens at a valid position. A prompt asks, for example: “White has attacked f7. What is Black hoping to obtain by playing 4...Bc5?” The lesson demonstrates a candidate line, pauses at decision points, lets the user move a piece, and explains both correct moves and instructive alternatives. All displayed SAN, FEN, variations, and legality must be derived from the same validated move state.

Each instructional node may include:
- The side to move and an explanation of immediate threats.
- The recommended move(s), with tactical or strategic rationale.
- A short “what changes if…” comparison.
- Linked source excerpts or paraphrases, explicitly attributed.
- Engine evaluation with depth/settings, and a visible distinction between engine fact and human interpretation.
- A question or practice task, potentially revisited later.

### 4.3 Practice

A **repertoire opponent** draws from a weighted tree of known responses. A **training opponent** may use Stockfish constrained to an appropriate level after leaving known lines. Off-line deviations do **not** automatically count as mistakes: the software assesses whether a move is legal, playable, or substantively inferior before giving feedback. Errors should generate follow-up practice positions.

### 4.4 Personalized improvement

Import games from both chess services (and PGN files) for each family member. Report recurring opening deviations, mistakes in familiar positions, common tactical motifs, color/time-control splits, and changes over time. Lessons can be recommended from actual weaknesses. Clearly distinguish observed correlations from claims that a lesson caused improvement.

## 5. MVP scope and explicit exclusions

### MVP: content-first vertical slice

**One opening:** Traxler Counterattack, beginning after `1.e4 e5 2.Nf3 Nc6 3.Bc4 Nf6 4.Ng5 Bc5!?`.

Deliver:
1. A legal, branching opening tree containing approximately **10–20 defensible, important lines**, including key White fifth-move alternatives; this count is a *curation target*, not a requirement to fabricate lines.
2. Source-backed explanations at the main decision points, with provenance and editorial status.
3. Interactive board and move navigation: next, back, restart, variations, legal move entry, and deviation handling.
4. Guided drills with feedback and a simple per-profile record of completion / mistakes.
5. A repeatable import pipeline from at least one open opening dataset plus at least one explanatory source.
6. A reproducible local development environment, automated chess-state tests, and a documented content audit.

**Stretch MVP:** import a sample of the developer's Lichess and Chess.com PGNs and classify opening deviations. Keep full-game Stockfish review in the next milestone if it threatens the teaching spike.

**Not MVP:** authentication, public/internet hosting, paid services, social features, chess matchmaking, live-game overlays, voice chat, mobile-native clients, a giant master-game corpus, and unconstrained conversational AI.

## 6. Source strategy

Scholia is private: used by the developer and a few family members, not distributed or sold. That changes the sourcing posture from “only redistributable content” to “prefer clean, structured access; scrape only when nothing better exists.”

### Access preference order

1. **Official APIs and structured exports** (Lichess API, Lichess database dumps, MediaWiki API, Chess.com PubAPI).
2. **Material the users own or write:** personal notes, annotations transcribed or paraphrased from owned books, user PGNs.
3. **Polite scraping of public pages** as a last resort: rate-limited, cached, identifying user agent, respecting `robots.txt`.

**Never scrape** sites where the users hold accounts they care about and whose terms prohibit it (notably **Chess.com**); their PubAPI covers game archives.

| Source | Intended use | Access |
|---|---|---|
| Lichess `chess-openings` dataset (CC0) | Names, ECO codes, canonical opening positions and move sequences | GitHub TSV files |
| Lichess Opening Explorer | Position-level master/online move frequencies | Official API; cache. Frequency is descriptive, not an evaluation. |
| Lichess cloud evaluation | Deep evaluations for common opening positions without local compute | Official API (`/api/cloud-eval`); fall back to local Stockfish on miss |
| Lichess studies | Annotated lines from study authors | PGN export via API |
| Lichess open database (CC0) | Optional game samples, puzzles, evaluations | Download narrow subsets |
| Wikibooks *Chess Opening Theory* | Human explanations | MediaWiki API (not scraping) |
| Owned books / personal notes | Highest-quality explanations | Manual authoring / paraphrase |
| Chess.com PubAPI | Read-only imports of public game archives and stats | Official endpoints only |
| Other public chess sites | Gap-filling commentary | Last-resort polite scraping |

### Storage rule

Gathered third-party content lives in a **content directory outside the code repository** (e.g., a separate private repo or a mounted volume). The code repo contains only code, schema, tests, and CC0 data. Every annotation records its source (URL, title, retrieval time, kind) for trust and traceability.

## 7. Architecture

**Stack:** all TypeScript. Angular frontend, Node backend, SQLite, Stockfish as a local UCI child process, and a shared `chess-core` package that is the single authority for chess rules. Packaged with Docker Compose for the homelab; developed with dev servers on the workstation.

**Why all-TS:** the strongest maintained chess libraries are in TypeScript (chessops for rules/PGN/FEN, chessground for the board, both from Lichess). Most interesting backend logic (ingestion, position keys, transpositions, engine-line rendering, repertoire-deviation detection) needs the rules library, so a separate-language backend would mostly be plumbing behind a cross-language boundary. One language also means shared types from the board to the database.

```text
                    ┌─────────────────────┐
  Lichess API   ───►│ Source adapters     │
  Chess.com API ───►│ API / PGN importers │
  Wikibooks API ───►│ (scrapers: last     │
  Local PGNs    ───►│  resort)            │
                    └──────────┬──────────┘
                               │ raw snapshots + source metadata
                               ▼
                    ┌──────────────────────┐
                    │ chess-core (chessops)│
                    │ validate SAN/UCI/FEN │
                    │ position keys, trees │
                    └──────────┬───────────┘
                               ▼
                    ┌──────────────────────┐
                    │ SQLite (Drizzle)     │
                    │ Positions + edges    │
                    │ Lines + annotations  │
                    │ Profiles, games,     │
                    │ attempts             │
                    └──────────┬───────────┘
                               │
                   ┌───────────┴───────────┐
                   ▼                       ▼
           ┌──────────────┐        ┌────────────────┐
           │ Stockfish    │        │ Lesson service │
           │ UCI process  │        │ + practice     │
           │ + cloud eval │        └───────┬────────┘
           └──────┬───────┘                │
                  └───────────┬────────────┘
                              ▼
                       Node API (Fastify or NestJS)
                              ▼
                 Angular UI (chessground + chess-core)
```

### Repository layout (monorepo, pnpm workspaces)

```text
packages/chess-core   rules wrapper over chessops; shared by web and api
apps/api              Node backend: HTTP API, Drizzle/SQLite, jobs, adapters, Stockfish
apps/web              Angular frontend
tools/                spikes and one-off ingestion scripts
```

### Responsibilities

- **Chess domain (`chess-core`):** move legality, PGN parsing including variations, board state, castling, en passant, promotion, SAN/UCI conversion, position-key normalization, and repetition. No other module interprets moves itself.
- **Ingestion:** adapters per source, raw source archive, versioned parsing, validation, deduplication, source references, and failure logging.
- **Knowledge:** transposition-aware graph of positions and legal move edges, teaching lines over that graph, annotations, opening classifications, and lesson mappings.
- **Analysis:** Lichess cloud eval first, then asynchronous, cancellable local Stockfish jobs with bounded CPU/time, cached evaluations, and engine-version/settings metadata.
- **Training:** deterministic lesson progression, alternate acceptable moves, mistake explanations, spaced repetition (after basic drills work), and per-profile progress history.
- **Integrations:** independent Lichess and Chess.com connectors; idempotent imports and preserved platform-specific ratings/time controls.
- **Presentation:** Angular + chessground board, analysis/lesson side panel, source citations, progress and branch navigator, profile picker.

Start as a **modular monolith**, not microservices. Only the API process opens the SQLite file; if multiple writers are ever needed, move to Postgres (Drizzle makes this a contained change). Background jobs start as an in-process queue; split a `worker` container only if engine analysis starts degrading API responsiveness.

## 8. Preliminary data model

The core is a **directed graph of positions and moves**, plus **lines** (ordered paths through that graph) as the primary teaching object. Transpositions converge on identical positions, but move order matters pedagogically: the same position reached two ways may warrant different explanations.

| Entity | Core fields / concerns |
|---|---|
| `Profile` | ID, display name, Lichess/Chess.com usernames. No authentication. |
| `Position` | ID, normalized position key, representative FEN, side to move; correct castling/en-passant state |
| `MoveEdge` | FromPositionId, ToPositionId, UCI, derived SAN, optional frequency data |
| `Line` / `LineMove` | Ordered sequence of MoveEdges from a root position; name, purpose, source |
| `Opening` | Name, ECO, root position, aliases, descriptive summary |
| `Source` | URL, title, author, retrieved timestamp, kind (API, wiki, book, scrape, personal) |
| `Annotation` | Anchored to a Position, a MoveEdge, or a LineMove; prose, concepts, source(s), status (quote / paraphrase / model summary of cited sources / personal note), review status |
| `EngineEvaluation` | PositionId, origin (local / Lichess cloud), engine/version/config, depth/nodes, multipv principal variations, timestamp |
| `Game` / `GameMove` | ProfileId, platform + external ID, PGN headers, UCI/SAN, clock, per-move position references, result |
| `Lesson` / `LessonStep` | Curated objective, LineMove reference, allowed response(s), expected idea, explanation, linked annotation |
| `TrainingAttempt` | ProfileId, LessonStepId, time, move selected, correctness/category, explanation shown |

**Position identity:** a full FEN includes halfmove/fullmove counters, which should not split otherwise equivalent opening positions. The position key preserves all rule-relevant state (pieces, side to move, castling rights, en passant only when a capture is actually legal) as normalized by `chess-core`. Use UCI internally and derive SAN from board state. Use stable IDs rather than raw FEN as the only database key.

**Data separation:** store factual move data, human-authored commentary, engine outputs, and model-generated summaries as separate records or clearly marked origins. A model summary always links to the source passages it summarizes. Never present a model summary as an attributed human quote.

## 9. Teaching design and quality bar

### Lesson structure

1. Context: why the position matters; what each player threatens.
2. Ask the learner to predict the plan or select a move.
3. Let the learner play it on the board.
4. Validate the move legally and evaluate alternatives without assuming deviations are wrong.
5. Show a short, plain-language explanation of the tradeoff and relevant tactics.
6. Demonstrate one or two instructive continuations.
7. Quiz the concept in a related position; add missed concepts to future practice.

### Evaluation of a successful lesson

A Traxler lesson is acceptable only if:
- All sample lines are legal and reconstructible from a known FEN.
- Key explanations make chess sense and are supported by cited material or editorial review; tactical claims are checked with analysis.
- A learner can distinguish sound play, risky practical complications, and unsound traps.
- It handles at least one reasonable off-script move without an incorrect “wrong move” message.
- It teaches a recognizable motif that can be restated without reciting the move order.
- A reviewer can follow sources and trace why a line was included.

### Role of language models

Explanations come from **published chess expert commentary**: books, annotated master games, established opening references, and expert-authored studies and articles. Stockfish identifies candidate continuations and evaluations to check those explanations; it does not produce pedagogical explanations.

A language model may **summarize** published commentary: condense a long passage, merge several sources' points about the same position, or adapt wording for the lesson's level. It may not originate chess ideas. Concretely:
- Input is the cited source passages plus the position; output is a summary linked to those passages.
- The summary must not add plans, tactics, or evaluations absent from the sources.
- Tactical claims are checked against engine lines; a disagreement between a source and the engine is shown, not silently resolved.
- Summaries are labeled as model summaries and human-reviewed before entering a canonical lesson.

Where no published commentary exists for a position, the lesson shows the line and engine evaluation without invented prose, and the gap is recorded for future sourcing.

## 10. Game analysis and progress

### Inputs

- **Lichess:** official user-game export endpoint; optional rating history and player opening statistics.
- **Chess.com:** official published-data API for monthly public game archives and player statistics.
- **Manual:** local PGN import, including historical or over-the-board games.

All games belong to a profile.

### Derived metrics (after MVP)

Start with the two simplest, most verifiable reports:
- **Where each profile leaves its repertoire**, and what happened next.
- **Positions in studied openings where the evaluation dropped sharply.**

Then, as data allows:
- Performance by opening family, side, time control, and rating band (with sample sizes).
- Centipawn-loss-like metrics and major evaluation swings, **only when independently analyzed**.
- Recurrent tactical motifs and positions with repeated mistakes.
- Time pressure patterns where usable clock annotations exist.
- Pre-/post-lesson mistakes in comparable positions; describe as observational, not automatically causal.

Never pool Lichess and Chess.com ratings into a single uninterpreted series. Keep sources and time controls separate. Cache game imports by external game ID and analysis by position key + engine settings.

## 11. API shape (illustrative, subject to change)

```http
GET  /api/profiles
GET  /api/openings?query=traxler
GET  /api/openings/{openingId}/tree
GET  /api/lines/{lineId}
GET  /api/positions/{positionId}/annotations
GET  /api/positions/{positionId}/analysis
GET  /api/lessons/{lessonId}
POST /api/profiles/{profileId}/lessons/{lessonId}/attempts
POST /api/profiles/{profileId}/imports/pgn
POST /api/profiles/{profileId}/imports/lichess
POST /api/profiles/{profileId}/imports/chesscom
GET  /api/profiles/{profileId}/games?source=lichess
POST /api/analysis/jobs
GET  /api/analysis/jobs/{jobId}
GET  /api/profiles/{profileId}/insights/openings
```

No authentication: profiles are a picker, not accounts. Expose the app only on localhost or a trusted network (e.g., the homelab LAN or a Tailscale tailnet). If it ever becomes internet-accessible, authentication and abuse controls become required. External platform tokens, if any, stay server-side.

## 12. Milestones and acceptance gates

### Phase 0 — Content feasibility spike (highest priority)

**Objective:** Demonstrate that a meaningful opening lesson can be constructed from available material.

**0a. Lichess study prototype (no code).** Build the Traxler lesson as a private Lichess study with interactive chapters and comments. This tests whether the content teaches well, and its PGN export becomes the first content pack. If the study alone feels sufficient, that is evidence that Scholia's value lies mainly in Phases 2–3.

**0b. TypeScript spike.**
- Set up the monorepo and `packages/chess-core` over chessops, with tests for castling, en passant, and transpositions.
- Load the Lichess CC0 opening dataset and extract the Traxler subtree.
- Fetch explorer frequencies and cloud evals; run local Stockfish (MultiPV 3–5, fixed node budget) where cloud evals are missing.
- Emit a validated tree (JSON) with explanation slots; fill ~10–20 from published expert commentary (owned books, expert studies, Wikibooks, articles).
- Score each explanation for accuracy, clarity, provenance, and pedagogical value.

**Gate:** At least ~10 useful explanation nodes that are meaningfully more instructive than “engine says +0.3,” and an identified plan for filling major gaps. If not achieved, narrow scope or commit to a curated-authoring model.

### Phase 1 — Functional guided lesson

- Angular + Node skeleton; Drizzle schema and SQLite migrations; profile picker.
- chessground board, variation navigator, move history, guided prompts, back/restart.
- Course format with curated Traxler lines and citations.
- Legal deviations and a bounded practice loop.
- Automated tests for every instructional line and branching point.

**Gate:** Complete one coherent Traxler lesson end-to-end, including meaningful feedback on an off-book move.

### Phase 2 — Personal game pipeline

- Lichess and Chess.com import adapters plus manual PGN, per profile.
- Deduplication and normalization; local Stockfish job queue.
- Opening classification and first personalized diagnostic report.

**Gate:** Import a sample from each platform reproducibly, identify at least three actionable recurring patterns, and link one to an existing lesson.

### Phase 3 — Adaptive coaching

- Lesson recommendations from game history.
- Spaced repetition of missed concepts/positions.
- More opening packs; quality-ranked source ingestion.
- LLM-assisted summarization of published commentary, with source links and engine checks.

**Gate:** A user receives a coherent recommendation based on analyzed games, practices it, and can revisit performance in that concept over time.

### Phase 4 — Family deployment and optional open-sourcing

- Docker Compose deployment on the homelab (Proxmox VM/container); backups/exports.
- Onboarding for family members.
- If publishing the code: confirm the content directory is excluded, and resolve licensing for GPL dependencies (see risks).

## 13. Technical risks and mitigations

| Risk | Why it matters | Mitigation |
|---|---|---|
| Sparse good commentary | Moves are plentiful; *good explanations* are scarce/uneven | Phase 0 audit first; owned books, expert studies; leave gaps visible rather than fill them with generated prose |
| Incorrect chess commentary | Confident but wrong teaching is worse than no teaching | Legal validation, engine checks, citations, review statuses |
| Scraping brittleness and site terms | Scrapers break; some sites prohibit them and may ban accounts | API-first order; scrape only as last resort; never scrape Chess.com; cache aggressively |
| Content leaking into a published repo | Gathered content is fine privately but not to redistribute | Content directory outside the code repo |
| GPL dependencies | chessops and chessground are GPL-3.0; the repo is currently MIT | Irrelevant for private use; if the code is ever published, relicense as GPL-3.0 (or swap libraries) — verify licenses before release |
| Position normalization / transpositions | Duplicate branches and wrong opening classification | Position graph, `chess-core` as single authority, transposition tests |
| Engine performance | Full analysis of many games can saturate a homelab | Cloud eval first, job budgets, priority queue, caching, Compose CPU limits |
| False claims about improvement | Ratings and win rates are noisy | Cohorts, time-control segregation, sample sizes, cautious wording |
| API changes, rate limits | Imports might break or overload services | Adapters, caching, retries/backoff, manual PGN fallback |
| AI hallucinations | Summaries may add or distort ideas | Summarize-only role, source links, engine checks, human review |
| Scope expansion | Chess analysis offers endless feature ideas | Content-first vertical slice, acceptance gates, explicit exclusions |
| Learning curve on Node/TS backend | Developer's background is .NET | Mature tooling (NestJS mirrors ASP.NET concepts); small increments |

## 14. Operational posture

Default deployment targets an ordinary Linux desktop or a small Proxmox-hosted VM/container via Docker Compose:

- `web`: built Angular app served by nginx (or by the API).
- `api`: Node backend with the Stockfish binary installed, run as an isolated child process with CPU limits.
- Optional later `worker`: same backend code in queue-processing mode for heavy analysis.
- SQLite file on a persisted volume, opened only by the API/worker host process; documented backup/restore.
- Content directory mounted as a separate volume.
- Access via LAN or a private tailnet only.
- Optional scheduled sync for new games, not a dependency of interactive study.
- Structured logs for imports and engine jobs; no telemetry.

During development, run Angular and Node dev servers on the workstation with Stockfish installed locally; containerize for deployment.

## 15. Open questions

Resolved in v0.2: chess libraries (chessops/chessground in a shared TS package), licensing posture (private use; API-first; scraping as last resort), and multiuser scope (profiles without auth).

Still open:
1. **Feasibility:** Can gathered and authored material support an engaging 10–20-variation Traxler lesson? Phase 0 answers this.
2. **Data model:** How should PGN variation trees from sources map onto Lines, and how should annotations migrate when a line is re-curated?
3. **Backend framework:** Fastify (minimal) or NestJS (structured, closer to ASP.NET conventions)?
4. **Pedagogy:** What are defensible ways to measure whether a player understands an opening rather than recites moves?
5. **Engine use:** What node budget and MultiPV settings suit beginner-to-intermediate training on homelab hardware?
6. **LLM summarization:** How do we verify a summary adds nothing beyond its sources? Local or hosted model?
7. **Personalization:** How can recurring-weakness detection avoid overfitting small, noisy game samples?

## 16. Decision record

| Decision | Choice | Revisit when |
|---|---|---|
| Working name | Scholia | If ever published |
| Core differentiation | Explanatory instruction linked to actual games | After user testing |
| Primary proof of concept | Traxler Counterattack | If the content audit shows insufficient material |
| Technical stack | All TypeScript: Angular, Node, SQLite/Drizzle, chessops/chessground, local Stockfish | Only if a concrete bottleneck appears |
| Chess rules authority | Shared `chess-core` package over chessops | — |
| Knowledge representation | Position graph + Lines + annotations | During schema spike and transposition testing |
| Users | Family profiles, no authentication | If exposed beyond a trusted network |
| Sourcing | APIs → owned/authored → polite scraping as last resort | If publishing content |
| Explanations | Published expert commentary is primary; AI only summarizes cited sources, never originates | — |
| Game sources | Lichess and Chess.com via official APIs | After real import testing |
| Deployment | Docker Compose on homelab | — |
| Publishing model | Private; code possibly open-sourced later, content never | Before any release |

## 17. Definition of success

**Near-term:** Scholia delivers a genuinely helpful, source-backed Traxler lesson that allows the learner to predict moves, understand the attacking ideas, explore alternatives, and recover from off-book play.

**Medium-term:** Scholia imports each family member's games from both platforms and tells them *which concepts to study next*, backed by actual positions and understandable evidence.

**Long-term:** Scholia is a self-hosted teaching platform where chess theory, gathered annotations, engine evidence, and each player's game history reinforce one another—without buying a separate opening course for every idea worth learning.

---

## Appendix A — Primary technical references

- Lichess API reference: https://lichess-org.github.io/api/
- Lichess chess-openings dataset (CC0): https://github.com/lichess-org/chess-openings
- Lichess open datasets: https://database.lichess.org/
- chessops: https://github.com/niklasf/chessops
- chessground: https://github.com/lichess-org/chessground
- Chess.com Published Data API: https://support.chess.com/en/articles/9650547-what-is-the-pubapi-and-how-do-i-use-it
- Wikibooks Chess Opening Theory: https://en.wikibooks.org/wiki/Chess_Opening_Theory
- Stockfish: https://github.com/official-stockfish/Stockfish

**Caveat:** APIs, site policies, and license terms should be rechecked before implementing integrations or publishing anything.
