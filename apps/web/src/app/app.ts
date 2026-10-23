import { ChangeDetectionStrategy, Component } from '@angular/core';
import { RouterLink, RouterOutlet } from '@angular/router';
import { Logo } from './brand/logo';

@Component({
  selector: 'app-root',
  template: `
    <header class="top">
      <a routerLink="/" class="brand" aria-label="Scholia, home"><app-logo /></a>
    </header>
    <main><router-outlet /></main>
  `,
  styles: `
    .top {
      display: flex;
      align-items: baseline;
      gap: 0.85rem;
      padding: 0.75rem 2rem 0.85rem;
      border-bottom: 1px solid var(--rule);
    }
    .brand { text-decoration: none; }
    main { padding: 1.75rem 2rem 3rem; max-width: 1180px; margin: 0 auto; }
  `,
  imports: [RouterOutlet, RouterLink, Logo],
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class App {}
