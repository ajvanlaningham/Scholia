import type { Routes } from '@angular/router';
import { CoursePage } from './course/course-page';
import { LessonPlayer } from './lesson/lesson-player';

export const routes: Routes = [
  // Route-bound inputs are set to undefined when the route lacks the parameter,
  // so the home page redirects rather than relying on CoursePage's default id.
  { path: '', pathMatch: 'full', redirectTo: 'course/traxler' },
  { path: 'course/:id', component: CoursePage, title: 'Scholia' },
  { path: 'lesson/:id', component: LessonPlayer, title: 'Scholia · Lesson' },
  { path: '**', redirectTo: '' },
];
