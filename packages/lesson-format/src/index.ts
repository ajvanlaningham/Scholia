// The compiled lesson format: what the lesson checker emits and the web app
// plays. Everything is resolved ahead of time (positions, citations with full
// text, engine verdicts), so the player needs no chess-data logic beyond
// legality, and an API can later serve the same shape.

/** All courses, for the home page: content/index.json. */
export interface CourseIndex {
  courses: CourseSummary[];
}

export type CourseStatus = 'backlog' | 'researching' | 'ready' | 'drafting' | 'review' | 'published';

/** Explanations reviewed by a human out of those written. */
export interface ReviewProgress {
  reviewed: number;
  total: number;
}

export interface CourseSummary {
  id: string;
  title: string;
  opening: string;
  /** The opening's full name, e.g. "Traxler Counterattack". */
  openingTitle: string;
  /** The opening's root position and the moves that reach it, e.g. "1. e4 e5 2. Nf3 …". */
  rootFen: string;
  rootLine: string;
  lines: number;
  traps: number;
  learner: 'white' | 'black';
  /** "wield": the learner plays the opening's idea. "face": the learner meets it. */
  stance: 'wield' | 'face';
  status: CourseStatus;
  /** Every lesson reviewed and no checker problems. */
  publishable: boolean;
  review: ReviewProgress;
  lessons: number;
}

/** content/courses/<id>.json; its lessons are at content/lessons/<course>/<lesson>.json. */
export interface CompiledCourse extends Omit<CourseSummary, 'lessons' | 'lines' | 'traps'> {
  /** The course's sourced overview, or the first lesson's introduction. */
  overview?: Scholium;
  /** In course order: each lesson follows the lesson it continues from. */
  lessons: CourseLesson[];
}

export interface CourseLesson {
  id: string;
  title: string;
  /** One line on what the lesson covers. */
  summary?: string;
  status: string;
  review: ReviewProgress;
  sections: number;
  lines: number;
  traps: number;
  /** Where the lesson starts, and the last moves before it, e.g. "7.Kg1 Qh4". */
  startFen: string;
  after: string;
  /** The lesson and section this one continues from, found by matching positions. */
  continues?: { lesson: string; section: string; sectionTitle: string };
}

export interface LessonRef {
  id: string;
  title: string;
}

export interface CompiledLesson {
  id: string;
  course: string;
  title: string;
  summary?: string;
  status: string;
  learner: 'white' | 'black';
  /** Moves before the lesson begins, e.g. "1. e4 e5 2. Nf3 …". */
  start: string;
  /** Position after `start`. */
  startFen: string;
  /** Where `start` begins (normally the initial position), and its moves, played out when the lesson opens. */
  approachFen: string;
  approach: { san: string; uci: string; fen: string }[];
  intro?: Scholium;
  review: ReviewProgress;
  sections: CompiledSection[];
}

export interface CompiledSection {
  id: string;
  title: string;
  kind: 'main' | 'trap';
  /** Every move of the section's line from `startFen`. */
  plies: Ply[];
  /** Plies before this index are setup, played instantly. */
  firstStep: number;
  /** Evaluation of the section's starting position, from White's view ("+0.97", "#-3", "—"). */
  startScore: string;
  /** Where the section ends and what can happen next. */
  next: NextStep;
}

/** The position at the end of a section, and the options from it. */
export interface NextStep {
  fen: string;
  /** Lessons that start from this exact position. */
  lessons: LessonRef[];
  /** Moves the side to move might play, most popular first. */
  options: NextOption[];
}

export interface NextOption {
  san: string;
  uci: string;
  engine: EngineNote;
  citations: Citation[];
  /** Lessons that start right after this move. */
  lessons: LessonRef[];
}

export interface Ply {
  /** "5.Nxf7" or "5...Bxf2+". */
  label: string;
  san: string;
  uci: string;
  fenBefore: string;
  fenAfter: string;
  byLearner: boolean;
  engine: EngineNote;
  step?: Step;
}

export interface Step {
  prompt?: string;
  /** UCI of moves that count as correct; the line's move is always one of them. */
  accept: string[];
  scholium?: Scholium;
  /** The lesson follows a source the engine disagrees with; show both views. */
  dispute?: { engineBest: string; bestScore: string; lineScore: string };
  /** Learner steps: what the engine and sources say about other moves here. */
  alternatives?: Alternative[];
}

export interface EngineNote {
  /** "best", "loses 12 pts", or "not evaluated" (win-chance points vs the best move). */
  verdict: string;
  /** Evaluation after the move from White's view: "+0.97", "-4.59", "#-3", or "—". */
  scoreAfter: string;
  /** Within the margin of the best move, so the engine considers it a sound choice. */
  good: boolean;
  /** "55% of club players", when known. */
  club?: string;
}

export interface Alternative {
  san: string;
  uci: string;
  accepted: boolean;
  engine: EngineNote;
  /** Source commentary on this move, if any. */
  citations: Citation[];
  /** The engine's best continuation after this move, starting with the reply. */
  reply?: EngineReply;
}

export interface EngineReply {
  uci: string[];
  san: string[];
}

/** Commentary at a move: a summary of cited sources, or the sources' judgments alone. */
export interface Scholium {
  text: string | null;
  form?: string;
  status: 'drafted' | 'reviewed';
  citations: Citation[];
}

export interface Citation {
  title: string;
  author?: string;
  /** Chapter or section within the source. */
  locator?: string;
  url?: string;
  /** The source's judgments of the move, e.g. ["!!"]. */
  symbols: string[];
  /** The cited passage in full (may be empty when the source gives only symbols). */
  text: string;
}
