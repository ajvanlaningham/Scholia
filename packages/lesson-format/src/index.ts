// The compiled lesson format: what the lesson checker emits and the web app
// plays. Everything is resolved ahead of time (positions, citations with full
// text, engine verdicts), so the player needs no chess-data logic beyond
// legality, and an API can later serve the same shape.

/** All courses, for the home page: content/index.json. */
export interface CourseIndex {
  courses: CourseSummary[];
}

export interface CourseSummary {
  id: string;
  title: string;
  opening: string;
  learner: 'white' | 'black';
  /** "wield": the learner plays the opening's idea. "face": the learner meets it. */
  stance: 'wield' | 'face';
  lessons: number;
}

/** content/courses/<id>.json; its lessons are at content/lessons/<course>/<lesson>.json. */
export interface CompiledCourse extends Omit<CourseSummary, 'lessons'> {
  /** In course order: each lesson follows the lesson it continues from. */
  lessons: CourseLesson[];
}

export interface CourseLesson {
  id: string;
  title: string;
  status: string;
  sections: number;
  /** The lesson and section this one continues from, found by matching positions. */
  continues?: { lesson: string; section: string };
}

export interface LessonRef {
  id: string;
  title: string;
}

export interface CompiledLesson {
  id: string;
  course: string;
  title: string;
  status: string;
  learner: 'white' | 'black';
  /** Moves before the lesson begins, e.g. "1. e4 e5 2. Nf3 …". */
  start: string;
  /** Position after `start`. */
  startFen: string;
  intro?: Scholium;
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
