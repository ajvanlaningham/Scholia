// Compiled course and lesson files, written by `pnpm spike:lessons` into
// public/content. Later these come from the API in the same shape.
export const courseUrl = (id: string) => `content/courses/${id}.json`;
export const lessonUrl = (id: string) => `content/lessons/${id}.json`;
