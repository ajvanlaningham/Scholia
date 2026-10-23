import { httpResource } from '@angular/common/http';
import { ChangeDetectionStrategy, Component, computed, input } from '@angular/core';
import { RouterLink } from '@angular/router';
import type { CompiledCourse, CourseLesson } from '@scholia/lesson-format';
import { Board } from '../board/board';
import { courseUrl } from '../content';
import { ScholiumView } from '../lesson/scholium-view';
import { StatusBadge } from '../status-badge';

/** A course's title page and table of contents. */
@Component({
  selector: 'app-course-page',
  templateUrl: './course-page.html',
  styleUrl: './course-page.scss',
  imports: [RouterLink, Board, ScholiumView, StatusBadge],
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class CoursePage {
  /** Route parameter. */
  readonly courseId = input.required<string>();

  protected readonly course = httpResource<CompiledCourse>(() => courseUrl(this.courseId()));

  /** Each lesson with how many lessons deep it continues from the course's first lessons. */
  protected readonly entries = computed(() => {
    const course = this.course.value();
    if (!course) return [];
    const byId = new Map(course.lessons.map((l) => [l.id, l]));
    const depth = (lesson: CourseLesson, seen = new Set<string>()): number => {
      const parent = lesson.continues && byId.get(lesson.continues.lesson);
      if (!parent || seen.has(parent.id)) return 0;
      return 1 + depth(parent, seen.add(lesson.id));
    };
    return course.lessons.map((lesson, i) => ({
      lesson,
      number: i + 1,
      depth: depth(lesson),
      parentTitle: lesson.continues ? byId.get(lesson.continues.lesson)?.title : undefined,
    }));
  });

  protected readonly side = computed(() => (this.course.value()?.learner === 'white' ? 'White' : 'Black'));

  /** "1. e4 e5 2. Nf3" → "1.e4 e5 2.Nf3" */
  protected readonly compact = (line: string) => line.replace(/(\d+)\. /g, '$1.');

  protected readonly statusPhrase = (status: string) =>
    ({
      backlog: 'on the backlog',
      researching: 'still being researched',
      ready: 'ready to be written',
      drafting: 'being drafted',
      review: 'in review',
      published: 'published',
    })[status] ?? status;

  /** "4 lines · 4 traps" */
  protected readonly counts = (l: CourseLesson) =>
    [l.lines && `${l.lines} ${l.lines === 1 ? 'line' : 'lines'}`, l.traps && `${l.traps} ${l.traps === 1 ? 'trap' : 'traps'}`]
      .filter(Boolean)
      .join(' · ');
}
