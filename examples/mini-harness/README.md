# Mini-harness

Tu proceso de desarrollo, escrito en código. El Kanban de este repositorio, reducido a un archivo que se lee de arriba abajo: [`harness.mjs`](harness.mjs).

| Bloque | Qué es | Qué enseña |
|---|---|---|
| 1 · `siguiente` | Una tabla: después de cada rol, quién va. | Los pasos de un agente a otro los da software determinista, no lo que dice una skill. |
| 2 · `reglas` | Otra tabla: lo que cada rol no puede hacer, comprobado con Git después de cada paso. | Lo que en el módulo 4 era una frase en una skill aquí es un `if`. El rol puede decir que ha terminado bien; si incumple una regla, el host no avanza. |
| 3 · `completar` | El bucle: lanzar el rol, comprobar sus reglas y pasar al siguiente. Al final, el host marca `accepted` y hace un commit solo con lo que tocaron los roles. | El LLM solo hace el trabajo de cada rol. Todo lo demás lo decide tu código. |

Lo demás son piezas que no hace falta leer para cambiar el proceso: `pi.mjs` lanza un rol con Pi, `git.mjs` mira qué ha cambiado, `proyecto.mjs` resuelve tu proyecto y su copia, y `persona.mjs` pregunta a una persona.

## Preparación

Enlaza una vez tu fork de la tienda desde esta carpeta. Cada ejecución trabaja en una copia desechable, así que tu fork no se toca:

```bash
ln -s /ruta/a/tu/tienda-m6 tienda
```

Para otro proyecto con el mismo arnés: `--proyecto <ruta>`.

## Uso

```bash
node harness.mjs --ensayo                 # el flujo completo con el Pi de ensayo, en segundos
node harness.mjs --trampa validator       # el validator «arregla» código: ¿qué regla lo para?
node harness.mjs --trampa dependencia     # el implementer añade una librería que nadie ha pedido… y pasa
node harness.mjs cart-add --hasta planner # con Pi real, solo el planner (~2 min)
node harness.mjs cart-add                 # con Pi real, el flujo completo (10–18 min)
```

Las trampas usan el Pi de ensayo. Con `planner`, `implementer` y `validator`, ese rol hace justo lo que su regla le prohíbe y lo declara como si nada. Con `dependencia`, el implementer añade una dependencia a `package.json` que ninguna regla de serie para: la feature se acepta y la dependencia entra en el commit.

Con Pi real hace falta Pi instalado y la clave de DevExpert Inference: la del entorno (`DEVEXPERT_API_KEY`) o la que guardaste en el Kanban con «Recordarla».

## Para cambiar el proceso

- **Una regla nueva**: añade una línea a `reglas`. Para parar la trampa `dependencia`, que nadie toque `package.json`, en `todos`:
  `['no toca package.json', (c) => !c.tocados.includes('package.json')]`
- **Un paso humano**: que una persona apruebe la spec antes de implementar.
  ```js
  import { preguntar } from './persona.mjs';
  planner: async () => ((await preguntar('¿Apruebas la spec?')) ? 'implementer' : 'parar'),
  ```

## Otras piezas

| Archivo | Qué hace |
|---|---|
| `rpc-a-mano.sh` | Pi en modo RPC dentro de una copia de tu proyecto. Pegas una línea JSON y ves pasar herramientas, respuesta y `agent_settled`. |
| `permisos.mjs` | El motor respeta tu arnés: una extensión de Pi aplica los `permission` de `.opencode/agents/<rol>.md` antes de cada herramienta. Con `--sin-permisos` las reglas vuelven a ser texto. `--probar <rol> <herramienta> <ruta>` comprueba una regla sin modelo. |
| `fake-pi.mjs` | El Pi de ensayo: habla el mismo protocolo RPC y hace un trabajo mínimo por rol. También lo usa el Kanban con `pnpm dev:ensayo`. |

Lo que añade el Kanban (`../../harness`) sobre esto es producto: cola con dependencias, una rama y un worktree por feature, varias a la vez, estado persistente y recuperación tras un corte, PRs con revisión humana y una UI con la actividad de cada rol. Sus reglas son las mismas: [`harness/feature-flow.mjs`](../../harness/feature-flow.mjs).

Trabaja siempre sobre una copia o un fork. Pi ejecuta con tus permisos y no aplica el sandbox de Codex.
