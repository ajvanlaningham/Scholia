import { httpResource } from '@angular/common/http';
import { ChangeDetectionStrategy, Component, computed, effect, signal } from '@angular/core';
import { RouterLink } from '@angular/router';
import type { CourseIndex, CourseSummary } from '@scholia/lesson-format';
import { Board } from '../board/board';
import { indexUrl } from '../content';
import { StatusBadge } from '../status-badge';

const SHOW_DRAFTS_KEY = 'scholia.showDrafts';

/** One opening and its courses: playing it first, then facing it. */
interface Shelf {
  opening: string;
  title: string;
  rootFen: string;
  rootLine: string;
  courses: CourseSummary[];
}

/** The library: every opening, each with its courses side by side. */
@Component({
  selector: 'app-home-page',
  templateUrl: './home-page.html',
  styleUrl: './home-page.scss',
  imports: [RouterLink, Board, StatusBadge],
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class HomePage {
  protected readonly index = httpResource<CourseIndex>(indexUrl);

  /** Off: published courses only (the family view). Remembered per browser. */
  protected readonly showDrafts = signal<boolean>(readStored() === 'true');

  protected readonly shelves = computed<Shelf[]>(() => {
    const shelves = new Map<string, Shelf>();
    for (const course of this.index.value()?.courses ?? []) {
      if (course.status !== 'published' && !this.showDrafts()) continue;
      const shelf = shelves.get(course.opening) ?? {
        opening: course.opening,
        title: course.openingTitle,
        rootFen: course.rootFen,
        rootLine: course.rootLine,
        courses: [],
      };
      shelf.courses.push(course);
      shelves.set(course.opening, shelf);
    }
    for (const shelf of shelves.values()) {
      shelf.courses.sort((a, b) => Number(a.stance === 'face') - Number(b.stance === 'face'));
    }
    return [...shelves.values()];
  });

  /** Courses hidden by the published-only view, to say so rather than show an empty page. */
  protected readonly hiddenDrafts = computed(
    () => (this.index.value()?.courses ?? []).filter((c) => c.status !== 'published').length,
  );

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

  protected readonly side = (c: CourseSummary) => (c.learner === 'white' ? 'White' : 'Black');

  /** "1. e4 e5 2. Nf3" → "1.e4 e5 2.Nf3" */
  protected readonly compact = (line: string) => line.replace(/(\d+)\. /g, '$1.');

  /** "4 lessons · 12 lines · 5 traps" */
  protected readonly counts = (c: CourseSummary) =>
    [
      `${c.lessons} ${c.lessons === 1 ? 'lesson' : 'lessons'}`,
      c.lines && `${c.lines} ${c.lines === 1 ? 'line' : 'lines'}`,
      c.traps && `${c.traps} ${c.traps === 1 ? 'trap' : 'traps'}`,
    ]
      .filter(Boolean)
      .join(' · ');

  protected readonly reviewedPercent = (c: CourseSummary) =>
    c.review.total ? Math.round((100 * c.review.reviewed) / c.review.total) : 0;
}

function readStored(): string | null {
  try {
    return localStorage.getItem(SHOW_DRAFTS_KEY);
  } catch {
    return null;
  }
}
