import { ChangeDetectionStrategy, Component } from '@angular/core';
import { RouterLink, RouterOutlet } from '@angular/router';

@Component({
  selector: 'app-root',
  template: `
    <header class="top">
      <a routerLink="/" class="brand">Scholia</a>
      <span class="tagline">Understand the move.</span>
    </header>
    <main><router-outlet /></main>
  `,
  styles: `
    .top { display: flex; align-items: baseline; gap: 0.75rem; padding: 0.75rem 1.5rem; border-bottom: 1px solid var(--border); }
    .brand { font-weight: 700; font-size: 1.2rem; color: var(--text); text-decoration: none; }
    .tagline { color: var(--muted); font-size: 0.85rem; }
    main { padding: 1.5rem; max-width: 1280px; margin: 0 auto; }
  `,
  imports: [RouterOutlet, RouterLink],
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class App {}
