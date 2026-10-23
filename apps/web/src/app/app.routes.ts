import type { Routes } from '@angular/router';
import { CoursePage } from './course/course-page';
import { HomePage } from './home/home-page';
import { LessonPlayer } from './lesson/lesson-player';

export const routes: Routes = [
  { path: '', component: HomePage, title: 'Scholia' },
  { path: 'course/:courseId', component: CoursePage, title: 'Scholia · Course' },
  { path: 'course/:courseId/lesson/:lessonId', component: LessonPlayer, title: 'Scholia · Lesson' },
  { path: '**', redirectTo: '' },
];
