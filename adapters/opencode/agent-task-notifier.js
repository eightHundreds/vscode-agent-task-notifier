import path from "node:path"
import { fileURLToPath } from "node:url"

const EVENT_TITLE = "AGENT_TASK_EVENT_V1"
const TURN_COMPLETE_MESSAGE = "OpenCode finished current turn"
const APPROVAL_MESSAGE = "OpenCode requires approval"
const DUPLICATE_IDLE_WINDOW_MS = 1500
const TURN_TOKEN_TTL_MS = 10 * 60 * 1000

const sessionTurnTokens = new Map()

function maybeString(value) {
  return typeof value === "string" && value.length > 0 ? value : undefined
}

function encodeBase64Url(value) {
  return Buffer.from(value, "utf8")
    .toString("base64")
    .replace(/\+/g, "-")
    .replace(/\//g, "_")
    .replace(/=+$/g, "")
}

function buildOsc(payload) {
  const encoded = encodeBase64Url(JSON.stringify(payload))
  return `\u001b]777;notify;${EVENT_TITLE};${encoded}\u0007`
}

function nowMs() {
  return Date.now()
}

function resolveTurnToken(sessionId, timestamp) {
  pruneTurnTokens(timestamp)

  const key = sessionId ?? "__unknown__"
  const previous = sessionTurnTokens.get(key)
  if (previous && timestamp - previous.timestamp <= DUPLICATE_IDLE_WINDOW_MS) {
    return previous.token
  }

  const token = String(timestamp)
  sessionTurnTokens.set(key, {
    token,
    timestamp,
  })

  return token
}

function pruneTurnTokens(timestamp) {
  for (const [key, value] of sessionTurnTokens.entries()) {
    if (timestamp - value.timestamp > TURN_TOKEN_TTL_MS) {
      sessionTurnTokens.delete(key)
    }
  }
}

function buildTurnCompleteEvent(event) {
  const properties = event?.properties ?? {}
  const sessionId = maybeString(properties.sessionID)
  const timestamp = nowMs()
  const token = resolveTurnToken(sessionId, timestamp)
  const payload = {
    version: 1,
    source: "opencode",
    event: "turn_complete",
    status: "success",
    title: "OpenCode: Turn Complete",
    message: TURN_COMPLETE_MESSAGE,
    createdAt: timestamp,
    dedupeKey: `opencode:turn_complete:${sessionId ?? ""}:${token}`,
  }
  if (sessionId) payload.sessionId = sessionId
  return payload
}

function buildApprovalEvent(event) {
  const properties = event?.properties ?? {}
  const sessionId = maybeString(properties.sessionID)
  const permissionId = maybeString(properties.id) ?? maybeString(properties.permissionID)
  const message = maybeString(properties.message) ?? APPROVAL_MESSAGE
  const timestamp = nowMs()
  const token = permissionId ?? String(timestamp)

  const payload = {
    version: 1,
    source: "opencode",
    event: "approval_requested",
    status: "warning",
    title: "OpenCode: Approval Requested",
    message,
    createdAt: timestamp,
    dedupeKey: `opencode:approval_requested:${sessionId ?? ""}:${token}`,
  }
  if (sessionId) payload.sessionId = sessionId
  if (permissionId) payload.taskId = permissionId
  return payload
}

function toAgentEvent(event) {
  if (!event || typeof event !== "object") return undefined
  if (event.type === "session.idle") {
    return buildTurnCompleteEvent(event)
  }
  if (event.type === "session.status" && event?.properties?.status?.type === "idle") {
    return buildTurnCompleteEvent(event)
  }
  if (event.type === "permission.updated" || event.type === "permission.asked") {
    return buildApprovalEvent(event)
  }
  return undefined
}

export const AgentTaskNotifierPlugin = async ({ $ }) => {
  const emitScriptPath = path.join(path.dirname(fileURLToPath(import.meta.url)), "agent-task-notifier-emit.sh")

  return {
    event: async ({ event }) => {
      const payload = toAgentEvent(event)
      if (!payload) {
        return
      }

      const osc = buildOsc(payload)
      try {
        await $`bash ${emitScriptPath} ${osc}`
      } catch {
        process.stdout.write(osc)
        process.stderr.write(osc)
      }
    },
  }
}

export default AgentTaskNotifierPlugin
