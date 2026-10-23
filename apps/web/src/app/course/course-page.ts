import { httpResource } from '@angular/common/http';
import { ChangeDetectionStrategy, Component, input } from '@angular/core';
import { RouterLink } from '@angular/router';
import type { CompiledCourse } from '@scholia/lesson-format';
import { courseUrl, stanceLabel } from '../content';

@Component({
  selector: 'app-course-page',
  template: `
    @if (course.error()) {
      <p class="error">Couldn't load course "{{ courseId() }}". Run <code>pnpm lessons</code> to compile it.</p>
    } @else if (course.value(); as c) {
      <a routerLink="/">← Courses</a>
      <h1>{{ c.title }}</h1>
      <p class="meta stance">{{ label(c.stance, c.learner) }}</p>
      @if (c.lessons.length === 0) {
        <p class="meta stance">No lessons yet.</p>
      }
      <ol class="lessons">
        @for (lesson of c.lessons; track lesson.id) {
          <li [style.margin-left.rem]="depth(c, lesson.id) * 1.5">
            @if (lesson.continues) { <span class="meta">↳</span> }
            <a [routerLink]="['/course', c.id, 'lesson', lesson.id]">{{ lesson.title }}</a>
            <span class="meta">{{ lesson.sections }} sections · {{ lesson.status }}</span>
          </li>
        }
      </ol>
    } @else {
      <p class="meta">Loading…</p>
    }
  `,
  styles: `
    .lessons { list-style: none; padding-left: 0; }
    li { margin: 0.5rem 0; }
    .meta { margin-left: 0.75rem; color: var(--muted); font-size: 0.85rem; }
    .stance { margin-left: 0; }
    .error { color: var(--bad); }
  `,
  imports: [RouterLink],
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class CoursePage {
  /** Route parameter. */
  readonly courseId = input.required<string>();

  protected readonly course = httpResource<CompiledCourse>(() => courseUrl(this.courseId()));
  protected readonly label = stanceLabel;

  /** How many lessons deep this one continues from the course's first lessons. */
  protected depth(course: CompiledCourse, id: string, seen = new Set<string>()): number {
    const parent = course.lessons.find((l) => l.id === id)?.continues?.lesson;
    if (!parent || seen.has(parent)) return 0;
    return 1 + this.depth(course, parent, seen.add(id));
  }
}
