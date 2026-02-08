# Codex 适配器

该适配器会把 Codex 的 `notify` 事件转换为扩展可识别的结构化终端事件。

## 配置 Codex

默认无需手动编辑 `~/.codex/config.toml`：

1. 在 VS Code 内置终端启动一次 `codex`。
2. 扩展会在每次检测到 `codex` 启动时自动同步脚本到 `~/.codex/agent-task-notifier/notify.sh`。
3. 扩展会自动注释旧 `notify` 并写入受管 `notify` 配置（指向外部脚本）。
4. 重启当前 `codex` 进程。

如需手动触发改写，执行命令：

`Agent Task Notifier: Repair Codex Notify`

## 事件映射

- `agent-turn-complete` -> `turn_complete`
- `approval-requested` -> `approval_requested`
- 通知标题：优先使用 Codex 的 `last-assistant-message`，格式为 `Codex: <title>`。
- 通知正文：优先拼接 `input-messages`，并截断为短预览（默认最多 120 字符，超出追加 `…`）。

脚本最终输出：

`OSC 777;notify;AGENT_TASK_EVENT_V1;<base64url-json>`

## 依赖

- `bash`
- `jq`

## 调试脚本

可用环境变量：

- `AGENT_TASK_NOTIFIER_DEBUG=1`：开启脚本调试日志。
- `AGENT_TASK_NOTIFIER_LOG_FILE=/tmp/agent-task-notifier-codex.log`：指定日志文件。
- `AGENT_TASK_NOTIFIER_CODEX_MESSAGE_MAX_CHARS=120`：控制正文预览长度。

示例：

```sh
export AGENT_TASK_NOTIFIER_DEBUG=1
export AGENT_TASK_NOTIFIER_LOG_FILE=/tmp/agent-task-notifier-codex.log
codex
```

然后在另一个终端查看：

```sh
tail -f /tmp/agent-task-notifier-codex.log
```
