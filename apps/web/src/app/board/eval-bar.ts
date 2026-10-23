import { ChangeDetectionStrategy, Component, computed, input } from '@angular/core';

/**
 * White's share of the bar from a score like "+0.97", "-4.59", "#-3" or "—",
 * using the same win-chance curve as the pipeline (Lichess's model).
 */
function whiteShare(score: string): number | undefined {
  if (score.startsWith('#')) return Number(score.slice(1)) > 0 ? 100 : 0;
  const pawns = Number(score);
  if (!Number.isFinite(pawns)) return undefined;
  return 50 + 50 * (2 / (1 + Math.exp(-0.00368208 * pawns * 100)) - 1);
}

/** A vertical evaluation bar; White's share fills from the bottom when White is at the bottom. */
@Component({
  selector: 'app-eval-bar',
  template: `
    <div class="bar" [class.flipped]="orientation() === 'black'" [class.unknown]="share() === undefined">
      <div class="white" [style.height.%]="share() ?? 50"></div>
    </div>
    <span class="score" [title]="'Engine evaluation (White\\'s view)'">{{ score() }}</span>
  `,
  styles: `
    :host { display: flex; flex-direction: column; align-items: center; gap: 0.35rem; width: 1.6rem; }
    .bar {
      position: relative;
      flex: 1;
      width: 0.7rem;
      border-radius: 4px;
      overflow: hidden;
      background: var(--eval-black);
      box-shadow: inset 0 0 0 1px var(--border);
    }
    .white {
      position: absolute;
      bottom: 0;
      left: 0;
      right: 0;
      background: var(--eval-white);
      transition: height 300ms ease;
    }
    .flipped .white { bottom: auto; top: 0; }
    .unknown { opacity: 0.35; }
    .score { font-family: var(--mono); font-size: 0.65rem; color: var(--muted); }
  `,
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class EvalBar {
  readonly score = input.required<string>();
  readonly orientation = input<'white' | 'black'>('white');
  protected readonly share = computed(() => whiteShare(this.score()));
}
