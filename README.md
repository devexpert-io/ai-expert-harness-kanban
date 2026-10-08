# AI Expert Harness

Capa visual del `feature-flow` de AI Expert. Abre un proyecto, selecciona las features que faltan y sigue el trabajo real de planner → implementer → validator. Sin demo mezclada con ejecuciones reales.

## Arranque

Node 22 o superior, Git y Pi instalados. No necesita dependencias npm. Para revisar en GitHub, además `gh` autenticado.

```sh
pnpm dev
# http://localhost:4173
```

La API key de DevExpert Inference se configura desde la UI (**Configurar API key**): se comprueba contra `/v1/models`, vive en memoria y solo se guarda en disco (`.harness-data/credentials.json`, permisos 600) si marcas *Recordarla*. Nunca vuelve al navegador. También vale `DEVEXPERT_API_KEY` en el entorno, por ejemplo con `~/.local/bin/oprun pnpm dev`; la de la UI tiene prioridad.

Para ensayar sin inferencia: `pnpm dev:ensayo` usa `examples/mini-harness/fake-pi.mjs`, que habla el protocolo RPC de Pi y hace un trabajo mínimo por rol, con un estado separado en `.harness-data/ensayo/`. Revisa siempre en ramas locales (`HARNESS_REVIEW=local`): un ensayo nunca hace push ni abre PRs, aunque el proyecto tenga un remoto en GitHub.

La versión didáctica, en cinco pasos, está en [`examples/mini-harness`](examples/mini-harness/README.md).

## Uso

1. **Abrir proyecto…**: selecciona la raíz Git con el selector nativo de macOS. El harness detecta cómo se revisa: **GitHub** si `origin` está en GitHub y `gh` está autenticado; si no, **ramas locales**. `HARNESS_REVIEW=local|github` lo fuerza.
2. Marca las features pendientes. Al marcar una se añaden sus dependencias; al desmarcarla se quitan las que dependían de ella.
3. **Ejecutar selección** muestra el orden y lanza la cola. Las features cuyas dependencias ya están integradas avanzan **en paralelo** (`HARNESS_PARALLEL`, 3 por defecto).
4. Cada feature trabaja en su propia rama `feat/<id>` y su propio worktree, creados desde la base actual (`origin/<base>` recién descargada en GitHub). Tu checkout no se toca. Se copian `.env`, `.env.local` y `.env.test` si existen; dependencias y puertos siguen siendo cosa del proyecto.
5. Abre una tarjeta (panel lateral; `Esc` lo cierra y `#<id>` enlaza a ella) para ver rol, skill, actividad de Pi, evidencia, correcciones, archivos y cómo probarlo.
6. El validator puede aceptar, pedir correcciones o bloquear. Las correcciones vuelven al implementer y se validan otra vez (máximo tres por intento).
7. Tras la aceptación independiente, el host hace el commit en la rama y la publica para **revisión humana**: en GitHub hace push y abre una PR con resumen, evidencia y cómo probarlo; en local la rama queda lista para integrar.
8. **Mergear PR** (squash con `gh`) o **Integrar en <base>** (merge `--no-ff` en tu checkout, que debe estar limpio y en la base) completa la feature. También puedes mergear en GitHub: el tablero consulta las PR cada 20 s (o con **Comprobar PRs**).
9. **Pedir cambios** conserva la rama y la PR y lanza otra vuelta implementer → validator con tu feedback. Acaba en un commit `fix: address review of <id>` en la misma PR, con tu feedback como comentario.

Una dependencia solo cuenta cuando está **integrada** en la base: nada se construye sobre un cambio que no has revisado. Mientras tanto sus dependientes esperan en cola.

Al integrar una feature, las demás ramas en revisión se actualizan con la base. Los conflictos de estado en `feature_list.json` (fusión por id) y `PROGRESS.md` (unión) se resuelven solos; cualquier otro conflicto se marca en la tarjeta para que lo resuelvas en la rama.

**Pausar cola** deja terminar lo que está en marcha. **Detener ejecución** interrumpe ese rol; el resto sigue. **Continuar desde este paso** conserva baseline y resultados. **Quitar de la cola** conserva rama y worktree para que los revises.

## Fuente de verdad

El repositorio debe incluir:

```text
feature_list.json
AGENTS.md
.agents/skills/{feature-flow,feature-spec,feature-implementer,feature-validator}/SKILL.md
# y los subagentes, en uno de estos dos formatos:
.opencode/agents/{planner,implementer,validator}.md      # OpenCode (la tienda del curso)
.codex/config.toml + .codex/agents/<rol>.toml            # Codex
```

Si existe `.opencode/agents/`, se usa OpenCode: de cada `<rol>.md` se toman las instrucciones (el cuerpo tras el frontmatter) y se comprueba que es `mode: subagent` y que usa la skill de su rol (`$feature-spec`, etc.). Los `permission` de OpenCode no se aplican en Pi; el host comprueba los límites de cada rol por su cuenta. Si no, se leen los `config_file` de `.codex/config.toml` con instrucciones, modelo y esfuerzo. Las referencias de las skills permanecen accesibles al agente y se incluyen en la huella de configuración. No se modifica ni copia configuración dentro del proyecto abierto.

