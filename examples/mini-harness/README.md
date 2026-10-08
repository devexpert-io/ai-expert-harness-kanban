# Mini-harness

El Kanban de este repositorio, reducido a lo esencial en seis pasos cortos. Cada paso se ejecuta solo y añade una idea al anterior. En clase se leen, se ejecutan y se modifican: no hace falta escribirlos desde cero. Usa el mismo arnés que ya tiene el proyecto: `AGENTS.md`, `feature_list.json`, los subagentes (`.opencode/agents/*.md` en la tienda, o `.codex/agents/*.toml`) y `.agents/skills/*`.

| Paso | Archivo | Idea |
|---|---|---|
| 0 | `00-rpc-a-mano.sh` | Práctica 1: Pi en modo RPC dentro de tu fork, con los eventos de streaming ocultos. Pegas una línea JSON y ves pasar herramientas y respuesta. |
| 1 | `pi.mjs`, `01-un-rol.mjs` | Un agente es un proceso: JSON por stdin, eventos JSON por stdout. Lanzamos un rol con sus instrucciones y su skill, y leemos `<harness-result>`. |
| 2 | `02-el-loop.mjs` | Planner → implementer → validator. Quién va después lo decide el código; `revise` vuelve al implementer, con un límite. |
| 3 | `03-la-cola.mjs` | La siguiente feature sale de `feature_list.json` y sus dependencias. El host marca `accepted` y hace el commit… con `git add -A`, que mete cualquier cosa. |
| 4 | `04-el-host-decide.mjs` | El host comprueba en vez de creer: el validator no toca nada, el planner solo su spec, todo cambio está declarado, `passing` es real. El commit solo lleva lo de la feature. |
| 5 | `05-el-motor-respeta.mjs` | El motor respeta tu arnés: una extensión de Pi (`harness/opencode-permissions.mjs`) aplica los `permission` de `.opencode/agents/<rol>.md` antes de cada herramienta. Con `--sin-permisos` se ve la diferencia: las reglas vuelven a ser texto. |
| 6 | `06-paralelo-y-pr.mjs` | Las features listas avanzan a la vez, cada una en su rama y worktree desde la misma base. Con `--pr`, push y PR con evidencia: la revisión humana decide el merge. |

Lo que añade el Kanban (`../../harness`) sobre esto es producto: estado persistente y recuperación tras un corte, cancelación, espera a que integres una dependencia, sincronización de ramas, reparación tras revisión humana y una UI que muestra los mismos eventos.

## Ensayo sin inferencia

`fake-pi.mjs` habla el mismo protocolo RPC y hace un trabajo mínimo por rol. Sirve para ver el flujo sin gastar tokens, y también para el Kanban.

```bash
export PI_BIN="$PWD/fake-pi.mjs"
node 04-el-host-decide.mjs /ruta/a/una/copia/del/proyecto
```

## Con Pi real

Necesitas Pi instalado y `DEVEXPERT_API_KEY` en el entorno. El modelo es `chat` de DevExpert Inference, registrado por `../../harness/devexpert-provider.mjs`.

```bash
node 01-un-rol.mjs /ruta/al/proyecto cart-add planner
node 02-el-loop.mjs /ruta/al/proyecto cart-add
node 05-el-motor-respeta.mjs /ruta/al/proyecto
node 06-paralelo-y-pr.mjs /ruta/al/proyecto --pr
```

Trabaja siempre sobre una copia o un fork. Pi ejecuta con tus permisos y no aplica el sandbox de Codex.
