# AI Expert Harness Kanban

Kanban local para ejecutar slices independientes con un motor mock o con Pi, conservar evidencia estructurada y detener siempre el flujo en revisión humana.

## Ejecutar

No necesita instalar dependencias:

```bash
pnpm dev
# http://localhost:4173
```

```bash
pnpm check
```

## Motores

### Mock

Es el modo predeterminado. Usa eventos deterministas, no accede a ningún repositorio y mantiene la demo disponible aunque Pi o sus credenciales no estén configurados.

### Pi

El servidor integra la CLI instalada mediante su protocolo RPC JSONL (`pi --mode rpc --no-session`). Traduce `agent_start`, eventos de herramientas y `agent_settled` a estados, rol, skill, gate y evidencia visibles en el Kanban.

Pi está deshabilitado por defecto. Para permitir una ejecución real:

```bash
PI_ALLOW_MUTATIONS=true pnpm dev
```

La carpeta objetivo se debe seleccionar explícitamente con el diálogo nativo de macOS antes de ejecutar. Pi hereda su configuración y credenciales locales; opcionalmente admite `PI_BIN`, `PI_PROVIDER`, `PI_MODEL` y `PI_TIMEOUT_MS`. El servidor no almacena ni muestra secretos.

Cada prompt impone límites explícitos: trabajar sólo en el proyecto seleccionado y no hacer merge, push, deploy, cambios de credenciales ni operaciones de producción. La aplicación no integra GitHub y nunca fusiona PRs automáticamente.

## Contrato de proyecto

La interfaz sólo inspecciona dos rutas convencionales dentro de la carpeta autorizada mediante el selector nativo:

- `feature_list.json` — obligatorio para cargar tareas.
- `.harness/config.json` — opcional para configuración del harness.

`feature_list.json`:

```json
{
  "version": 1,
  "tasks": [
    {
      "id": "APP-001",
      "title": "Añadir búsqueda",
      "state": "pending",
      "role": "Implementer",
      "skill": "feature-implementer",
      "gate": "Tests enfocados",
      "evidence": ["Criterios definidos"],
      "blocked": null
    }
  ]
}
```

Estados válidos: `pending`, `planning`, `implementing`, `validating`, `review` y `done`. Un bloqueo es una condición opcional con `{ "reason": "...", "resolution": "..." }`, no una columna.

`.harness/config.json`:

```json
{
  "version": 1,
  "defaultEngine": "mock",
  "reviewRequired": true,
  "autoMerge": false
}
```

Los archivos ausentes producen un estado vacío explicativo; no se generan tareas ni valores ficticios. El ejemplo comprobable está en `examples/sample-project/`.

## Límites actuales

- El estado vive en memoria y se pierde al reiniciar el servidor.
- El modo Pi ejecuta una sesión por tarea sobre la carpeta seleccionada; todavía no crea worktrees separados.
- Pausar/reanudar se mantiene para la oleada mock. Una sesión Pi activa no se presenta como pausable.
- GitHub, creación de PR y persistencia son fronteras separadas aún no conectadas.
