#!/usr/bin/env bash
set -euo pipefail

DEBUG_MODE="${AGENT_TASK_NOTIFIER_DEBUG:-0}"
LOG_FILE="${AGENT_TASK_NOTIFIER_LOG_FILE:-/tmp/agent-task-notifier-codex.log}"
MESSAGE_MAX_CHARS="${AGENT_TASK_NOTIFIER_CODEX_MESSAGE_MAX_CHARS:-120}"

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

normalize_text() {
  local text="$1"
  text="${text//$'\r'/ }"
  text="${text//$'\n'/ }"
  text="${text//$'\t'/ }"
  printf '%s' "${text}" | sed -E 's/[[:space:]]+/ /g; s/^ //; s/ $//'
}

truncate_with_ellipsis() {
  local text="$1"
  local max_chars="$2"
  local length="${#text}"
  if (( max_chars <= 0 || length <= max_chars )); then
    printf '%s' "${text}"
    return
  fi

  if (( max_chars == 1 )); then
    printf '…'
    return
  fi

  local keep_chars="$(( max_chars - 1 ))"
  printf '%s…' "${text:0:keep_chars}"
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

PAYLOAD="${1:-}"
if [[ -z "${PAYLOAD}" ]]; then
  log_debug "skip: empty payload"
  exit 0
fi

if ! command -v jq >/dev/null 2>&1; then
  log_debug "skip: jq not found"
  exit 0
fi

if ! [[ "${MESSAGE_MAX_CHARS}" =~ ^[0-9]+$ ]]; then
  log_debug "warn: invalid MESSAGE_MAX_CHARS=${MESSAGE_MAX_CHARS}, fallback to 120"
  MESSAGE_MAX_CHARS=120
fi

TYPE="$(printf '%s' "${PAYLOAD}" | jq -r '.type // empty')"
log_debug "received type=${TYPE}"
case "${TYPE}" in
  agent-turn-complete)
    EVENT="turn_complete"
    STATUS="success"
    ;;
  approval-requested)
    EVENT="approval_requested"
    STATUS="warning"
    ;;
  *)
    log_debug "skip: unsupported type=${TYPE}"
    exit 0
    ;;
esac

RAW_TITLE="$(printf '%s' "${PAYLOAD}" | jq -r '."last-assistant-message" // "Turn Complete!"')"
RAW_TITLE="$(normalize_text "${RAW_TITLE}")"
if [[ -z "${RAW_TITLE}" ]]; then
  RAW_TITLE="Turn Complete!"
fi
TITLE="Codex: ${RAW_TITLE}"

RAW_MESSAGE="$(
  printf '%s' "${PAYLOAD}" | jq -r '
    if ."input-messages" and (."input-messages" | type == "array") then
      (."input-messages" | map(tostring) | join(" "))
    else
      (."input-message" // .message // "")
    end
  '
)"
RAW_MESSAGE="$(normalize_text "${RAW_MESSAGE}")"
MESSAGE="$(truncate_with_ellipsis "${RAW_MESSAGE}" "${MESSAGE_MAX_CHARS}")"
SESSION_ID="$(printf '%s' "${PAYLOAD}" | jq -r '."thread-id" // ."conversation-id" // empty')"
TASK_ID="$(printf '%s' "${PAYLOAD}" | jq -r '."task-id" // empty')"
TURN_ID="$(printf '%s' "${PAYLOAD}" | jq -r '."turn-id" // empty')"
NOW_MS="$(( $(date +%s) * 1000 ))"

EVENT_JSON="$(
  jq -cn \
    --arg source "codex" \
    --arg event "${EVENT}" \
    --arg status "${STATUS}" \
    --arg title "${TITLE}" \
    --arg message "${MESSAGE}" \
    --arg sessionId "${SESSION_ID}" \
    --arg taskId "${TASK_ID}" \
    --arg turnId "${TURN_ID}" \
    --arg dedupeKey "codex:${EVENT}:${SESSION_ID}:${TASK_ID}:${TURN_ID}" \
    --argjson createdAt "${NOW_MS}" \
    '{
      version: 1,
      source: $source,
      event: $event,
      status: $status,
      title: $title,
      message: $message,
      createdAt: $createdAt,
      dedupeKey: $dedupeKey
    }
    + (if $sessionId == "" then {} else {sessionId: $sessionId} end)
    + (if $taskId == "" then {} else {taskId: $taskId} end)
    + (if $turnId == "" then {} else {turnId: $turnId} end)'
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
    log_debug "emitted event=${EVENT} via /dev/tty session=${SESSION_ID} task=${TASK_ID} turn=${TURN_ID} title=${TITLE} message=${MESSAGE}"
    exit 0
  fi
  log_debug "warn: write /dev/tty failed, falling back to stdout"
fi

if write_to_parent_tty "${OSC}"; then
  log_debug "emitted event=${EVENT} via parent-tty session=${SESSION_ID} task=${TASK_ID} turn=${TURN_ID} title=${TITLE} message=${MESSAGE}"
  exit 0
fi

printf '%s' "${OSC}"
printf '%s' "${OSC}" >&2
log_debug "emitted event=${EVENT} via stdout+stderr session=${SESSION_ID} task=${TASK_ID} turn=${TURN_ID} title=${TITLE} message=${MESSAGE}"
