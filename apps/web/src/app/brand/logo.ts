import { ChangeDetectionStrategy, Component } from '@angular/core';
import { MARK_INK, MARK_RED, MARK_VIEWBOX } from './logo-paths';

/**
 * The wordmark: the traced S-knight from brand/ followed by "cholia" in Libre
 * Caslon, as in the logo. Colours follow the theme (--logo-red, --logo-ink).
 */
@Component({
  selector: 'app-logo',
  template: `
    <span class="wordmark">
      <svg class="mark" [attr.viewBox]="viewBox" aria-hidden="true">
        <path class="red" fill-rule="evenodd" [attr.d]="red" />
        <path class="ink" fill-rule="evenodd" [attr.d]="ink" />
      </svg>
      <span class="rest">cholia</span>
      <span class="sr-only">Scholia</span>
    </span>
    <span class="tagline">Beyond the Book</span>
  `,
  styles: `
    :host { display: inline-flex; align-items: flex-end; gap: 0.9rem; }
    .wordmark { display: inline-flex; align-items: flex-end; line-height: 1; }
    .mark { height: 2.6rem; width: auto; margin-right: -0.12rem; }
    .red { fill: var(--logo-red); }
    .ink { fill: var(--logo-ink); }
    .rest {
      font-family: var(--serif);
      font-weight: 700;
      font-size: 1.75rem;
      color: var(--logo-ink);
      letter-spacing: 0.01em;
      padding-bottom: 0.02rem;
    }
    .tagline {
      font-family: var(--serif);
      font-style: italic;
      font-size: 0.95rem;
      color: var(--logo-red);
      padding-bottom: 0.2rem;
    }
    .sr-only { position: absolute; width: 1px; height: 1px; overflow: hidden; clip: rect(0 0 0 0); }
  `,
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class Logo {
  protected readonly viewBox = MARK_VIEWBOX;
  protected readonly red = MARK_RED;
  protected readonly ink = MARK_INK;
}
