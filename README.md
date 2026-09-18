# AI Expert Harness Kanban

Kanban local para ejecutar slices independientes con un motor mock o con Pi, conservar evidencia estructurada y detener siempre el flujo en revisión humana.

## Ejecutar

No necesita instalar dependencias:

```bash
~/.local/bin/oprun pnpm dev
# http://localhost:4173
```

```bash
pnpm check
pnpm check:pi
~/.local/bin/oprun pnpm check:pi:e2e
```

## Motores

### Mock

Es el modo predeterminado. Usa eventos deterministas, no accede a ningún repositorio y mantiene la demo disponible aunque Pi o sus credenciales no estén configurados.

### Pi

El servidor integra la CLI instalada mediante su protocolo RPC JSONL (`pi --mode rpc --no-session`). Traduce `agent_start`, eventos de herramientas y `agent_settled` a estados, rol, skill, gate y evidencia visibles en el Kanban.

Pi aparece disponible cuando la CLI está instalada. La carpeta objetivo se debe seleccionar explícitamente con el diálogo nativo de macOS antes de ejecutar. Pi hereda su configuración y credenciales locales; opcionalmente admite `PI_BIN`, `PI_PROVIDER`, `PI_MODEL` y `PI_TIMEOUT_MS`. El servidor no almacena ni muestra secretos.

El servidor debe arrancarse mediante `oprun` para que Pi herede las credenciales de Agent Runtime. `check:pi` valida el protocolo local sin consumir una ejecución; `check:pi:e2e` realiza una ejecución real en una carpeta temporal, verifica el artefacto y la envía a la papelera.

Cada prompt impone límites explícitos: trabajar sólo en el proyecto seleccionado y no hacer merge, push, deploy, cambios de credenciales ni operaciones de producción. La aplicación no integra GitHub y nunca fusiona PRs automáticamente.

## Contrato de proyecto

La interfaz sólo inspecciona dos rutas convencionales dentro de la carpeta autorizada mediante el selector nativo:

- `feature_list.json` — obligatorio para cargar tareas.
- `.harness/config.json` — opcional para configuración del harness.

`feature_list.json`:

```json
[
  {
    "id": "APP-001",
    "area": "catalog",
    "title": "Añadir búsqueda",
    "user_visible_behavior": "La persona encuentra productos por texto.",
    "depends_on": ["APP-000"],
    "status": "not_started",
    "verification": ["La búsqueda devuelve coincidencias relevantes."],
    "evidence": [],
    "notes": "Slice preparado para implementación."
  }
]
```

Este es el único formato admitido: una lista JSON directa cuyos objetos contienen exactamente esos nueve campos. No se aceptan contenedores `{ "version": 1, "tasks": [...] }`, alias camelCase ni campos adicionales.

Estados válidos: `not_started`, `planned`, `planning`, `in_progress`, `implementing`, `passing`, `validating`, `review`, `accepted`, `done` y `blocked`. En estado `blocked`, `notes` describe la condición bloqueante.

`.harness/config.json`:

```json
{
  "version": 1,
  "defaultEngine": "mock",
  "reviewRequired": true,
  "autoMerge": false
}
```

Los archivos ausentes producen un estado explícito de “proyecto no preparado”; no se generan tareas ni valores ficticios. El proyecto seleccionado se conserva mientras el servidor siga activo y puede recargarse sin volver a autorizar la carpeta. El ejemplo comprobable está en `examples/sample-project/`.

## Límites actuales

- El estado vive en memoria y se pierde al reiniciar el servidor.
- El modo Pi ejecuta una sesión por tarea sobre la carpeta seleccionada; todavía no crea worktrees separados.
- Pausar/reanudar se mantiene para la oleada mock. Una sesión Pi activa no se presenta como pausable.
- GitHub, creación de PR y persistencia son fronteras separadas aún no conectadas.
