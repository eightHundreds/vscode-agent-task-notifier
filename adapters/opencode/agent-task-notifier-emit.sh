#!/usr/bin/env bash
set -euo pipefail

DEBUG_MODE="${AGENT_TASK_NOTIFIER_DEBUG:-0}"
LOG_FILE="${AGENT_TASK_NOTIFIER_LOG_FILE:-/tmp/agent-task-notifier-opencode.log}"

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

OSC="${1:-}"
if [[ -z "${OSC}" ]]; then
  log_debug "skip: empty osc payload"
  exit 0
fi

if [[ -w /dev/tty ]]; then
  if { printf '%s' "${OSC}" > /dev/tty; } 2>/dev/null; then
    log_debug "emitted via /dev/tty"
    exit 0
  fi
  log_debug "warn: write /dev/tty failed, falling back"
fi

if write_to_parent_tty "${OSC}"; then
  exit 0
fi

printf '%s' "${OSC}"
printf '%s' "${OSC}" >&2
log_debug "emitted via stdout+stderr fallback"
