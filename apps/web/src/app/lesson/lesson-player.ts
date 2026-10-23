import { NgTemplateOutlet } from '@angular/common';
import { httpResource } from '@angular/common/http';
import {
  ChangeDetectionStrategy,
  Component,
  computed,
  DestroyRef,
  effect,
  HostListener,
  inject,
  input,
  signal,
  untracked,
  viewChild,
} from '@angular/core';
import { RouterLink } from '@angular/router';
import { playUci, playUciLine } from '@scholia/chess-core';
import type { Alternative, CompiledLesson, CompiledSection, EngineNote, Ply } from '@scholia/lesson-format';
import { Board, type BoardShape } from '../board/board';
import { EvalBar } from '../board/eval-bar';
import { lessonUrl } from '../content';
import { StatusBadge } from '../status-badge';
import { Citations, ScholiumView } from './scholium-view';

/** Milliseconds before the opponent's move is played. */
const OPPONENT_DELAY = 700;
/** Milliseconds between moves when playing out the engine's punishment. */
const PLAY_OUT_STEP = 750;
/** Pace of the opening moves played out when a lesson opens, capped in total. */
const APPROACH_STEP = 550;
const APPROACH_MAX_TOTAL = 6000;
/** Pace of the moves leading into a section. */
const SETUP_STEP = 450;

type Phase =
  | 'intro' // lesson introduction, before the first section
  | 'playing' // the board is playing moves on its own
  | 'reading' // paused on a move's commentary
  | 'awaiting' // the learner's turn
  | 'feedback' // after the learner's move
  | 'done'; // section finished

type Feedback =
  | { kind: 'correct' | 'revealed'; ply: Ply }
  | { kind: 'alsoGood'; ply: Ply; played: string; engine?: EngineNote }
  | { kind: 'wrong'; ply: Ply; played: string; alternative?: Alternative };

/** How the learner did on one section. */
interface Tally {
  prompts: number;
  firstTry: number;
  hints: number;
  revealed: number;
}

const emptyTally = (): Tally => ({ prompts: 0, firstTry: 0, hints: 0, revealed: 0 });

