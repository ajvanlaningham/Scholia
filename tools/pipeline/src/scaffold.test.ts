import { describe, expect, it } from 'vitest';
import { newCourse, newLesson, newOpening } from './scaffold.ts';
import { validate } from './schema.ts';

const danish = newOpening('danish', 'Danish Gambit', '1. e4 e5 2. d4 exd4 3. c3');
const traxler = newOpening('traxler', 'Traxler Counterattack', '1. e4 e5 2. Nf3 Nc6 3. Bc4 Nf6 4. Ng5 Bc5');

describe('scaffold', () => {
  it("gives an opening to whoever played its root's last move", () => {
    expect(danish.side).toBe('white');
    expect(traxler.side).toBe('black');
    expect(newOpening('englund', 'Englund Gambit', '1. d4 e5').side).toBe('black');
    expect(newOpening('x', 'X', '1. d4 e5', 'white').side).toBe('white');
  });

  it('teaches the opening side when wielding and the other when facing', () => {
    const wield = newCourse(danish, 'wield');
    const face = newCourse(danish, 'face');
    expect([wield.id, wield.title, wield.learner]).toEqual(['danish-wield', 'Playing the Danish Gambit', 'white']);
    expect([face.id, face.title, face.learner]).toEqual(['danish-face', 'Facing the Danish Gambit', 'black']);
  });

  it('builds files that match their schemas', () => {
    const course = newCourse(traxler, 'wield');
    expect(validate('opening', traxler)).toEqual([]);
    expect(validate('course', course)).toEqual([]);
    expect(validate('lesson', newLesson(course, traxler, 'knight-sacrifice', traxler.root))).toEqual([]);
  });

  it('names a lesson from its id, with its course, learner and sources', () => {
    const course = newCourse(traxler, 'face');
    const lesson = newLesson(course, traxler, 'the-fork', `${traxler.root} 5. Nxf7`);
    expect(lesson).toMatchObject({ title: 'The fork', course: 'traxler-face', learner: 'white', sources: course.sources });
  });

  it('refuses illegal lines and lessons outside the opening', () => {
    expect(() => newOpening('x', 'X', '1. e4 e4')).toThrow(/isn't a legal line/);
    expect(() => newLesson(newCourse(danish, 'wield'), danish, 'x', '1. d4 d5')).toThrow(/doesn't pass through/);
  });
});

describe('validate', () => {
  const lesson = () => newLesson(newCourse(traxler, 'wield'), traxler, 'x', traxler.root) as unknown as Record<string, unknown>;

  it('asks for schemaVersion before anything else', () => {
    const { schemaVersion: _, ...unversioned } = traxler;
    expect(validate('opening', unversioned)).toEqual(['missing "schemaVersion" (this pipeline reads version 1)']);
    expect(validate('opening', { ...traxler, schemaVersion: 2 })[0]).toMatch(/is 2; this pipeline reads version 1/);
  });

  it('names misspelt properties and bad values', () => {
    const typo = { ...lesson(), sections: [{ id: 'main', title: 'Main', kind: 'line', line: '5. Nxf7', steps: [{ move: '5.Nxf7', accepts: ['Nxf7'] }] }] };
    expect(validate('lesson', typo)).toEqual([
      '/sections/0/kind: must be one of "main", "trap"',
      '/sections/0/steps/0: unknown property "accepts"',
    ]);
  });

  it('allows a $schema pointer and no text when there is nothing to cite', () => {
    const step = { move: '5.Nxf7', explanation: { text: null, status: 'drafted', cites: [] } };
    const withSection = { ...lesson(), $schema: '../lesson.schema.json', sections: [{ id: 'a', title: 'A', kind: 'main', line: '5. Nxf7', steps: [step] }] };
    expect(validate('lesson', withSection)).toEqual([]);
  });
});
