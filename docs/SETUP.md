# 安装与配置清单

1. 在 VS Code / Cursor 安装扩展。
2. 在系统中安装 `jq`。
3. 打开内置终端并启动 `codex`，扩展会在每次启动时同步脚本到 `~/.codex/agent-task-notifier/notify.sh`，并检查/改写 `~/.codex/config.toml`。
4. 根据提示重启当前 `codex` 进程。
5. 打开内置终端并启动 `claude`，扩展会在每次启动时同步脚本到 `~/.claude/agent-task-notifier/`，并检查/改写 `~/.claude/settings.json` 的 hooks。
6. 根据提示重启当前 `claude` 进程。
7. 如需手动触发改写，执行命令 `Agent Task Notifier: Repair Codex Notify` 或 `Agent Task Notifier: Repair Claude Hooks`。
8. 执行命令 `Agent Task Notifier: Test Notification`，验证通知点击后是否能回到对应终端。
9. 将 `agentTaskNotifier.logLevel` 设为 `debug`，并执行 `Agent Task Notifier: Show Logs` 观察事件解析日志。
10. 执行 `Agent Task Notifier: Debug Status`，确认目标终端显示 `shellIntegration=ready`。
