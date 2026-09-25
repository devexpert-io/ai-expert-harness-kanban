// Paso 2 · El loop: quién va después lo decide este código, no un LLM leyendo una skill.
// node 02-el-loop.mjs <proyecto> <feature-id>
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { loadRole, logEvent, rolePrompt, runRole } from './pi.mjs';

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
    if (role === 'planner') role = 'implementer';
    else if (role === 'implementer') role = 'validator';
    else if (result.verdict === 'revise') {
      if (++repairs > maxRepairs) throw new Error(`Límite de ${maxRepairs} reparaciones`);
      repairBrief = result.repairBrief;
      role = 'implementer';
    } else return result; // accept: una verificación independiente decide que está hecho
  }
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const [project, id] = process.argv.slice(2);
  const feature = JSON.parse(readFileSync(join(project, 'feature_list.json'), 'utf8')).find((item) => item.id === id);
  const accepted = await featureLoop(project, feature, { onStep: (role) => console.log(`▶ ${role}`) });
  console.log('✔ aceptada por el validator:', accepted.summary);
}
