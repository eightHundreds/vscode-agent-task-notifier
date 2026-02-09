import * as vscode from 'vscode';
import {
    getDedupeWindowMs,
    getLogLevel,
    isExtensionEnabled,
    setEnabledSetting,
} from './config';
import { EventDedupe } from './dedupe';
import { FocusRouter } from './focusRouter';
import { Logger } from './logger';
import { NotificationService } from './notifier';
import { AgentOutputParser } from './parser';
import { TerminalRegistry } from './terminalRegistry';
import { AgentEvent, AgentEventPayloadV1 } from './types';
import { CodexNotifyBootstrap, isCodexCommand } from './codexNotifyBootstrap';
import { ClaudeHooksBootstrap, isClaudeCommand } from './claudeHooksBootstrap';
import { OpenCodePluginBootstrap, isOpenCodeCommand } from './opencodePluginBootstrap';

export function activate(context: vscode.ExtensionContext): void {
    const logger = new Logger();
    context.subscriptions.push(logger);

    const terminalRegistry = new TerminalRegistry(context, logger);
    const focusRouter = new FocusRouter(context, terminalRegistry, logger);
    const notificationService = new NotificationService(context, focusRouter, logger);
    const codexNotifyBootstrap = new CodexNotifyBootstrap(context, logger);
    const claudeHooksBootstrap = new ClaudeHooksBootstrap(context, logger);
    const openCodePluginBootstrap = new OpenCodePluginBootstrap(context, logger);
    const dedupe = new EventDedupe(() => getDedupeWindowMs(), logger);
    logger.info(`Extension activated (logLevel=${getLogLevel()})`);
    logger.debug('Debug logging is enabled');

    context.subscriptions.push(
        vscode.commands.registerCommand('agentTaskNotifier.enable', async () => {
            await setEnabledSetting(true);
            void vscode.window.showInformationMessage(vscode.l10n.t('Agent Task Notifier enabled'));
            logger.info('Extension enabled by command');
        }),
        vscode.commands.registerCommand('agentTaskNotifier.disable', async () => {
            await setEnabledSetting(false);
            void vscode.window.showInformationMessage(vscode.l10n.t('Agent Task Notifier disabled'));
            logger.info('Extension disabled by command');
        }),
        vscode.commands.registerCommand('agentTaskNotifier.showLogs', () => {
            logger.show(false);
            logger.info('Log channel opened by command');
        }),
        vscode.commands.registerCommand('agentTaskNotifier.debugStatus', () => {
            const terminals = vscode.window.terminals;
            logger.info(`Debug status: terminals=${terminals.length}, logLevel=${getLogLevel()}, extensionEnabled=${isExtensionEnabled()}`);
            const paths = codexNotifyBootstrap.getPaths();
            logger.info(`Codex bootstrap paths: config="${paths.configPath}" externalScript="${paths.externalScriptPath}"`);
            const claudePaths = claudeHooksBootstrap.getPaths();
            logger.info(`Claude bootstrap paths: config="${claudePaths.configPath}" stopScript="${claudePaths.externalStopScriptPath}" subagentStopScript="${claudePaths.externalSubagentStopScriptPath}"`);
            const openCodePaths = openCodePluginBootstrap.getPaths();
            logger.info(`OpenCode bootstrap paths: plugin="${openCodePaths.pluginPath}" emitScript="${openCodePaths.emitScriptPath}"`);
            for (let i = 0; i < terminals.length; i += 1) {
                const terminal = terminals[i];
                const shellIntegration = terminal.shellIntegration ? 'ready' : 'missing';
                logger.info(`Terminal[${i}] name="${terminal.name}" shellIntegration=${shellIntegration}`);
            }
            logger.show(false);
        }),
        vscode.commands.registerCommand('agentTaskNotifier.repairCodexNotify', async () => {
            logger.info('Manual Codex notify repair triggered');
            await codexNotifyBootstrap.repairNow();
        }),
        vscode.commands.registerCommand('agentTaskNotifier.repairClaudeHooks', async () => {
            logger.info('Manual Claude hooks repair triggered');
            await claudeHooksBootstrap.repairNow();
        }),
        vscode.commands.registerCommand('agentTaskNotifier.repairOpenCodePlugin', async () => {
            logger.info('Manual OpenCode plugin repair triggered');
            await openCodePluginBootstrap.repairNow();
        }),
        vscode.commands.registerCommand('agentTaskNotifier.testNotification', async () => {
            const terminal = vscode.window.activeTerminal;
            if (!terminal) {
                void vscode.window.showWarningMessage(vscode.l10n.t('Open a terminal before sending a test notification.'));
                logger.warn('Test notification requested without an active terminal');
                return;
            }

            const terminalId = terminalRegistry.getOrAssignId(terminal);
            const event: AgentEvent = {
                version: 1,
                source: 'codex',
                event: 'turn_complete',
                status: 'success',
                message: vscode.l10n.t('Test notification from Agent Task Notifier'),
                createdAt: Date.now(),
                terminal,
                terminalId,
                dedupeKey: `test:${terminalId}:${Date.now()}`,
            };

            logger.info(`Sending test notification for terminal ${terminalId}`);
            await maybeNotify(event, dedupe, notificationService, logger);
        }),
    );

    context.subscriptions.push(
        vscode.window.onDidChangeTerminalShellIntegration((event) => {
            const terminalId = terminalRegistry.getOrAssignId(event.terminal);
            logger.info(`Shell integration changed: terminal=${terminalId} available=${event.shellIntegration !== undefined}`);
        }),
        vscode.window.onDidStartTerminalShellExecution((executionStartEvent) => {
            if (!isExtensionEnabled()) {
                logger.debug('Ignored shell execution because extension is disabled');
                return;
            }

            const terminal = executionStartEvent.terminal;
            const terminalId = terminalRegistry.getOrAssignId(terminal);
            const commandLine = executionStartEvent.execution.commandLine.value;
            logger.debug(`Started shell execution stream for terminal ${terminalId} command="${commandLine}"`);
            if (isCodexCommand(commandLine)) {
                logger.info(`Codex command detected in terminal ${terminalId}`);
                void codexNotifyBootstrap.handleCodexCommandDetected();
            }
            if (isClaudeCommand(commandLine)) {
                logger.info(`Claude command detected in terminal ${terminalId}`);
                void claudeHooksBootstrap.handleClaudeCommandDetected();
            }
            if (isOpenCodeCommand(commandLine)) {
                logger.info(`OpenCode command detected in terminal ${terminalId}`);
                void openCodePluginBootstrap.handleOpenCodeCommandDetected();
            }
            const parser = new AgentOutputParser({
                onStructured: (payload) => {
                    logger.info(`Structured event parsed ${payload.source}:${payload.event} terminal=${terminalId} session=${payload.sessionId ?? '-'} task=${payload.taskId ?? '-'} turn=${payload.turnId ?? '-'}`);
                    logger.debug(`Structured payload detail terminal=${terminalId} title="${preview(payload.title)}" message="${preview(payload.message)}"`);
                    void handleStructuredEvent(payload, terminal, terminalId, dedupe, notificationService, logger);
                },
                onDebug: (message) => logger.debug(message),
            });

            void readExecutionStream(executionStartEvent.execution, parser, logger, terminalId);
        }),
    );
}

