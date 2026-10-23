import { ChangeDetectionStrategy, Component, computed, input } from '@angular/core';
import type { ReviewProgress } from '@scholia/lesson-format';

/** "Published", or the work-in-progress status with how much has been reviewed. */
@Component({
  selector: 'app-status-badge',
  template: `<span class="badge" [class.published]="published()">{{ text() }}</span>`,
  styles: `
    .badge {
      font-size: 0.7rem;
      text-transform: uppercase;
      letter-spacing: 0.04em;
      padding: 0.1rem 0.4rem;
      border-radius: 4px;
      border: 1px solid var(--warn);
      color: var(--warn);
      white-space: nowrap;
    }
    .published { border-color: var(--good); color: var(--good); }
  `,
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class StatusBadge {
  /** A course status ("drafting", "published", …) or a lesson status ("drafted", "reviewed"). */
  readonly status = input.required<string>();
  readonly review = input<ReviewProgress>();

  protected readonly published = computed(() => this.status() === 'published' || this.status() === 'reviewed');
  protected readonly text = computed(() => {
    const review = this.review();
    const progress = !this.published() && review && review.total > 0 ? ` · ${review.reviewed}/${review.total} reviewed` : '';
    return `${this.status()}${progress}`;
  });
}
