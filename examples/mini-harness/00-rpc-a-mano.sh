#!/usr/bin/env bash
# Práctica 1 · Habla con Pi a mano. Ejecútalo dentro de tu fork y pega una línea JSON, por ejemplo:
#   {"type":"prompt","message":"¿Qué features de feature_list.json están listas para empezar?"}
# Se ocultan los eventos de streaming (message_update, tool_execution_update) para ver la conversación.
set -euo pipefail
harness="$(cd "$(dirname "$0")/../.." && pwd)"
: "${DEVEXPERT_API_KEY:?Exporta DEVEXPERT_API_KEY con tu clave de DevExpert Inference}"
pi --mode rpc --no-session --no-approve --no-extensions \
  --provider devexpert --model chat --extension "$harness/harness/devexpert-provider.mjs" \
  | jq -c --unbuffered 'select(.type | test("_update$") | not)
      | {type} + (if .toolName then {tool: .toolName} else {} end)
      + (if .type == "tool_execution_start" then {args: (.args | tostring | .[0:70])} else {} end)
      + (if .type == "message_end" and .message.role == "assistant" then {text: ([.message.content[]? | select(.type == "text") | .text] | join(" ") | .[0:160])} else {} end)'
