# AI Expert Harness

Capa visual del `feature-flow` de AI Expert. Abre un proyecto, selecciona las features que faltan y sigue el trabajo real de planner → implementer → validator. Sin demo mezclada con ejecuciones reales.

## Arranque

Node 22 o superior y Pi instalado. No necesita dependencias npm.

```sh
~/.local/bin/oprun pnpm dev
# http://localhost:4173
```

`oprun` proporciona las credenciales al servidor y sus procesos Pi. La aplicación no lee ni guarda claves. Ver Pi instalado no implica tener crédito o autenticación válida: los errores del proveedor se muestran en la feature afectada.

## Uso

1. **Abrir proyecto…**: selecciona su raíz Git con el selector nativo de macOS. Verás el nombre, la ruta y las features cargadas.
2. Marca las features pendientes. Al marcar una se añaden sus dependencias pendientes; al desmarcarla se quitan las que dependían de ella. No se ejecutan features no seleccionadas.
3. **Ejecutar selección** muestra el orden de ejecución y confirma las modificaciones y commits locales. La cola respeta dependencias y WIP=1.
4. Abre una tarjeta (panel lateral; `Esc` lo cierra y la URL `#<id>` enlaza a ella) para ver el rol, skill, actividad de Pi, evidencia, correcciones, archivos y cómo probarlo.
5. El validator puede aceptar, pedir correcciones o bloquear. Las correcciones vuelven al implementer y se validan otra vez (máximo tres reparaciones por intento).
6. La aceptación independiente se guarda como `accepted` y genera un commit local. La tarjeta queda en **Revisión humana**. No hay push, deploy, creación de PR ni merge automático.
7. **Aprobar revisión** la marca como terminada. **Pedir cambios** conserva el commit y lanza otra vuelta implementer → validator con tu feedback, que acaba en un commit `fix: address review of <id>`.

Una dependencia solo cuenta cuando está `accepted` **y** has aprobado su revisión humana: nada se construye sobre un commit que no has revisado. Mientras tanto la cola espera sin bloquearse.

**Pausar cola** deja terminar la feature actual. **Detener ejecución** interrumpe el rol y pausa la cola. **Continuar desde este paso** conserva la baseline y los resultados anteriores. **Quitar de la cola** no borra ni revierte archivos.

## Fuente de verdad

El repositorio debe incluir:

```text
feature_list.json
AGENTS.md
.codex/config.toml
.codex/agents/{planner,implementer,validator}.toml
.agents/skills/{feature-flow,feature-spec,feature-implementer,feature-validator}/SKILL.md
```

Se leen los `config_file` declarados en `.codex/config.toml`, las instrucciones completas del rol, su modelo, su esfuerzo y la skill correspondiente. Las referencias de las skills permanecen accesibles al agente y se incluyen en la huella de configuración. No se modifica ni copia configuración dentro del proyecto abierto.

El adaptador admite la estructura TOML de AI Expert: secciones `[agents.<rol>]`, strings simples y `developer_instructions` multiline. Rechaza configuraciones incompatibles en vez de inventar un rol. Cada rol usa una sesión Pi nueva, sin extensiones ni contexto global descubierto; recibe explícitamente las instrucciones y la skill del proyecto y la extensión de proveedor de este harness. Pi **no reproduce el sandbox de Codex**: ejecuta con los permisos del usuario. Usa solo repositorios de confianza y no edites en paralelo los archivos de la feature activa.

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
- Se conserva el trabajo previo ajeno. Si el inventario o `PROGRESS.md` ya tienen cambios, hay archivos staged, cambia HEAD/rama o el diff no se puede aislar, se bloquea el commit. No hay reset ni rollback automático.
- Si falla un hook o la firma de commit, los archivos quedan disponibles para inspección; no se desactiva ese control automáticamente. Resuelve el problema antes de continuar.
- El servidor solo comprueba si `DEVEXPERT_API_KEY` está presente en su entorno (nunca lee su valor) y avisa en la UI si falta.
- La UI vive en `public/` (módulos ES sin build). El estado se consulta cada 1,2 s con ETag; la vista solo se redibuja por regiones cuando algo cambia.
- El servidor escucha solo en loopback. Rechaza mutaciones desde otros orígenes. No expongas este servidor a Internet.

## Verificación

```sh
pnpm check          # Fixtures Git desechables, sin proveedor ni producto real
pnpm check:pi       # Protocolo RPC local, sin inferencia

# Opt-in: consume una ejecución real. Copia skills/roles, no modifica el origen.
HARNESS_SOURCE_PROJECT=/ruta/al/proyecto ~/.local/bin/oprun pnpm check:pi:e2e
```

Las pruebas cubren roles reales del adaptador, ciclo de reparación, revisión humana (aprobar y pedir cambios), aceptación/commit, recuperación de escrituras interrumpidas, preservación de WIP, cola/dependencias, cancelación, persistencia, errores de proveedor, API HTTP y el modelo de vista de la UI. La prueba real usa una feature mínima en un repositorio temporal y conserva su ruta para inspección.
