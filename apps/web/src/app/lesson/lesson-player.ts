import { httpResource } from '@angular/common/http';
import {
  ChangeDetectionStrategy,
  Component,
  computed,
  DestroyRef,
  effect,
  inject,
  input,
  signal,
  untracked,
  viewChild,
} from '@angular/core';
import { NgTemplateOutlet } from '@angular/common';
import { RouterLink } from '@angular/router';
import { playUci } from '@scholia/chess-core';
import type { Alternative, CompiledLesson, CompiledSection, EngineNote, Ply } from '@scholia/lesson-format';
import { Board } from '../board/board';
import { lessonUrl } from '../content';
import { Citations, ScholiumView } from './scholium-view';

/** Milliseconds before the opponent's move is played. */
const OPPONENT_DELAY = 600;

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

@Component({
  selector: 'app-lesson-player',
  templateUrl: './lesson-player.html',
  styleUrl: './lesson-player.scss',
  imports: [Board, ScholiumView, Citations, RouterLink, NgTemplateOutlet],
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
  /** The ply whose commentary is on screen while the board plays on. */
  protected readonly shown = signal<Ply | undefined>(undefined);
  protected readonly completed = signal(new Set<string>());

  /** What the board shows; differs from the line after a wrong or alternative move. */
  protected readonly fen = signal('');
  protected readonly lastMove = signal<string | undefined>(undefined);

  protected readonly section = computed<CompiledSection | undefined>(
    () => this.lesson.value()?.sections[this.sectionIndex()],
  );
  protected readonly current = computed(() => this.section()?.plies[this.cursor()]);
  protected readonly orientation = computed(() => this.lesson.value()?.learner ?? 'white');
  /** Who moves at the end of the section, and arrows for their options. */
  protected readonly nextMover = computed(() => (this.section()?.next.fen.split(' ')[1] === 'w' ? 'White' : 'Black'));
  protected readonly arrows = computed(() =>
    this.phase() === 'done'
      ? (this.section()?.next.options ?? []).map((o) => ({ uci: o.uci, good: o.engine.good }))
      : [],
  );
  protected readonly inCheck = computed(() => {
    const last = this.section()?.plies[this.cursor() - 1];
    return this.fen() === last?.fenAfter && /[+#]$/.test(last.san);
  });

  private readonly board = viewChild(Board);
  private timer?: ReturnType<typeof setTimeout>;

  constructor() {
    inject(DestroyRef).onDestroy(() => clearTimeout(this.timer));
    // Following a link to another lesson reuses this component: start over.
    effect(() => {
      this.courseId();
      this.lessonId();
      untracked(() => {
        clearTimeout(this.timer);
        this.phase.set('intro');
        this.sectionIndex.set(0);
        this.cursor.set(0);
        this.fen.set('');
        this.lastMove.set(undefined);
        this.feedback.set(undefined);
        this.completed.set(new Set());
      });
    });
  }

  protected start(index: number): void {
    const section = this.lesson.value()?.sections[index];
    if (!section) return;
    clearTimeout(this.timer);
    this.sectionIndex.set(index);
    // Moves before the first step are setup: jump straight past them.
    this.cursor.set(section.firstStep);
    const setupEnd = section.plies[section.firstStep - 1];
    this.fen.set(section.plies[section.firstStep]?.fenBefore ?? setupEnd?.fenAfter ?? this.lesson.value()!.startFen);
    this.lastMove.set(setupEnd?.uci);
    this.feedback.set(undefined);
    this.shown.set(undefined);
    this.advance();
  }

  /** Plays forward until the learner has to move or read something. */
  protected advance(): void {
    const section = this.section();
    const ply = this.current();
    this.feedback.set(undefined);
    if (!section || !ply) {
      this.phase.set('done');
      if (section) this.completed.update((done) => new Set(done).add(section.id));
      return;
    }
    if (ply.byLearner && ply.step?.prompt) {
      this.phase.set('awaiting');
      return;
    }
    this.phase.set('playing');
    this.timer = setTimeout(() => {
      this.play(ply);
      if (ply.step?.scholium) {
        this.shown.set(ply);
        this.phase.set('reading');
      } else {
        this.advance();
      }
    }, OPPONENT_DELAY);
  }

  protected onMove(uci: string): void {
    const ply = this.current();
    if (this.phase() !== 'awaiting' || !ply?.step) return;
    // Normalizes castling (e8h8 → e8g8) and gives the SAN.
    const move = playUci(ply.fenBefore, uci);
    this.fen.set(move.fen);
    this.lastMove.set(move.uci);
    this.phase.set('feedback');

    if (move.uci === ply.uci) {
      this.cursor.update((c) => c + 1);
      this.feedback.set({ kind: 'correct', ply });
    } else if (ply.step.accept.includes(move.uci) || this.engineSound(ply, move.uci)) {
      // A deviation isn't a mistake when the engine rates it as sound.
      const engine = ply.step.alternatives?.find((a) => a.uci === move.uci)?.engine;
      this.feedback.set({ kind: 'alsoGood', ply, played: move.san, ...(engine && { engine }) });
    } else {
      const alternative = ply.step.alternatives?.find((a) => a.uci === move.uci);
      this.feedback.set({ kind: 'wrong', ply, played: move.san, ...(alternative && { alternative }) });
    }
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
    this.fen.set(ply.fenBefore);
    this.lastMove.set(this.section()?.plies[this.cursor() - 1]?.uci);
    this.board()?.reset();
    this.feedback.set(undefined);
    this.phase.set('awaiting');
  }

  protected reveal(): void {
    const ply = this.current();
    if (!ply) return;
    this.play(ply);
    this.phase.set('feedback');
    this.feedback.set({ kind: 'revealed', ply });
  }

  protected restart(): void {
    this.start(this.sectionIndex());
  }

  private engineSound(ply: Ply, uci: string): boolean {
    return ply.step?.alternatives?.find((a) => a.uci === uci)?.engine.good ?? false;
  }

  private play(ply: Ply): void {
    this.fen.set(ply.fenAfter);
    this.lastMove.set(ply.uci);
    this.cursor.update((c) => c + 1);
  }
}
