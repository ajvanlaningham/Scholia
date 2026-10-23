import {
  afterNextRender,
  ChangeDetectionStrategy,
  Component,
  computed,
  DestroyRef,
  effect,
  type ElementRef,
  inject,
  input,
  output,
  viewChild,
} from '@angular/core';
import { legalDests, sideToMove } from '@scholia/chess-core';
import { Chessground } from 'chessground';
import type { Api } from 'chessground/api';
import type { Config } from 'chessground/config';
import type { Key } from 'chessground/types';

export interface BoardShape {
  orig: string;
  dest?: string;
  brush: 'green' | 'red' | 'blue' | 'yellow';
}

/** Lichess's chessground board. Legal moves come from chess-core. */
@Component({
  selector: 'app-board',
  template: `<div #host class="board"></div>`,
  styles: `
    :host { display: block; }
    .board { width: 100%; aspect-ratio: 1; }
  `,
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class Board {
  readonly fen = input.required<string>();
  readonly orientation = input<'white' | 'black'>('white');
  /** Whether the side to move may move pieces. */
  readonly movable = input(false);
  /** UCI of the move to highlight. */
  readonly lastMove = input<string | undefined>();
  readonly check = input(false);
  /** Circles (no `dest`) and arrows to draw: hints, refutations, options. */
  readonly shapes = input<BoardShape[]>([]);
  /** Emits the UCI of a move the user made (pawns reaching the last rank promote to a queen). */
  readonly moved = output<string>();

  private readonly host = viewChild.required<ElementRef<HTMLElement>>('host');
  private api?: Api;

  private readonly config = computed((): Config => {
    const fen = this.fen();
    const turn = sideToMove(fen);
    const last = this.lastMove();
    return {
      fen,
      orientation: this.orientation(),
      turnColor: turn,
      lastMove: last ? [last.slice(0, 2) as Key, last.slice(2, 4) as Key] : undefined,
      check: this.check() ? turn : false,
      movable: {
        free: false,
        color: this.movable() ? turn : undefined,
        dests: this.movable() ? (legalDests(fen) as Map<Key, Key[]>) : new Map(),
        showDests: true,
      },
      premovable: { enabled: false },
      drawable: {
        autoShapes: this.shapes().map((s) => ({ orig: s.orig as Key, ...(s.dest && { dest: s.dest as Key }), brush: s.brush })),
      },
      animation: { enabled: true, duration: 200 },
    };
  });

  constructor() {
    afterNextRender(() => {
      this.api = Chessground(this.host().nativeElement, {
        ...this.config(),
        movable: { ...this.config().movable, events: { after: (orig, dest) => this.onMove(orig, dest) } },
      });
    });
    effect(() => {
      // Read the config before touching the board: if the board doesn't exist
      // yet, `api?.set(this.config())` would skip the read and leave this
      // effect with no dependencies, so it would never run again.
      const config = this.config();
      this.api?.set(config);
    });
    inject(DestroyRef).onDestroy(() => this.api?.destroy());
  }

  /** Redraws the current position, e.g. to undo a move the user dragged. */
  reset(): void {
    this.api?.set(this.config());
  }

  private onMove(orig: Key, dest: Key): void {
    const piece = this.api?.state.pieces.get(dest);
    const promotes = piece?.role === 'pawn' && (dest[1] === '1' || dest[1] === '8');
    this.moved.emit(`${orig}${dest}${promotes ? 'q' : ''}`);
  }
}
