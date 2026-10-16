// Paso 1 · Lanzar un rol del proyecto con Pi y leer su resultado estructurado.
// node 01-un-rol.mjs [feature-id] [planner|implementer|validator]   (por defecto: la siguiente lista, planner)
import { loadRole, logEvent, rolePrompt, runRole } from './pi.mjs';
import { readFeatures, readyFeatures } from './03-la-cola.mjs';
import { start } from './proyecto.mjs';

const { copy, args: [id, roleName = 'planner'] } = start();
const list = readFeatures(copy);
const feature = id ? list.find((item) => item.id === id) : readyFeatures(list)[0];
if (!feature) throw new Error(id ? `No existe la feature ${id}` : 'No quedan features listas');
const role = loadRole(copy, roleName);

console.log(`▶ ${roleName} · $${role.skill} · ${feature.id}`);
const { result } = await runRole({ cwd: copy, role, prompt: rolePrompt(feature, roleName), onEvent: logEvent(roleName) });
console.log(result);
