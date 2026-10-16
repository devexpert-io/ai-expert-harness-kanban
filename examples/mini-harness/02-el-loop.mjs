// Paso 2 · El loop: quién va después lo decide este código, no un LLM leyendo una skill.
// node 02-el-loop.mjs [feature-id]   (por defecto: la siguiente lista)
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { loadRole, logEvent, rolePrompt, runRole } from './pi.mjs';

const next = { planner: 'implementer', implementer: 'validator' };

// `wrap` permite al paso 4 rodear cada rol con comprobaciones del host sin cambiar el loop.
export async function featureLoop(project, feature, { maxRepairs = 3, onStep = () => {}, wrap = (role, execute) => execute() } = {}) {
  let role = 'planner';
  let repairBrief = '';
  let repairs = 0;
  while (true) {
    onStep(role);
    const extra = repairBrief ? `El validator pide estas correcciones:\n${repairBrief}` : '';
    const execute = () => runRole({ cwd: project, role: loadRole(project, role), prompt: rolePrompt(feature, role, extra), onEvent: logEvent(`${feature.id} · ${role}`) }).then(({ result }) => result);
    const result = await wrap(role, execute);
    console.log(`  ${feature.id} · ${role} → ${result.verdict ?? result.outcome}: ${result.summary}`);
    if (result.outcome === 'block' || result.verdict === 'block') throw new Error(`${role} bloquea: ${result.summary}`);
    if (next[role]) { role = next[role]; continue; }
    if (result.verdict === 'accept') return result; // una verificación independiente decide que está hecho
    if (++repairs > maxRepairs) throw new Error(`Límite de ${maxRepairs} reparaciones`); // revise
    repairBrief = result.repairBrief;
    role = 'implementer';
  }
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const { start } = await import('./proyecto.mjs');
  const { readyFeatures } = await import('./03-la-cola.mjs');
  const { copy, args: [id] } = start();
  const list = JSON.parse(readFileSync(join(copy, 'feature_list.json'), 'utf8'));
  const feature = id ? list.find((item) => item.id === id) : readyFeatures(list)[0];
  if (!feature) throw new Error(id ? `No existe la feature ${id}` : 'No quedan features listas');
  const accepted = await featureLoop(copy, feature, { onStep: (role) => console.log(`▶ ${role}`) });
  console.log('✔ aceptada por el validator:', accepted.summary);
}
