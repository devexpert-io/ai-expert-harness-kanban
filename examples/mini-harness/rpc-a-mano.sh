#!/usr/bin/env bash
# Práctica 1 · Habla con Pi a mano: ./00-rpc-a-mano.sh [--proyecto <ruta>] (por defecto, el enlace `tienda`).
# Pi arranca dentro del proyecto, para ver su feature_list.json y su AGENTS.md. Pega una línea JSON, por ejemplo:
#   {"type":"prompt","message":"¿Qué features de feature_list.json están listas para empezar?"}
# Se ocultan los eventos de streaming (message_update, tool_execution_update) para ver la conversación.
set -euo pipefail
harness="$(cd "$(dirname "$0")/../.." && pwd)"
# Pi arranca en una copia desechable de tu proyecto (el enlace `tienda`, o --proyecto <ruta>).
copy="$(node "$harness/examples/mini-harness/proyecto.mjs" copia "$@")" || exit 1
cd "$copy"
# La clave nunca se teclea a la vista: la del entorno, la que guardaste en el Kanban o, si no hay, se pide oculta.
if [ -z "${DEVEXPERT_API_KEY:-}" ] && [ -f "$harness/.harness-data/credentials.json" ]; then
  DEVEXPERT_API_KEY="$(node -e 'process.stdout.write(JSON.parse(require("fs").readFileSync(process.argv[1], "utf8")).apiKey ?? "")' "$harness/.harness-data/credentials.json")"
fi
if [ -z "${DEVEXPERT_API_KEY:-}" ]; then
  read -r -s -p "API key de DevExpert Inference (no se muestra): " DEVEXPERT_API_KEY < /dev/tty && echo >&2
fi
export DEVEXPERT_API_KEY
echo "Pi listo en una copia de tu proyecto ($copy). Pega una línea JSON y pulsa Enter (Ctrl+C para salir)." >&2
pi --mode rpc --no-session --no-approve --no-extensions \
  --provider devexpert --model chat --extension "$harness/harness/devexpert-provider.mjs" \
  | jq -c --unbuffered 'select(.type | test("_update$") | not)
      | {type} + (if .toolName then {tool: .toolName} else {} end)
      + (if .type == "tool_execution_start" then {args: (.args | tostring | .[0:70])} else {} end)
      + (if .type == "message_end" and .message.role == "assistant" then {text: ([.message.content[]? | select(.type == "text") | .text] | join(" ") | .[0:160])} else {} end)'
