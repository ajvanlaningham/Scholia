import { ChangeDetectionStrategy, Component, input } from '@angular/core';
import type { Citation, Scholium } from '@scholia/lesson-format';

const label = (c: Citation) => `${c.title}${c.author ? ` (${c.author})` : ''}${c.locator ? `, ${c.locator}` : ''}`;

/** Sources as numbered footnotes; each opens to the full cited passage. */
@Component({
  selector: 'app-citations',
  template: `
    <ol class="notes">
      @for (c of citations(); track $index) {
        <li>
          <details>
            <summary>
              <span class="num">{{ $index + 1 }}</span>
              <span class="title">{{ label(c) }}</span>
              @if (c.symbols.length) {
                <strong class="symbols">{{ c.symbols.join(' ') }}</strong>
              }
            </summary>
            @if (c.text) {
              <blockquote>{{ c.text }}</blockquote>
            } @else {
              <p class="none">A judgement only, no text.</p>
            }
            @if (c.url) {
              <a [href]="c.url" target="_blank" rel="noopener">Open the source ↗</a>
            }
          </details>
        </li>
      }
    </ol>
  `,
  styles: `
    .notes { list-style: none; margin: 0.5rem 0 0; padding: 0.5rem 0 0; border-top: 1px solid var(--rule); }
    li { margin: 0.15rem 0; }
    summary { cursor: pointer; font-size: 0.82rem; color: var(--muted); list-style: none; display: flex; gap: 0.4rem; align-items: baseline; }
    summary::-webkit-details-marker { display: none; }
    summary:hover .title { color: var(--text); text-decoration: underline; }
    .num { font-size: 0.7rem; color: var(--rubric); font-weight: 700; min-width: 0.8rem; }
    .symbols { color: var(--text); font-family: var(--serif); }
    blockquote {
      white-space: pre-wrap;
      margin: 0.4rem 0 0.4rem 1.2rem;
      padding-left: 0.75rem;
      border-left: 2px solid var(--rule);
      font-family: var(--serif);
      font-size: 0.9rem;
      line-height: 1.5;
      color: var(--muted);
    }
    .none { margin: 0.3rem 0 0.3rem 1.2rem; font-size: 0.82rem; color: var(--muted); }
    a { margin-left: 1.2rem; font-size: 0.8rem; }
  `,
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class Citations {
  readonly citations = input.required<Citation[]>();
  protected readonly label = label;
}

/** Commentary at a move: the summary with footnote marks, then the sources. */
@Component({
  selector: 'app-scholium',
  template: `
    @let s = scholium();
    @if (s.text) {
      <p class="text">
        {{ s.text }}@for (c of s.citations; track $index) {<sup>{{ $index + 1 }}</sup>}
      </p>
    } @else {
      <p class="judgement">
        @for (c of s.citations; track $index) {
          {{ c.symbols.join(' ') }}<sup>{{ $index + 1 }}</sup>
        }
      </p>
    }
    <p class="meta">
      {{ s.text ? (s.form === 'model-summary' ? 'Summarised from the sources below' : s.form) : 'The source gives its judgement only' }}
      @if (s.status === 'drafted') {
        · <span class="drafted">draft, not yet reviewed</span>
      }
    </p>
    <app-citations [citations]="s.citations" />
  `,
  styles: `
    .text, .judgement { margin: 0 0 0.35rem; font-family: var(--serif); font-size: 1.05rem; line-height: 1.55; }
    .judgement { font-size: 1.3rem; }
    sup { font-family: var(--sans); font-size: 0.6rem; color: var(--rubric); font-weight: 700; margin-left: 0.1rem; }
    .meta { margin: 0; font-size: 0.75rem; color: var(--muted); }
    .drafted { color: var(--warn); }
  `,
  imports: [Citations],
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class ScholiumView {
  readonly scholium = input.required<Scholium>();
}
