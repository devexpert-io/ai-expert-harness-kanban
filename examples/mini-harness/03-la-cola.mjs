// Paso 3 · La cola: el siguiente trabajo sale de feature_list.json y de sus dependencias.
// node 03-la-cola.mjs [--todas]   (por defecto, solo la siguiente feature lista)
import { execFileSync } from 'node:child_process';
import { readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { start } from './proyecto.mjs';

export const git = (cwd, ...args) => execFileSync('git', args, { cwd, encoding: 'utf8' }).trimEnd();
export const readFeatures = (project) => JSON.parse(readFileSync(join(project, 'feature_list.json'), 'utf8'));
export const writeFeatures = (project, list) => writeFileSync(join(project, 'feature_list.json'), `${JSON.stringify(list, null, 2)}\n`);

/** Lista para empezar: no aceptada, no bloqueada y con todas sus dependencias aceptadas. */
export function readyFeatures(list) {
  const accepted = new Set(list.filter((item) => item.status === 'accepted').map((item) => item.id));
  return list.filter((item) => !['accepted', 'blocked'].includes(item.status) && item.depends_on.every((id) => accepted.has(id)));
}

/** La aceptación la persiste el host, nunca un rol. */
export function markAccepted(project, id, summary) {
  const list = readFeatures(project);
  const feature = list.find((item) => item.id === id);
  feature.status = 'accepted';
  feature.evidence.push(`Independent validator accept: ${summary}`);
  writeFeatures(project, list);
}

/** Simula trabajo tuyo a medias en el proyecto: un archivo que nunca debería acabar en un commit de feature. */
export function plantPrivateNotes(project) {
  writeFileSync(join(project, 'notas-privadas.txt'), 'Trabajo tuyo sin commitear. No es de ninguna feature.\n');
  console.log('He dejado notas-privadas.txt sin commitear en la copia, como trabajo tuyo a medias.');
}
export const committed = (project, path) => git(project, 'show', '--name-only', '--format=', 'HEAD').split('\n').includes(path);

if (process.argv[1]?.endsWith('03-la-cola.mjs')) {
  // Import dinámico: 02-el-loop.mjs también usa esta cola, y uno estático en los dos sentidos se quedaría esperando.
  const { featureLoop } = await import('./02-el-loop.mjs');
  const { copy: project, args } = start();
  plantPrivateNotes(project);
  let next;
  while ((next = readyFeatures(readFeatures(project))[0])) {
    console.log(`\n■ ${next.id} · ${next.title}`);
    const accepted = await featureLoop(project, next, { onStep: (role) => console.log(`▶ ${role}`) });
    markAccepted(project, next.id, accepted.summary);
    git(project, 'add', '-A'); // ⚠ Ingenuo: mete en el commit todo lo que haya. El paso 4 lo arregla.
    git(project, 'commit', '-m', `feat: complete ${next.id}`);
    console.log(`✔ ${next.id} aceptada y commit ${git(project, 'rev-parse', '--short', 'HEAD')}`);
    if (committed(project, 'notas-privadas.txt')) console.log('⚠ notas-privadas.txt se ha colado en el commit de la feature');
    if (!args.includes('--todas')) break;
  }
  console.log(`\nCompruébalo: git -C ${project} show --stat HEAD`);
}
