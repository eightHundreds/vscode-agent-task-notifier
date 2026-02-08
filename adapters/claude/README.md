# Claude 适配器

该适配器通过 Claude Code hooks 输出结构化任务完成事件。

## 配置 hooks

默认无需手动编辑 `~/.claude/settings.json`：

1. 在 VS Code 内置终端启动一次 `claude`。
2. 扩展会在每次检测到 `claude` 启动时自动同步脚本到 `~/.claude/agent-task-notifier/`。
3. 扩展会自动写入受管 hooks（`Stop` / `SubagentStop`）到 `~/.claude/settings.json`。
4. 重启当前 `claude` 进程。

如需手动触发改写，执行命令：

`Agent Task Notifier: Repair Claude Hooks`

手动配置时可参考：

```json
{
  "hooks": {
    "Stop": [
      {
        "hooks": [
          {
            "type": "command",
            "command": "bash /absolute/path/to/vscode-agent-task-notifier/adapters/claude/stop-hook.sh"
          }
        ]
      }
    ],
    "SubagentStop": [
      {
        "hooks": [
          {
            "type": "command",
            "command": "bash /absolute/path/to/vscode-agent-task-notifier/adapters/claude/subagent-stop-hook.sh"
          }
        ]
      }
    ]
  }
}
```

## 事件映射

- `Stop` -> `stop`
- `SubagentStop` -> `subagent_stop`

脚本最终输出：

`OSC 777;notify;AGENT_TASK_EVENT_V1;<base64url-json>`

## 依赖

- `bash`
- `jq`

## 调试脚本

可用环境变量：

- `AGENT_TASK_NOTIFIER_DEBUG=1`：开启脚本调试日志。
- `AGENT_TASK_NOTIFIER_LOG_FILE=/tmp/agent-task-notifier-claude.log`：指定日志文件。
