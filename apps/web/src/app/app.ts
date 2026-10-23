import { ChangeDetectionStrategy, Component } from '@angular/core';
import { RouterLink, RouterOutlet } from '@angular/router';

@Component({
  selector: 'app-root',
  template: `
    <header class="top">
      <a routerLink="/" class="brand">Scholia</a>
      <span class="tagline">Beyond the Book</span>
    </header>
    <main><router-outlet /></main>
  `,
  styles: `
    .top {
      display: flex;
      align-items: baseline;
      gap: 0.85rem;
      padding: 0.9rem 2rem;
      border-bottom: 1px solid var(--rule);
    }
    .brand {
      font-family: var(--serif);
      font-size: 1.35rem;
      font-weight: 600;
      letter-spacing: 0.02em;
      color: var(--text);
      text-decoration: none;
    }
    .brand::first-letter { color: var(--rubric); }
    .tagline { font-family: var(--serif); font-style: italic; color: var(--muted); font-size: 0.95rem; }
    main { padding: 1.75rem 2rem 3rem; max-width: 1180px; margin: 0 auto; }
  `,
  imports: [RouterOutlet, RouterLink],
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class App {}
