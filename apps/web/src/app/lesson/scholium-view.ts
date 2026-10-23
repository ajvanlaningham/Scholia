import { ChangeDetectionStrategy, Component, input } from '@angular/core';
import type { Citation, Scholium } from '@scholia/lesson-format';

/** The cited sources, each collapsed to its title. */
@Component({
  selector: 'app-citations',
  template: `
    @for (c of citations(); track $index) {
      <details>
        <summary>{{ label(c) }} @if (c.symbols.length) {<strong>{{ c.symbols.join(' ') }}</strong>}</summary>
        @if (c.text) {
          <blockquote>{{ c.text }}</blockquote>
        } @else {
          <p class="none">Symbol only, no text.</p>
        }
        @if (c.url) {
          <a [href]="c.url" target="_blank" rel="noopener">Open source ↗</a>
        }
      </details>
    }
  `,
  styles: `
    details { border-left: 3px solid var(--border); padding: 0.25rem 0 0.25rem 0.75rem; margin: 0.25rem 0; }
    summary { cursor: pointer; font-size: 0.9rem; }
    blockquote { white-space: pre-wrap; margin: 0.5rem 0; font-size: 0.9rem; color: var(--muted); }
    .none { font-size: 0.85rem; color: var(--muted); }
    a { font-size: 0.85rem; }
  `,
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class Citations {
  readonly citations = input.required<Citation[]>();

  protected label(c: Citation): string {
    return `${c.title}${c.author ? ` (${c.author})` : ''}${c.locator ? `, ${c.locator}` : ''}`;
  }
}

/** Commentary at a move: the summary, then each cited source, collapsed. */
@Component({
  selector: 'app-scholium',
  template: `
    @let s = scholium();
    @if (s.text) {
      <p class="text">{{ s.text }}</p>
    }
    <p class="meta">
      @if (s.text) {
        {{ s.form === 'model-summary' ? 'Summary of the sources below' : s.form }} ·
      } @else {
        The sources give only their judgment ·
      }
      <span [class.drafted]="s.status === 'drafted'">{{ s.status }}</span>
    </p>
    <app-citations [citations]="s.citations" />
  `,
  styles: `
    .text { margin: 0 0 0.25rem; line-height: 1.5; }
    .meta { margin: 0 0 0.5rem; font-size: 0.8rem; color: var(--muted); }
    .drafted { color: var(--warn); }
  `,
  imports: [Citations],
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class ScholiumView {
  readonly scholium = input.required<Scholium>();
}
