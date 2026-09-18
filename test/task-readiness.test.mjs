import assert from 'node:assert/strict';
import test from 'node:test';
import { taskReadiness, unmetDependencies } from '../harness/task-readiness.mjs';

const tasks = [
  { id: 'base', state: 'done', dependsOn: [] },
  { id: 'middle', state: 'pending', dependsOn: ['base'] },
  { id: 'last', state: 'pending', dependsOn: ['middle'] }
];

test('una tarea queda lista cuando todas sus dependencias están terminadas', () => {
  assert.deepEqual(unmetDependencies(tasks[1], tasks), []);
  assert.equal(taskReadiness(tasks[1], tasks).ready, true);
});

test('impide ejecutar un slice con dependencias pendientes', () => {
  assert.deepEqual(unmetDependencies(tasks[2], tasks), ['middle']);
  assert.match(taskReadiness(tasks[2], tasks).reason, /middle/);
});

test('impide repetir tareas aceptadas o en revisión', () => {
  assert.equal(taskReadiness(tasks[0], tasks).ready, false);
  assert.equal(taskReadiness({ id: 'review', state: 'review' }, tasks).ready, false);
});
