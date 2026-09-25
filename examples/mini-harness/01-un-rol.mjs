// Paso 1 · Lanzar un rol del proyecto con Pi y leer su resultado estructurado.
// node 01-un-rol.mjs <proyecto> <feature-id> [planner|implementer|validator]
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { loadRole, logEvent, rolePrompt, runRole } from './pi.mjs';

const [project, id, roleName = 'planner'] = process.argv.slice(2);
const feature = JSON.parse(readFileSync(join(project, 'feature_list.json'), 'utf8')).find((item) => item.id === id);
const role = loadRole(project, roleName);

console.log(`▶ ${roleName} · $${role.skill} · ${feature.id}`);
const { result } = await runRole({ cwd: project, role, prompt: rolePrompt(feature, roleName), onEvent: logEvent(roleName) });
console.log(result);
