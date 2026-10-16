// Tu harness: el proceso de desarrollo, escrito en código.
//   node harness.mjs [feature]                 con Pi real (sin feature: la siguiente lista)
//   node harness.mjs [feature] --ensayo        con el Pi de ensayo: segundos y sin gastar modelo
//   node harness.mjs [feature] --trampa <rol>  el Pi de ensayo hace trampa en ese rol: ¿qué regla lo para?
//   node harness.mjs [feature] --hasta <rol>   para después de ese rol (por ejemplo, solo el planner)
import { fileURLToPath } from 'node:url';
import { commit, foto, tocadosDesde } from './git.mjs';
import { ensayo, lanzarRol } from './pi.mjs';
import { estadoDe, features, marcarAceptada, siguienteLista, start } from './proyecto.mjs';

// 1 · El flujo: quién va después lo decide esta tabla, no una skill.
export const siguiente = {
  planner: () => 'implementer',
  implementer: () => 'validator',
  validator: (resultado) => (resultado.verdict === 'accept' ? 'commit' : 'implementer'),
};

// 2 · Las reglas: lo que en el módulo 4 era una frase en una skill. El host las comprueba después de cada rol.
export const reglas = {
  planner: [
    ['solo toca su spec', (c) => c.tocados.every((archivo) => archivo === c.spec)],
  ],
  implementer: [
    ['no cambia la spec', (c) => !c.tocados.includes(c.spec)],
    ['deja la feature en passing', (c) => c.estado === 'passing'],
  ],
  validator: [
    ['no modifica nada', (c) => c.tocados.length === 0],
  ],
  todos: [
    ['declara todo lo que cambia', (c) => c.tocados.every((archivo) => c.resultado.files.includes(archivo))],
  ],
};

const maxPasos = 7; // el planner y tres rondas de implementer y validator; si no basta, decide una persona

// 3 · El bucle: lanzar el rol, comprobar sus reglas y pasar al siguiente.
export async function completar(proyecto, feature) {
  const spec = `docs/specs/${feature.id}.md`;
  const tocadosPorLosRoles = new Set();
  let rol = 'planner';
  let resultado = null;
  let pasos = 0;
  while (rol !== 'commit' && rol !== 'parar') {
    if (++pasos > maxPasos) throw new Error(`${maxPasos} pasos sin terminar: decide una persona`);
    const antes = foto(proyecto);
    resultado = await lanzarRol(proyecto, rol, feature, resultado);
    const tocados = tocadosDesde(proyecto, antes);
    const c = { tocados, resultado, spec, estado: estadoDe(proyecto, feature.id) };
    const aplicables = [...(reglas[rol] ?? []), ...reglas.todos];
    for (const [regla, cumple] of aplicables) {
      if (!cumple(c)) throw new Error(`${rol}: ${regla} (ha tocado: ${tocados.join(', ') || 'nada'})`);
    }
    console.log(`  ✓ ${aplicables.map(([regla]) => regla).join(' · ')}`);
    if (resultado.outcome === 'block' || resultado.verdict === 'block') throw new Error(`${rol} bloquea: ${resultado.summary}`);
    tocados.forEach((archivo) => tocadosPorLosRoles.add(archivo));
    rol = await siguiente[rol](resultado);
  }
  if (rol === 'parar') return null;
  marcarAceptada(proyecto, feature.id, resultado.summary); // la aceptación la escribe el host, nunca un rol
  return commit(proyecto, [...tocadosPorLosRoles, 'feature_list.json'], `feat: complete ${feature.id}`); // solo lo de esta feature
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const { copy, args } = start();
  const valor = (flag) => (args.includes(flag) ? args[args.indexOf(flag) + 1] : undefined);
  const trampa = valor('--trampa');
  const hasta = valor('--hasta');
  if (args.includes('--ensayo') || trampa) ensayo({ trampa });
  if (hasta) siguiente[hasta] = () => 'parar'; // cambiar el proceso es cambiar la tabla
  const id = args.find((arg) => !arg.startsWith('--') && arg !== trampa && arg !== hasta);
  const feature = id ? features(copy).find((item) => item.id === id) : siguienteLista(copy);
  if (!feature) { console.error(id ? `No existe la feature ${id}` : 'No quedan features listas'); process.exit(1); }
  try {
    const hash = await completar(copy, feature);
    console.log(hash ? `\n✔ ${feature.id} aceptada · commit ${hash}\nCompruébalo: git -C ${copy} show --stat HEAD` : `\n■ El flujo ha parado antes del commit. Lo hecho está en ${copy}`);
  } catch (error) {
    console.log(`\n✕ ${error.message}\nEl host para aquí: no hay commit. Lo hecho está en ${copy}`);
    process.exitCode = 1;
  }
}