El adaptador rechaza configuraciones incompatibles en vez de inventar un rol. Cada rol usa una sesión Pi nueva, sin extensiones ni contexto global descubierto; recibe explícitamente las instrucciones y la skill del proyecto y la extensión de proveedor de este harness. Pi **no reproduce el sandbox de Codex ni los permisos de OpenCode**: ejecuta con los permisos del usuario. Usa solo repositorios de confianza y no edites en paralelo los archivos de la feature activa.

El modelo de ejecución está fijado explícitamente en **DevExpert Inference → `chat`** para los tres roles (`harness/pi-config.mjs`). Se conservan sus instrucciones, skills y esfuerzo de razonamiento, sin modificar la configuración del proyecto objetivo. La UI muestra el modelo efectivo. Ni `PI_MODEL`, ni `PI_PROVIDER`, ni las credenciales presentes en el entorno cambian esa selección; no hay fallback a OpenAI u otro modelo.

La extensión local `harness/devexpert-provider.mjs` registra el alias `chat` de `https://inference.devexpert.io/v1` y usa `$DEVEXPERT_API_KEY` proporcionada por `oprun`. No escribe configuración global de Pi ni almacena claves. Su metadata no estima costes del servicio. `PI_BIN` y `PI_TIMEOUT_MS` (30 minutos por rol por defecto) siguen disponibles.

### Contrato único

`feature_list.json` es una lista JSON directa con exactamente estos nueve campos:

```json
[
  {
    "id": "catalog-search",
    "area": "catalog",
    "title": "Buscar productos",
    "user_visible_behavior": "La persona encuentra productos por texto.",
    "depends_on": [],
    "status": "not_started",
    "verification": ["Una búsqueda devuelve las coincidencias esperadas."],
    "evidence": [],
    "notes": "Pendiente de planificación."
  }
]
```

No se aceptan contenedores, alias de campos, IDs que no sean seguros para archivos, dependencias inexistentes ni ciclos. El ciclo ejecutable usa `not_started` → `in_progress` → `passing` → `accepted`, y `blocked` para bloqueos. Las etiquetas históricas `planned`, `planning`, `implementing`, `validating`, `review` y `done` pueden visualizarse, pero solo `accepted` satisface una dependencia de ejecución.

El antiguo `.harness/config.json` es opcional y solo se valida si existe; no selecciona un motor simulado ni puede desactivar la revisión humana. `examples/sample-project` muestra el contrato, no es un proyecto ejecutable con roles.

## Persistencia y límites

- Estado, cola, roles, evidencia y aceptación se guardan atómicamente en `.harness-data/state.json`, fuera del repositorio objetivo. `HARNESS_STATE_PATH` permite otra ubicación. No borres ese estado durante una ejecución.
- Al reiniciar, las ejecuciones activas pasan a interrumpidas y la cola queda pausada. Pi se detiene si desaparece su proceso servidor. No se continúa trabajo sin acción explícita.
- Una especificación existente sin prueba de actualidad se revisa con planner. Una feature `passing` con spec pasa a validación independiente.
- Los worktrees viven en `.harness-data/worktrees/`. Se borran (sin forzar) al integrar o cerrar la revisión; ramas y PR se conservan. Si en un worktree hay archivos staged, cambia HEAD/rama o el diff no se puede aislar, se bloquea el commit. No hay reset ni rollback automático.
- Si falla un hook o la firma de commit, los archivos quedan disponibles para inspección; no se desactiva ese control automáticamente. Resuelve el problema antes de continuar.
- La UI vive en `public/` (módulos ES sin build). El estado se consulta cada 1,2 s con ETag; la vista solo se redibuja por regiones cuando algo cambia.
- El servidor escucha solo en loopback. Rechaza mutaciones desde otros orígenes. No expongas este servidor a Internet.

## Verificación

```sh
pnpm check          # Fixtures Git desechables, sin proveedor, sin red y sin GitHub real
pnpm check:pi       # Protocolo RPC local, sin inferencia

# Opt-in: consume una ejecución real. Copia skills/roles, no modifica el origen.
HARNESS_SOURCE_PROJECT=/ruta/al/proyecto ~/.local/bin/oprun pnpm check:pi:e2e
```

Las pruebas cubren roles reales del adaptador, ciclo de reparación, paralelo con worktrees, revisión humana (integrar, sincronizar ramas y pedir cambios), adaptador de GitHub con gh simulado, API key, aceptación/commit, recuperación de escrituras interrumpidas, preservación de WIP, cola/dependencias, cancelación, persistencia, errores de proveedor, API HTTP y el modelo de vista de la UI. La prueba real usa una feature mínima en un repositorio temporal y conserva su ruta para inspección.
