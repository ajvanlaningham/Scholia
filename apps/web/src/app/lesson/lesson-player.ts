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
  /** Browsing history: how many of the section's plies the board shows; undefined is live. */
  protected readonly viewing = signal<number | undefined>(undefined);
  /** The engine's punishment being played out on the board. */
  private readonly preview = signal<{ fen: string; lastMove: string; step: number } | undefined>(undefined);

  protected readonly section = computed<CompiledSection | undefined>(
    () => this.lesson.value()?.sections[this.sectionIndex()],
  );
  protected readonly current = computed(() => this.section()?.plies[this.cursor()]);
  protected readonly orientation = computed(() => this.lesson.value()?.learner ?? 'white');
  protected readonly opponent = computed(() => (this.orientation() === 'white' ? 'Black' : 'White'));

  /** The position after `k` plies of the current section. */
  private fenAt(k: number): string {
    const plies = this.section()?.plies ?? [];
    return k === 0 ? (plies[0]?.fenBefore ?? this.lesson.value()?.startFen ?? '') : plies[k - 1]!.fenAfter;
  }

  /** The live board is on the lesson's line (not showing a deviation). */
  private readonly liveOnLine = computed(() => this.liveFen() === this.fenAt(this.cursor()));
  /** Where "live" sits in history: on the last played move, or one past it after a deviation. */
  private readonly liveIndex = computed(() => (this.liveOnLine() ? this.cursor() : this.cursor() + 1));

  protected readonly boardFen = computed(() => {
    const preview = this.preview();
    if (preview) return preview.fen;
    const k = this.viewing();
    return k === undefined ? this.liveFen() || (this.lesson.value()?.startFen ?? '') : this.fenAt(k);
  });
  protected readonly boardLastMove = computed(() => {
    const preview = this.preview();
    if (preview) return preview.lastMove;
    const k = this.viewing();
    return k === undefined ? this.liveLastMove() : this.section()?.plies[k - 1]?.uci;
  });
  protected readonly boardMovable = computed(() => this.phase() === 'awaiting' && this.viewing() === undefined);
  protected readonly inCheck = computed(() => {
    const k = this.viewing() ?? this.cursor();
    const last = this.section()?.plies[k - 1];
    return this.boardFen() === last?.fenAfter && /[+#]$/.test(last.san);
  });

  /** Evaluation of the position on the board, from White's view. */
  protected readonly boardScore = computed(() => {
    const section = this.section();
    if (!section || this.phase() === 'intro') return '—';
    const f = this.feedback();
    if (this.viewing() === undefined && f?.kind === 'wrong') return f.alternative?.engine.scoreAfter ?? '—';
    if (this.viewing() === undefined && f?.kind === 'alsoGood') return f.engine?.scoreAfter ?? '—';
    const k = this.viewing() ?? this.cursor();
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

  /** The section's moves as a game score: what's been played, then the move being asked for. */
  protected readonly score = computed(() => {
    const section = this.section();
    if (!section || this.phase() === 'intro') return [];
    const played = this.phase() === 'done' ? section.plies.length : this.cursor();
    const asking = this.phase() === 'awaiting' || this.feedback()?.kind === 'wrong' || this.feedback()?.kind === 'alsoGood';
    return section.plies.slice(0, played + (asking ? 1 : 0)).map((p, i) => ({
      ply: p,
      index: i + 1,
      number: p.label.replace(/\..*$/, ''),
      white: !p.label.includes('...'),
      pending: i === played,
      setup: i < section.firstStep,
    }));
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
      });
    });
  }

  // ── Lesson flow ──────────────────────────────────────────────────────────

  protected start(index: number): void {
    const section = this.lesson.value()?.sections[index];
    if (!section) return;
    this.stopTimers();
    this.sectionIndex.set(index);
    // Moves before the first step are setup: jump straight past them.
    this.cursor.set(section.firstStep);
    this.liveFen.set(this.fenAt(section.firstStep));
    this.liveLastMove.set(section.plies[section.firstStep - 1]?.uci);
    this.tally.set(emptyTally());
    this.shown.set(undefined);
    this.advance();
  }

  /** Plays forward until the learner has to move or read something. */
  protected advance(): void {
    this.stopTimers();
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

  protected readonly canGoBack = computed(() => this.phase() !== 'intro' && (this.viewing() ?? this.liveIndex()) > 0);
  protected readonly canGoForward = computed(() => this.viewing() !== undefined);

  protected back(): void {
    if (!this.canGoBack()) return;
    this.stopTimers();
    this.viewing.set(Math.min((this.viewing() ?? this.liveIndex()) - 1, this.cursor()));
  }

  protected forward(): void {
    const k = this.viewing();
    if (k !== undefined) this.view(k + 1);
  }

  protected first(): void {
    if (this.phase() === 'intro') return;
    this.stopTimers();
    this.viewing.set(0);
  }

  protected live(): void {
    this.viewing.set(undefined);
  }

  /** Shows the position after `k` plies; returns to live when that's where play is. */
  protected view(k: number): void {
    this.stopTimers();
    const end = this.phase() === 'done' ? (this.section()?.plies.length ?? 0) : this.liveIndex();
    this.viewing.set(k >= end ? undefined : k);
  }

  /** The move that led to the viewed position, for its commentary. */
  protected readonly viewedPly = computed(() => {
    const k = this.viewing();
    return k === undefined || k === 0 ? undefined : this.section()?.plies[k - 1];
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
