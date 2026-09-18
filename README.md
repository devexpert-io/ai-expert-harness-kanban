# AI Expert Harness Kanban

Demostración web, local y determinista de un harness de agentes que lleva slices independientes de una feature hasta una PR verificable.

La aplicación muestra estas fases: **Pendiente → Planificando → Implementando → Validando → Revisión humana → Terminada**. **Bloqueada** es una condición de una tarea, no una fase: la tarjeta conserva su posición en el flujo y explica qué decisión o dependencia necesita. Una oleada promociona en paralelo los slices independientes y termina de forma obligatoria al crear una PR simulada para la revisión humana. La única acción de integración se hace mediante el control explícito de la persona revisora: el harness nunca fusiona una PR.

## Ejecutar

No necesita dependencias de npm:

```bash
pnpm dev
# abre http://localhost:4173
```

Para el check estático mínimo:

```bash
pnpm check
```

## Qué está simulado

- El tablero, las tareas y su avance se guardan en memoria del navegador y se reinician al recargar.
- Los roles Planner, Implementer y Validator avanzan cada 1,5 segundos al iniciar la oleada.
- Los worktrees, comandos de test, commits y la PR `#42` son evidencia de demostración determinista, no operaciones en `ai-expert-project`.
- La acción “Marcar como integrada” representa una decisión humana; no ejecuta merge ni llama a GitHub.

## Fronteras para la integración real

El demo está planteado como tres adaptadores sustituibles; la UI no necesita saber si son locales o remotos.

1. **Wave runner / Pi SDK.** Sustituir `advanceWave()` por un servicio que lance cada slice independiente con Pi SDK y un worktree propio. Cada ejecución debe devolver el rol, estado, skill invocada y eventos estructurados.
2. **Evidence adapter.** Ingerir de esas ejecuciones los artefactos reales: plan o spec, ruta del worktree, SHA, salida resumida de checks y captura/resultado de validación. Persistirlos por tarea en lugar de usar `trace` local.
3. **Pull-request gateway / GitHub.** Sólo después de la validación independiente, crear la PR mediante GitHub API o CLI y guardar URL, número y checks. La transición resultante debe ser exclusivamente `review`; no implementar una transición automática de `review` a merge.

Un backend posterior puede ofrecer, por ejemplo, `POST /waves`, `POST /waves/:id/pause`, `GET /tasks`, `POST /tasks/:id/integrate` y webhooks/eventos para actualizar el tablero. El endpoint `integrate` debe requerir identidad y una confirmación humana explícita; es deliberadamente una frontera separada del runner de agentes.

## Límites de esta primera versión

- No hay autentificación, persistencia ni integración viva con Pi SDK, GitHub o `ai-expert-project`.
- No crea worktrees, commits, ramas, PRs ni despliega nada.
- Es una interfaz de producto para explicar el loop y sus gates, no un sustituto de la orquestación de producción.
