![Agent Task Notifier banner](images/banner.png)

# Agent Task Notifier

[中文](README.md) | [English](README.en.md)

面向 VS Code / Cursor 内置终端的 Agent 通知扩展。

核心目标：

- 你继续在终端里正常运行 `codex` / `claude`。
- Agent 一次任务（turn / stop）结束时自动通知。
- 点击通知后，回到发起该任务的终端标签页。

本扩展有意不做“通用 OSC 通知插件”，只聚焦 Agent 工作流。

## 主要功能

- Codex + Claude 优先的事件流设计。
- 结构化事件协议：`OSC 777;notify;AGENT_TASK_EVENT_V1;<base64url-json>`。
- 同时支持系统通知与 VS Code toast，并提供回到终端动作。
- 使用 deep-link 回跳到原 VS Code 窗口与对应终端标签页。

## 快速开始

1. 安装扩展。
2. 在内置终端启动一次 `codex`。
3. 扩展会自动检查并改写 `~/.codex/config.toml`：
   - 旧的 `notify` 配置会被注释（`# ...`）。
   - 每次检测到 `codex` 启动都会同步脚本到 `~/.codex/agent-task-notifier/notify.sh`。
   - 再把 `notify` 写成指向这个外部脚本。
4. 按提示重启当前 `codex` 进程后生效。
5. 在内置终端启动一次 `claude`。
6. 扩展会自动同步 Claude hooks 脚本到 `~/.claude/agent-task-notifier/`，并检查/改写 `~/.claude/settings.json` 的 `hooks.Stop` 与 `hooks.SubagentStop`。
7. 按提示重启当前 `claude` 进程后生效。

## Agent 配置

### Codex

默认不需要手动修改配置。扩展会在检测到你启动 `codex` 时自动接管 `notify`，并把脚本复制到 `~/.codex/agent-task-notifier/notify.sh`。

如需手动触发修复，可执行命令：

`Agent Task Notifier: Repair Codex Notify`

说明：Codex 会把 `notify` 事件 JSON 作为脚本第一个参数传入。
当前适配器会把通知文案处理为：
- 标题：`Codex: <last-assistant-message>`
- 正文：`input-messages` 的短预览（默认 120 字符，超出追加 `…`）

### Claude Code

默认不需要手动修改配置。扩展会在检测到你启动 `claude` 时自动同步脚本到 `~/.claude/agent-task-notifier/`，并写入 `~/.claude/settings.json` 的 hooks。

如需手动触发修复，可执行命令：

`Agent Task Notifier: Repair Claude Hooks`

手动配置时可参考以下结构：

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

## 配置项

所有配置位于 `agentTaskNotifier.*`：

- `enabled`：总开关。
- `osNotification`：是否启用系统通知。
- `vscodeToast`：是否启用 VS Code 内部通知。
- `logLevel`：日志级别（`error` / `warn` / `info` / `debug`）。
- `dedupeWindowMs`：去重时间窗口（毫秒）。
- `strictWindowRouting`：是否严格校验窗口 token（防止多窗口误跳转）。

## 命令

- `Agent Task Notifier: Enable`
- `Agent Task Notifier: Disable`
- `Agent Task Notifier: Test Notification`
- `Agent Task Notifier: Show Logs`
- `Agent Task Notifier: Debug Status`
- `Agent Task Notifier: Repair Codex Notify`
- `Agent Task Notifier: Repair Claude Hooks`

## 调试与排查

### 1) 看扩展侧日志（最关键）

1. 在设置里把 `agentTaskNotifier.logLevel` 设为 `debug`。
2. 运行命令 `Agent Task Notifier: Show Logs` 打开输出面板。
3. 再执行一次 `Agent Task Notifier: Debug Status`，确认当前终端 `shellIntegration=ready`。
4. 关注这些日志关键字：
   - `Codex command detected ...`：检测到你在终端启动了 codex。
   - `Codex notify config rewritten ...`：已自动改写 `~/.codex/config.toml`。
   - `Claude command detected ...`：检测到你在终端启动了 claude。
   - `Claude hooks config rewritten ...`：已自动改写 `~/.claude/settings.json`。
   - `Structured event parsed ...`：说明扩展已收到结构化事件。
   - `Structured payload detail ...`：可直接看到本次通知使用的 `title/message`（会截断显示）。
   - `Suppressed duplicate event ...`：说明事件被去重抑制。
   - `Notification delivered ...`：说明通知已发出。
5. 如果没有 `Started shell execution stream ...`，请在扩展激活后重新启动一次对应的 `codex` / `claude` 进程（只会监听启动后的 shell 执行流）。

### 2) 判断 Codex 是否真的发出了事件

给启动 Codex 的终端加环境变量：

```sh
export AGENT_TASK_NOTIFIER_DEBUG=1
export AGENT_TASK_NOTIFIER_LOG_FILE=/tmp/agent-task-notifier-codex.log
export AGENT_TASK_NOTIFIER_CODEX_MESSAGE_MAX_CHARS=120
```

然后运行 Codex，并在另一个终端观察：

```sh
tail -f /tmp/agent-task-notifier-codex.log
```

若看到 `received type=...` 与 `emitted event=...`，说明 `notify.sh` 确实被触发并已输出事件。

补充：脚本会优先尝试按以下顺序写回事件：

1. `/dev/tty`
2. 父进程 TTY（`ps -o tty= -p $PPID` 对应的 `/dev/<tty>`）
3. `stdout + stderr` 兜底

这样在 terminal tab 被切走或 `/dev/tty` 不可用时，仍尽量写回正确会话。

## 开发

```sh
npm install
npm run watch
```

然后在 VS Code 中按 `F5` 启动 Extension Development Host。

## 说明

- 适配脚本依赖 `jq` 处理 JSON。
- 当前版本仅支持“适配脚本/hook 输出结构化事件”这一路径。
- Codex/Claude 配置改写逻辑只会在检测到对应命令启动时触发。

## 致谢

- [wbopan/vscode-terminal-osc-notifier](https://github.com/wbopan/vscode-terminal-osc-notifier)
