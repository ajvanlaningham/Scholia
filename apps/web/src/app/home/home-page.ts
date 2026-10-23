import { httpResource } from '@angular/common/http';
import { ChangeDetectionStrategy, Component, computed } from '@angular/core';
import { RouterLink } from '@angular/router';
import type { CourseIndex, CourseSummary } from '@scholia/lesson-format';
import { indexUrl, stanceLabel } from '../content';

/** Every course, grouped by opening: playing it and facing it side by side. */
@Component({
  selector: 'app-home-page',
  template: `
    @if (index.error()) {
      <p class="error">Couldn't load the course list. Run <code>pnpm lessons</code> to compile it.</p>
    } @else if (index.value()) {
      <h1>Courses</h1>
      @for (group of byOpening(); track group[0]) {
        <section>
          <h2>{{ group[0] }}</h2>
          <ul>
            @for (course of group[1]; track course.id) {
              <li>
                <a [routerLink]="['/course', course.id]">{{ course.title }}</a>
                <span class="meta">{{ label(course) }} · {{ course.lessons }} {{ course.lessons === 1 ? 'lesson' : 'lessons' }}</span>
              </li>
            }
          </ul>
        </section>
      }
    } @else {
      <p class="meta">Loading…</p>
    }
  `,
  styles: `
    h2 { font-size: 1.1rem; margin-bottom: 0.25rem; text-transform: capitalize; }
    ul { list-style: none; padding: 0; margin: 0; }
    li { margin: 0.4rem 0; }
    .meta { margin-left: 0.75rem; color: var(--muted); font-size: 0.85rem; }
    .error { color: var(--bad); }
  `,
  imports: [RouterLink],
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class HomePage {
  protected readonly index = httpResource<CourseIndex>(indexUrl);
  protected readonly byOpening = computed(() => {
    const groups = new Map<string, CourseSummary[]>();
    for (const course of this.index.value()?.courses ?? []) {
      groups.set(course.opening, [...(groups.get(course.opening) ?? []), course]);
    }
    return [...groups];
  });
  protected readonly label = (c: CourseSummary) => stanceLabel(c.stance, c.learner);
}