@Component({
  selector: 'app-lesson-player',
  templateUrl: './lesson-player.html',
  styleUrl: './lesson-player.scss',
  imports: [Board, EvalBar, ScholiumView, Citations, RouterLink, NgTemplateOutlet, StatusBadge],
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class LessonPlayer {
  /** Route parameters. */
  readonly courseId = input.required<string>();
  readonly lessonId = input.required<string>();

  protected readonly lesson = httpResource<CompiledLesson>(() => lessonUrl(this.courseId(), this.lessonId()));

  protected readonly sectionIndex = signal(0);
  /** Plies of the current section that have been played. */
  protected readonly cursor = signal(0);
  protected readonly phase = signal<Phase>('intro');
  protected readonly feedback = signal<Feedback | undefined>(undefined);
  /** The opponent's move whose commentary is on screen (alone, or above the learner's prompt). */
  protected readonly shown = signal<Ply | undefined>(undefined);
  protected readonly completed = signal(new Set<string>());
  protected readonly tally = signal<Tally>(emptyTally());
  /** 0: none; 1: the piece to move is circled; 2: the move is drawn. */
  protected readonly hintLevel = signal(0);
  /** False once the current prompt has been missed, hinted, or revealed. */
  private readonly promptClean = signal(true);

  /** The live position; differs from the line after a wrong or alternative move. */
  private readonly liveFen = signal('');
  private readonly liveLastMove = signal<string | undefined>(undefined);
  /**
   * Browsing history, as an index over the whole game: 0 is where the lesson's
   * moves begin (normally the initial position), then each opening move, then
   * each move of the current section. Undefined is live.
   */
  protected readonly viewing = signal<number | undefined>(undefined);
  /** The engine's punishment being played out on the board. */
  private readonly preview = signal<{ fen: string; lastMove: string; step: number } | undefined>(undefined);
  /** How many of the lesson's opening moves have been played out on the intro board. */
  protected readonly approachShown = signal(0);
  /** The moves leading into a section are being played out. */
  protected readonly settingUp = signal(false);

  protected readonly section = computed<CompiledSection | undefined>(
    () => this.lesson.value()?.sections[this.sectionIndex()],
  );
  protected readonly current = computed(() => this.section()?.plies[this.cursor()]);
  protected readonly orientation = computed(() => this.lesson.value()?.learner ?? 'white');
  protected readonly opponent = computed(() => (this.orientation() === 'white' ? 'Black' : 'White'));

  private readonly approach = computed(() => this.lesson.value()?.approach ?? []);
  /** History index of the lesson's start: the end of its opening moves. */
  private readonly base = computed(() => this.approach().length);

  /** The position after `k` plies of the current section. */
  private fenAt(k: number): string {
    const plies = this.section()?.plies ?? [];
    return k === 0 ? (plies[0]?.fenBefore ?? this.lesson.value()?.startFen ?? '') : plies[k - 1]!.fenAfter;
  }

  /** The move that reached history index `g` (none at 0). */
  private moveAt(g: number): { san: string; uci: string; fen: string } | undefined {
    const base = this.base();
    if (g > base) {
      const ply = this.section()?.plies[g - base - 1];
      return ply && { san: ply.san, uci: ply.uci, fen: ply.fenAfter };
    }
    return g > 0 ? this.approach()[g - 1] : undefined;
  }

  private fenAtIndex(g: number): string {
    return g === 0 ? (this.lesson.value()?.approachFen ?? '') : g === this.base() ? this.fenAt(0) : (this.moveAt(g)?.fen ?? '');
  }

  /** The live board is on the lesson's line (not showing a deviation). */
  private readonly liveOnLine = computed(() => this.liveFen() === this.fenAt(this.cursor()));
  /** Where live play sits in the section: on the last played move, or one past it after a deviation. */
  private readonly liveIndex = computed(() => (this.liveOnLine() ? this.cursor() : this.cursor() + 1));
  /** Where live play sits in the whole game's history. */
  private readonly liveAt = computed(() => (this.phase() === 'intro' ? this.approachShown() : this.base() + this.liveIndex()));
  /** The history index highlighted in the score. */
  protected readonly atIndex = computed(
    () => this.viewing() ?? (this.phase() === 'intro' ? this.approachShown() : this.base() + this.cursor()),
  );

  protected readonly boardFen = computed(() => {
    const preview = this.preview();
    if (preview) return preview.fen;
    const g = this.viewing();
    if (g !== undefined) return this.fenAtIndex(g);
    const lesson = this.lesson.value();
    if (this.phase() === 'intro' && lesson) return lesson.approach[this.approachShown() - 1]?.fen ?? lesson.approachFen;
    return this.liveFen() || (lesson?.startFen ?? '');
  });
  protected readonly boardLastMove = computed(() => {
    const preview = this.preview();
    if (preview) return preview.lastMove;
    const g = this.viewing();
    if (g !== undefined) return this.moveAt(g)?.uci;
    if (this.phase() === 'intro') return this.approach()[this.approachShown() - 1]?.uci;
    return this.liveLastMove();
  });
  protected readonly boardMovable = computed(() => this.phase() === 'awaiting' && this.viewing() === undefined);
  protected readonly inCheck = computed(() => {
    const g = this.viewing();
    if (g !== undefined) return /[+#]$/.test(this.moveAt(g)?.san ?? '');
    if (this.phase() === 'intro') return /[+#]$/.test(this.approach()[this.approachShown() - 1]?.san ?? '');
    const last = this.section()?.plies[this.cursor() - 1];
    return this.boardFen() === last?.fenAfter && /[+#]$/.test(last.san);
  });

  /** Evaluation of the position on the board, from White's view. */
  protected readonly boardScore = computed(() => {
    const section = this.section();
    if (!section) return '—';
    const g = this.viewing();
    if (g !== undefined) {
      const k = g - this.base();
      return k < 0 ? '—' : k === 0 ? section.startScore : section.plies[k - 1]!.engine.scoreAfter;
    }
    if (this.phase() === 'intro') return '—';
    const f = this.feedback();
    if (f?.kind === 'wrong') return f.alternative?.engine.scoreAfter ?? '—';
    if (f?.kind === 'alsoGood') return f.engine?.scoreAfter ?? '—';
    const k = this.cursor();
    return k === 0 ? section.startScore : section.plies[k - 1]!.engine.scoreAfter;
  });

  protected readonly shapes = computed<BoardShape[]>(() => {
    if (this.viewing() !== undefined || this.preview()) return [];
    const ply = this.current();
    const f = this.feedback();
    if (this.phase() === 'awaiting' && ply && this.hintLevel() > 0) {
      const from = ply.uci.slice(0, 2);
      return this.hintLevel() === 1
        ? [{ orig: from, brush: 'blue' }]
        : [{ orig: from, dest: ply.uci.slice(2, 4), brush: 'blue' }];
    }
    if (f?.kind === 'wrong' && f.alternative?.reply) {
      const reply = f.alternative.reply.uci[0]!;
      return [{ orig: reply.slice(0, 2), dest: reply.slice(2, 4), brush: 'red' }];
    }
    if (this.phase() === 'done') {
      return (this.section()?.next.options ?? []).map((o) => ({
        orig: o.uci.slice(0, 2),
        dest: o.uci.slice(2, 4),
        brush: o.engine.good ? 'green' : 'yellow',
      }));
    }
    return [];
  });

  /**
   * The whole game as a score: the opening moves leading to the lesson, then
   * the section's moves so far, then the move being asked for.
   */
  protected readonly score = computed(() => {
    const lesson = this.lesson.value();
    if (!lesson) return [];
    const intro = this.phase() === 'intro';
    const entry = (fenBefore: string, san: string, g: number) => {
      const [, turn, , , , fullmove] = fenBefore.split(' ');
      return { g, san, number: fullmove ?? '', white: turn === 'w' };
    };
    const opening = lesson.approach
      .slice(0, intro ? this.approachShown() : undefined)
      .map((m, i) => ({
        ...entry(i === 0 ? lesson.approachFen : lesson.approach[i - 1]!.fen, m.san, i + 1),
        kind: 'opening' as 'opening' | 'setup' | 'move',
        learner: false,
        pending: false,
      }));
    const section = this.section();
    if (intro || !section) return opening;
    const played = this.phase() === 'done' ? section.plies.length : this.cursor();
    const asking = this.phase() === 'awaiting' || this.feedback()?.kind === 'wrong' || this.feedback()?.kind === 'alsoGood';
    const moves = section.plies.slice(0, played + (asking ? 1 : 0)).map((p, i) => ({
      ...entry(p.fenBefore, p.san, this.base() + i + 1),
      kind: (i < section.firstStep ? 'setup' : 'move') as 'opening' | 'setup' | 'move',
      learner: p.byLearner && !!p.step?.prompt,
      pending: i === played,
    }));
    return [...opening, ...moves];
  });

  protected readonly playingOut = computed(() => this.preview()?.step);

  private readonly board = viewChild(Board);
  private timer?: ReturnType<typeof setTimeout>;

  constructor() {
    inject(DestroyRef).onDestroy(() => clearTimeout(this.timer));
    // Following a link to another lesson reuses this component: start over.
    effect(() => {
      this.courseId();
      this.lessonId();
      untracked(() => {
        this.stopTimers();
        this.phase.set('intro');
        this.sectionIndex.set(0);
        this.cursor.set(0);
        this.liveFen.set('');
        this.liveLastMove.set(undefined);
        this.feedback.set(undefined);
        this.shown.set(undefined);
        this.viewing.set(undefined);
        this.completed.set(new Set());
        this.approachShown.set(0);
      });
    });
    // Once the lesson loads, play out the moves that lead to its starting position.
    effect(() => {
      if (this.lesson.value()) untracked(() => this.playApproach());
    });
  }

  /** Plays the lesson's opening moves from the initial position on the intro board. */
  protected playApproach(): void {
    const moves = this.lesson.value()?.approach ?? [];
    this.stopTimers();
    this.approachShown.set(0);
    const pace = Math.min(APPROACH_STEP, APPROACH_MAX_TOTAL / Math.max(moves.length, 1));
    const step = () => {
      if (this.phase() !== 'intro' || this.approachShown() >= moves.length) return;
      this.timer = setTimeout(() => {
        this.approachShown.update((n) => n + 1);
        step();
      }, pace);
    };
    // A beat on the initial position first, so the eye can find the board.
    this.timer = setTimeout(step, pace);
  }

  // ── Lesson flow ──────────────────────────────────────────────────────────

  protected start(index: number): void {
    const section = this.lesson.value()?.sections[index];
    if (!section) return;
    this.stopTimers();
    this.sectionIndex.set(index);
    this.cursor.set(0);
    this.liveFen.set(this.fenAt(0));
    this.liveLastMove.set(undefined);
    this.tally.set(emptyTally());
    this.shown.set(undefined);
    this.feedback.set(undefined);
    this.viewing.set(undefined);
    // Moves before the first step are setup: play them out, then begin.
    this.settingUp.set(section.firstStep > 0);
    this.phase.set('playing');
    const setup = () => {
      const ply = section.plies[this.cursor()];
      if (this.cursor() >= section.firstStep || !ply) return this.advance();
      this.timer = setTimeout(() => {
        this.play(ply);
        setup();
      }, SETUP_STEP);
    };
    setup();
  }

  /** Plays forward until the learner has to move or read something. */
  protected advance(): void {
    this.stopTimers();
    this.settingUp.set(false);
    this.viewing.set(undefined);
    this.feedback.set(undefined);
    const section = this.section();
    const ply = this.current();
    if (!section || !ply) {
      this.phase.set('done');
      if (section) this.completed.update((done) => new Set(done).add(section.id));
      return;
    }
    if (ply.byLearner && ply.step?.prompt) {
      this.beginPrompt();
      return;
    }
    // The opponent's move, or a learner move the lesson plays for you.
    this.shown.set(undefined);
    this.phase.set('playing');
    this.timer = setTimeout(() => {
      this.play(ply);
      if (!ply.step?.scholium) return this.advance();
      // If the learner moves next, show this commentary above the prompt
      // instead of making them click through it first.
      const next = this.current();
      if (next?.byLearner && next.step?.prompt) {
        this.beginPrompt(ply);
      } else {
        this.shown.set(ply);
        this.phase.set('reading');
      }
    }, OPPONENT_DELAY);
  }

  private beginPrompt(context?: Ply): void {
    this.shown.set(context);
    this.hintLevel.set(0);
    this.promptClean.set(true);
    this.tally.update((t) => ({ ...t, prompts: t.prompts + 1 }));
    this.phase.set('awaiting');
  }

  protected onMove(uci: string): void {
    const ply = this.current();
    if (!this.boardMovable() || !ply?.step) return;
    // Normalizes castling (e8h8 → e8g8) and gives the SAN.
    const move = playUci(ply.fenBefore, uci);
    this.liveFen.set(move.fen);
    this.liveLastMove.set(move.uci);
    this.phase.set('feedback');
    const alternative = ply.step.alternatives?.find((a) => a.uci === move.uci);

    if (move.uci === ply.uci) {
      if (this.promptClean()) this.tally.update((t) => ({ ...t, firstTry: t.firstTry + 1 }));
      this.cursor.update((c) => c + 1);
      this.feedback.set({ kind: 'correct', ply });
    } else if (ply.step.accept.includes(move.uci) || alternative?.engine.good) {
      // A deviation isn't a mistake when the engine rates it as sound.
      if (this.promptClean()) this.tally.update((t) => ({ ...t, firstTry: t.firstTry + 1 }));
      this.feedback.set({ kind: 'alsoGood', ply, played: move.san, ...(alternative && { engine: alternative.engine }) });
    } else {
      this.promptClean.set(false);
      this.feedback.set({ kind: 'wrong', ply, played: move.san, ...(alternative && { alternative }) });
    }
  }

  protected hint(): void {
    if (!this.boardMovable() || this.hintLevel() >= 2) return;
    if (this.hintLevel() === 0) this.tally.update((t) => ({ ...t, hints: t.hints + 1 }));
    this.promptClean.set(false);
    this.hintLevel.update((h) => h + 1);
  }

  /** After an accepted alternative: return to the lesson's line. */
  protected continueWithLine(): void {
    const ply = this.current();
    if (!ply) return;
    this.play(ply);
    this.feedback.set({ kind: 'revealed', ply });
  }

  protected retry(): void {
    const ply = this.current();
    if (!ply) return;
    this.stopTimers();
    this.liveFen.set(ply.fenBefore);
    this.liveLastMove.set(this.section()?.plies[this.cursor() - 1]?.uci);
    this.board()?.reset();
    this.feedback.set(undefined);
    this.phase.set('awaiting');
  }

  protected reveal(): void {
    const ply = this.current();
    if (!ply) return;
    this.stopTimers();
    this.promptClean.set(false);
    this.tally.update((t) => ({ ...t, revealed: t.revealed + 1 }));
    this.play(ply);
    this.phase.set('feedback');
    this.feedback.set({ kind: 'revealed', ply });
  }

  /** Animates the engine's punishment of a wrong move on the board. */
  protected playOut(): void {
    const f = this.feedback();
    if (f?.kind !== 'wrong' || !f.alternative?.reply) return;
    this.stopTimers();
    const moves = playUciLine(this.liveFen(), f.alternative.reply.uci);
    const step = (i: number) => {
      const m = moves[i];
      if (!m) return;
      this.preview.set({ fen: m.fen, lastMove: m.uci, step: i + 1 });
      this.timer = setTimeout(() => step(i + 1), PLAY_OUT_STEP);
    };
    step(0);
  }

  protected stopPlayOut(): void {
    this.stopTimers();
  }

  protected restart(): void {
    this.start(this.sectionIndex());
  }

  private play(ply: Ply): void {
    this.liveFen.set(ply.fenAfter);
    this.liveLastMove.set(ply.uci);
    this.cursor.update((c) => c + 1);
  }

  private stopTimers(): void {
    clearTimeout(this.timer);
    this.preview.set(undefined);
  }

  // ── History ──────────────────────────────────────────────────────────────

  protected readonly canGoBack = computed(() => (this.viewing() ?? this.liveAt()) > 0);
  protected readonly canGoForward = computed(() => this.viewing() !== undefined);

  protected back(): void {
    if (!this.canGoBack()) return;
    // Measured before pausing, so going back mid-playback steps from where it was.
    const from = this.viewing() ?? this.liveAt();
    this.pauseForHistory();
    this.viewing.set(from - 1);
  }

  protected forward(): void {
    const g = this.viewing();
    if (g !== undefined) this.view(g + 1);
  }

  protected first(): void {
    this.pauseForHistory();
    this.viewing.set(0);
  }

  protected live(): void {
    this.viewing.set(undefined);
  }

  /** Shows history index `g`; returns to live when that's where play is. */
  protected view(g: number): void {
    this.pauseForHistory();
    const end = this.phase() === 'done' ? this.base() + (this.section()?.plies.length ?? 0) : this.liveAt();
    this.viewing.set(g >= end ? undefined : g);
  }

  /** Stops any animation; on the intro, the opening counts as fully played. */
  private pauseForHistory(): void {
    this.stopTimers();
    if (this.phase() === 'intro') this.approachShown.set(this.base());
  }

  /** The section move that led to the viewed position, for its commentary. */
  protected readonly viewedPly = computed(() => {
    const g = this.viewing();
    return g === undefined || g <= this.base() ? undefined : this.section()?.plies[g - this.base() - 1];
  });

  /** The opening move that led to the viewed position, labelled like "3.Bc4". */
  protected readonly viewedOpening = computed(() => {
    const g = this.viewing();
    if (g === undefined || g === 0 || g > this.base()) return undefined;
    const m = this.score().find((e) => e.g === g);
    return m && `${m.number}${m.white ? '.' : '...'}${m.san}`;
  });

  // ── Keyboard ─────────────────────────────────────────────────────────────

  @HostListener('document:keydown', ['$event'])
  protected onKey(event: KeyboardEvent): void {
    if (event.target instanceof HTMLInputElement || event.metaKey || event.ctrlKey || event.altKey) return;
    const actions: Record<string, () => void> = {
      ArrowLeft: () => this.back(),
      ArrowRight: () => this.forward(),
      Home: () => this.first(),
      End: () => this.live(),
      h: () => this.hint(),
      Enter: () => this.primary(),
    };
    const action = actions[event.key];
    if (!action) return;
    event.preventDefault();
    action();
  }

  /** The card's main action, for the Enter key. */
  protected primary(): void {
    if (this.viewing() !== undefined) return this.live();
    const f = this.feedback();
    switch (this.phase()) {
      case 'intro':
        return this.start(0);
      case 'reading':
        return this.advance();
      case 'feedback':
        if (f?.kind === 'wrong') return this.retry();
        if (f?.kind === 'alsoGood') return this.continueWithLine();
        return this.advance();
      case 'done': {
        const next = this.sectionIndex() + 1;
        if (next < (this.lesson.value()?.sections.length ?? 0)) this.start(next);
        return;
      }
      default:
        return;
    }
  }
}