export function deactivate(): void {
    // No background resources to dispose explicitly.
}

async function readExecutionStream(
    execution: vscode.TerminalShellExecution,
    parser: AgentOutputParser,
    logger: Logger,
    terminalId: string,
): Promise<void> {
    const stream = execution.read();
    try {
        for await (const data of stream) {
            const text = String(data);
            if (text.includes('AGENT_TASK_EVENT_V1')) {
                logger.debug(`Detected AGENT_TASK_EVENT_V1 marker in terminal ${terminalId}`);
            }
            parser.feed(text);
        }
        parser.flush();
        logger.debug(`Shell execution stream ended for terminal ${terminalId}`);
    } catch (error) {
        logger.warn(`Terminal shell execution stream error for terminal ${terminalId}: ${String(error)}`);
    }
}

async function handleStructuredEvent(
    payload: AgentEventPayloadV1,
    terminal: vscode.Terminal,
    terminalId: string,
    dedupe: EventDedupe,
    notificationService: NotificationService,
    logger: Logger,
): Promise<void> {
    const event: AgentEvent = {
        ...payload,
        terminal,
        terminalId,
    };
    await maybeNotify(event, dedupe, notificationService, logger);
}

async function maybeNotify(
    event: AgentEvent,
    dedupe: EventDedupe,
    notificationService: NotificationService,
    logger: Logger,
): Promise<void> {
    if (!isExtensionEnabled()) {
        logger.debug('Skip notify because extension is disabled');
        return;
    }

    if (!dedupe.shouldEmit(event)) {
        return;
    }

    await notificationService.notify(event);
    logger.info(`Notification delivered ${event.source}:${event.event} terminal=${event.terminalId}`);
}

function preview(value: string | undefined, maxChars = 80): string {
    if (!value) {
        return '';
    }
    const normalized = value.replace(/\s+/g, ' ').trim();
    if (normalized.length <= maxChars) {
        return normalized;
    }
    if (maxChars <= 1) {
        return '…';
    }
    return `${normalized.slice(0, maxChars - 1)}…`;
}
