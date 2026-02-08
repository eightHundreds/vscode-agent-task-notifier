#!/usr/bin/env bash
set -euo pipefail

DEBUG_MODE="${AGENT_TASK_NOTIFIER_DEBUG:-0}"
LOG_FILE="${AGENT_TASK_NOTIFIER_LOG_FILE:-/tmp/agent-task-notifier-claude.log}"

is_debug_enabled() {
  [[ "${DEBUG_MODE}" == "1" || "${DEBUG_MODE}" == "true" || "${DEBUG_MODE}" == "TRUE" ]]
}

log_debug() {
  if ! is_debug_enabled; then
    return
  fi
  local message="$1"
  local dir
  dir="$(dirname "${LOG_FILE}")"
  mkdir -p "${dir}" >/dev/null 2>&1 || true
  printf '[%s] %s\n' "$(date -u +'%Y-%m-%dT%H:%M:%SZ')" "${message}" >> "${LOG_FILE}" 2>/dev/null || true
}

write_to_parent_tty() {
  local content="$1"
  local pty
  pty="$(ps -o tty= -p "${PPID}" 2>/dev/null | tr -d '[:space:]')"
  if [[ -z "${pty}" || "${pty}" == "?" ]]; then
    return 1
  fi

  local pty_path="/dev/${pty}"
  if [[ ! -w "${pty_path}" ]]; then
    return 1
  fi

  if { printf '%s' "${content}" > "${pty_path}"; } 2>/dev/null; then
    log_debug "emitted via parent tty ${pty_path}"
    return 0
  fi

  return 1
}

if ! command -v jq >/dev/null 2>&1; then
  log_debug "skip: jq not found"
  exit 0
fi

INPUT="$(cat)"
if [[ -z "${INPUT}" ]]; then
  log_debug "skip: empty hook stdin"
  exit 0
fi

SESSION_ID="$(printf '%s' "${INPUT}" | jq -r '.session_id // empty')"
TASK_ID="$(printf '%s' "${INPUT}" | jq -r '.task_id // empty')"
MESSAGE="Claude subagent finished"
NOW_MS="$(( $(date +%s) * 1000 ))"

EVENT_JSON="$(
  jq -cn \
    --arg source "claude" \
    --arg event "subagent_stop" \
    --arg status "success" \
    --arg message "${MESSAGE}" \
    --arg sessionId "${SESSION_ID}" \
    --arg taskId "${TASK_ID}" \
    --arg dedupeKey "claude:subagent_stop:${SESSION_ID}:${TASK_ID}" \
    --argjson createdAt "${NOW_MS}" \
    '{
      version: 1,
      source: $source,
      event: $event,
      status: $status,
      message: $message,
      createdAt: $createdAt,
      dedupeKey: $dedupeKey
    }
    + (if $sessionId == "" then {} else {sessionId: $sessionId} end)
    + (if $taskId == "" then {} else {taskId: $taskId} end)'
)"

ENCODED="$(
  printf '%s' "${EVENT_JSON}" \
    | base64 \
    | tr -d '\n' \
    | tr '+/' '-_' \
    | tr -d '='
)"

OSC="$(printf '\033]777;notify;AGENT_TASK_EVENT_V1;%s\007' "${ENCODED}")"
if [[ -w /dev/tty ]]; then
  if { printf '%s' "${OSC}" > /dev/tty; } 2>/dev/null; then
    log_debug "emitted subagent_stop via /dev/tty session=${SESSION_ID} task=${TASK_ID}"
    exit 0
  fi
  log_debug "warn: write /dev/tty failed, falling back to stdout"
fi

if write_to_parent_tty "${OSC}"; then
  log_debug "emitted subagent_stop via parent-tty session=${SESSION_ID} task=${TASK_ID}"
  exit 0
fi

printf '%s' "${OSC}"
printf '%s' "${OSC}" >&2
log_debug "emitted subagent_stop via stdout+stderr session=${SESSION_ID} task=${TASK_ID}"
