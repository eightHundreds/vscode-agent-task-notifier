# `AGENT_TASK_EVENT_V1` 协议说明

扩展仅接受以下格式的结构化 OSC 事件：

```text
ESC ] 777 ; notify ; AGENT_TASK_EVENT_V1 ; <base64url(json)> BEL
```

支持的 JSON Schema：

```json
{
  "version": 1,
  "source": "codex | claude | opencode",
  "event": "turn_complete | approval_requested | stop | subagent_stop",
  "status": "success | info | warning",
  "title": "optional, string",
  "message": "string",
  "createdAt": 1738800000000,
  "sessionId": "optional",
  "taskId": "optional",
  "turnId": "optional",
  "dedupeKey": "optional"
}
```

若解码失败、字段不合法或不符合 schema，事件会被直接忽略。
