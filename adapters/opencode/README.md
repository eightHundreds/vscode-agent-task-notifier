# OpenCode 适配器

该适配器通过 OpenCode plugin hooks 输出结构化任务事件。

## 配置方式

默认无需手动编辑 OpenCode 配置：

1. 在 VS Code 内置终端启动一次 `opencode`。
2. 扩展会在每次检测到 `opencode` 启动时自动同步插件脚本到 `~/.opencode/plugins/`。
3. 重启当前 `opencode` 进程。

如需手动触发修复，执行命令：

`Agent Task Notifier: Repair OpenCode Plugin`

## 事件映射

- `session.status`（`status.type=idle`）/ `session.idle` -> `turn_complete`
- `permission.updated` / `permission.asked` -> `approval_requested`

脚本最终输出：

`OSC 777;notify;AGENT_TASK_EVENT_V1;<base64url-json>`

## 依赖

- OpenCode plugin hooks
- `bash`
