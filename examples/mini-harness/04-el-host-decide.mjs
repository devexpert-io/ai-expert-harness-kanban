// Paso 4 · El host comprueba en vez de creerse lo que dice cada rol.
// node 04-el-host-decide.mjs [--todas]   (por defecto, solo la siguiente feature lista)
import { featureLoop } from './02-el-loop.mjs';
import { committed, git, markAccepted, plantPrivateNotes, readFeatures, readyFeatures } from './03-la-cola.mjs';
import { start } from './proyecto.mjs';

/** Archivos cambiados respecto a HEAD, con su contenido, para saber qué ha tocado de verdad cada rol. */
function snapshot(cwd) {
  const paths = git(cwd, 'status', '--porcelain', '--untracked-files=all').split('\n').filter(Boolean).map((line) => line.slice(3));
  const hash = (path) => { try { return git(cwd, 'hash-object', '--', path); } catch { return 'deleted'; } };
  return new Map(paths.map((path) => [path, hash(path)]));
}
const touchedBetween = (before, after) => [...new Set([...before.keys(), ...after.keys()])].filter((path) => before.get(path) !== after.get(path));

export async function completeFeature(cwd, feature, { onStep = () => {} } = {}) {
  const owned = new Set();
  const guard = async (role, execute) => {
    const before = snapshot(cwd);
    const result = await execute();
    const touched = touchedBetween(before, snapshot(cwd));
    if (role === 'validator' && touched.length) throw new Error(`El validator modificó ${touched.join(', ')}: no se acepta`);
    if (role === 'planner' && touched.some((path) => path !== `docs/specs/${feature.id}.md`)) throw new Error('El planner tocó algo más que su spec');
    const undeclared = touched.filter((path) => !result.files.includes(path));
    if (undeclared.length) throw new Error(`${role} no declaró ${undeclared.join(', ')}`);
    if (role === 'implementer' && readFeatures(cwd).find((item) => item.id === feature.id).status !== 'passing') throw new Error('El implementer dice passing pero feature_list.json no');
    touched.forEach((path) => owned.add(path));
    return result;
  };
  const accepted = await featureLoop(cwd, feature, { onStep, wrap: guard });
  markAccepted(cwd, feature.id, accepted.summary);
  // Solo lo que hicieron los roles de esta feature, más la aceptación. Nada ajeno entra en el commit.
  git(cwd, 'add', '--', ...owned, 'feature_list.json');
  git(cwd, 'commit', '-m', `feat: complete ${feature.id}`);
  return { ...accepted, commit: git(cwd, 'rev-parse', '--short', 'HEAD') };
}

if (process.argv[1]?.endsWith('04-el-host-decide.mjs')) {
  const { copy: project, args } = start();
  plantPrivateNotes(project);
  let next;
  while ((next = readyFeatures(readFeatures(project))[0])) {
    console.log(`\n■ ${next.id} · ${next.title}`);
    const { commit } = await completeFeature(project, next, { onStep: (role) => console.log(`▶ ${role}`) });
    console.log(`✔ ${next.id} aceptada · commit ${commit}`);
    console.log(committed(project, 'notas-privadas.txt') ? '⚠ notas-privadas.txt se ha colado en el commit' : '✓ notas-privadas.txt se ha quedado fuera del commit');
    if (!args.includes('--todas')) break;
  }
  console.log(`\nCompruébalo: git -C ${project} status --short`);
}
