import { httpResource } from '@angular/common/http';
import { ChangeDetectionStrategy, Component, computed, effect, signal } from '@angular/core';
import { RouterLink } from '@angular/router';
import type { CourseIndex, CourseSummary } from '@scholia/lesson-format';
import { indexUrl, stanceLabel } from '../content';
import { StatusBadge } from '../status-badge';

const SHOW_DRAFTS_KEY = 'scholia.showDrafts';

/** Every course, grouped by opening: playing it and facing it side by side. */
@Component({
  selector: 'app-home-page',
  template: `
    @if (index.error()) {
      <p class="error">Couldn't load the course list. Run <code>pnpm lessons</code> to compile it.</p>
    } @else if (index.value()) {
      <header>
        <h1>Courses</h1>
        <label class="meta">
          <input type="checkbox" [checked]="showDrafts()" (change)="setShowDrafts($any($event.target).checked)" />
          Show courses in progress
        </label>
      </header>
      @for (group of byOpening(); track group[0]) {
        <section>
          <h2>{{ group[0] }}</h2>
          <ul>
            @for (course of group[1]; track course.id) {
              <li>
                <a [routerLink]="['/course', course.id]">{{ course.title }}</a>
                <app-status-badge [status]="course.status" [review]="course.review" />
                <span class="meta">{{ label(course) }} · {{ course.lessons }} {{ course.lessons === 1 ? 'lesson' : 'lessons' }}</span>
              </li>
            }
          </ul>
        </section>
      } @empty {
        <p class="meta">No published courses yet. Tick "Show courses in progress" to see drafts.</p>
      }
    } @else {
      <p class="meta">Loading…</p>
    }
  `,
  styles: `
    header { display: flex; align-items: baseline; justify-content: space-between; flex-wrap: wrap; gap: 0.5rem; }
    h2 { font-size: 1.1rem; margin-bottom: 0.25rem; text-transform: capitalize; }
    ul { list-style: none; padding: 0; margin: 0; }
    li { margin: 0.4rem 0; display: flex; align-items: baseline; flex-wrap: wrap; gap: 0.5rem; }
    .meta { color: var(--muted); font-size: 0.85rem; }
    .error { color: var(--bad); }
  `,
  imports: [RouterLink, StatusBadge],
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class HomePage {
  protected readonly index = httpResource<CourseIndex>(indexUrl);

  /** Off: published courses only (the family view). Remembered per browser. */
  protected readonly showDrafts = signal<boolean>(readStoredToggle());

  protected readonly byOpening = computed(() => {
    const groups = new Map<string, CourseSummary[]>();
    for (const course of this.index.value()?.courses ?? []) {
      if (course.status !== 'published' && !this.showDrafts()) continue;
      groups.set(course.opening, [...(groups.get(course.opening) ?? []), course]);
    }
    return [...groups];
  });

  protected readonly label = (c: CourseSummary) => stanceLabel(c.stance, c.learner);

  constructor() {
    // With nothing published yet, an empty page helps nobody: show drafts
    // unless the viewer has chosen otherwise.
    effect(() => {
      const courses = this.index.value()?.courses;
      if (courses && readStored() === null && !courses.some((c) => c.status === 'published')) this.showDrafts.set(true);
    });
  }

  protected setShowDrafts(show: boolean): void {
    this.showDrafts.set(show);
    try {
      localStorage.setItem(SHOW_DRAFTS_KEY, String(show));
    } catch {
      // Storage unavailable (private mode): the toggle still works for this visit.
    }
  }
}

function readStored(): string | null {
  try {
    return localStorage.getItem(SHOW_DRAFTS_KEY);
  } catch {
    return null;
  }
}

const readStoredToggle = () => readStored() === 'true';
