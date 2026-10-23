// Compiled content written by `pnpm lessons` into public/content. Later these
// come from the API in the same shape.
export const indexUrl = () => 'content/index.json';
export const courseUrl = (courseId: string) => `content/courses/${courseId}.json`;
export const lessonUrl = (courseId: string, lessonId: string) => `content/lessons/${courseId}/${lessonId}.json`;

/** "Playing it" or "Facing it", with the learner's side. */
export const stanceLabel = (stance: 'wield' | 'face', learner: 'white' | 'black') =>
  `${stance === 'wield' ? 'Playing it' : 'Facing it'} · as ${learner === 'white' ? 'White' : 'Black'}`;
