import * as fs from 'node:fs';
import * as path from 'node:path';
import * as vscode from 'vscode';
import { useOsNotifications, useVsCodeToast } from './config';
import { FocusRouter } from './focusRouter';
import { Logger } from './logger';
import { AgentEvent } from './types';

// eslint-disable-next-line @typescript-eslint/no-var-requires
const BaseNotifier = require('node-notifier');
// eslint-disable-next-line @typescript-eslint/no-var-requires
const NotificationCenter = require('node-notifier/notifiers/notificationcenter');
// eslint-disable-next-line @typescript-eslint/no-var-requires
const WindowsToaster = require('node-notifier/notifiers/toaster');
// eslint-disable-next-line @typescript-eslint/no-var-requires
const NotifySend = require('node-notifier/notifiers/notifysend');

const TITLE_MAX_CHARS = 120;
const MESSAGE_MAX_CHARS = 140;

type Notifier = {
    notify: (options: Record<string, unknown>, callback?: (...args: unknown[]) => void) => void;
    on?: (event: string, callback: (...args: unknown[]) => void) => void;
    __agentTaskNotifierClickHooked?: boolean;
};

export class NotificationService {
    private readonly notifier: Notifier;
    private readonly iconPath: string | undefined;

    constructor(
        private readonly context: vscode.ExtensionContext,
        private readonly focusRouter: FocusRouter,
        private readonly logger: Logger,
    ) {
        this.notifier = createNotifier();
        this.iconPath = resolveIconPath(context);
        this.installClickHandler();
        this.logger.info('Notification service initialized');
    }

    async notify(event: AgentEvent): Promise<void> {
        await this.sendOsNotification(event);
        this.sendVsCodeNotification(event);
    }

    private async sendOsNotification(event: AgentEvent): Promise<void> {
        if (!useOsNotifications()) {
            this.logger.debug('OS notifications disabled by setting');
            return;
        }

        const rendered = renderNotificationContent(event);
        const focusUri = await this.focusRouter.createFocusUri(event.terminalId);
        const options: Record<string, unknown> = {
            title: rendered.title,
            message: rendered.message,
            wait: true,
            tid: event.terminalId,
            open: focusUri.toString(),
        };

        if (this.iconPath) {
            options.icon = this.iconPath;
        }

        if (process.platform === 'darwin') {
            options.sender = 'com.microsoft.VSCode';
            options.activate = 'com.microsoft.VSCode';
        }

        this.notifier.notify(options);
        this.logger.info(`OS notification sent for ${event.source}:${event.event} terminal=${event.terminalId}`);
    }

    private sendVsCodeNotification(event: AgentEvent): void {
        if (!useVsCodeToast()) {
            this.logger.debug('VS Code toast disabled by setting');
            return;
        }

        const rendered = renderNotificationContent(event);
        const action = vscode.l10n.t('Focus Terminal');
        const toastText = rendered.message ? `${rendered.title}: ${rendered.message}` : rendered.title;
        void vscode.window.showInformationMessage(
            toastText,
            action,
        ).then((selection) => {
            if (selection === action) {
                void this.focusRouter.focusTerminalById(event.terminalId);
            }
        });
        this.logger.info(`VS Code toast shown for ${event.source}:${event.event} terminal=${event.terminalId}`);
    }

    private installClickHandler(): void {
        if (!this.notifier.on || this.notifier.__agentTaskNotifierClickHooked) {
            return;
        }

        this.notifier.__agentTaskNotifierClickHooked = true;
        this.notifier.on('click', (...args: unknown[]) => {
            const maybeOptions = args.length > 1 ? args[1] : undefined;
            const options = (maybeOptions && typeof maybeOptions === 'object')
                ? maybeOptions as Record<string, unknown>
                : {};
            const terminalId = typeof options.tid === 'string' ? options.tid : '';
            if (!terminalId) {
                this.logger.debug('Notification click received without terminal id');
                return;
            }
            this.logger.info(`Notification click focusing terminal ${terminalId}`);
            void this.focusRouter.focusTerminalById(terminalId);
        });
    }
}

function createNotifier(): Notifier {
    try {
        if (process.platform === 'darwin') {
            return new NotificationCenter({ withFallback: false }) as Notifier;
        }
        if (process.platform === 'win32') {
            return new WindowsToaster({ withFallback: false, appID: 'Visual Studio Code' }) as Notifier;
        }
        if (process.platform === 'linux') {
            return new NotifySend({ withFallback: false }) as Notifier;
        }
    } catch (error) {
        console.warn('Failed to initialize platform notifier, falling back to base notifier', error);
    }
    return BaseNotifier as Notifier;
}

function resolveIconPath(context: vscode.ExtensionContext): string | undefined {
    const candidate = path.join(context.extensionPath, 'images', 'icon.png');
    return fs.existsSync(candidate) ? candidate : undefined;
}

function titleForEvent(event: AgentEvent): string {
    if (event.title && event.title.trim()) {
        return event.title.trim();
    }
    if (event.source === 'codex' && event.event === 'turn_complete') {
        return vscode.l10n.t('Codex Turn Complete');
    }
    if (event.source === 'codex' && event.event === 'approval_requested') {
        return vscode.l10n.t('Codex Approval Requested');
    }
    if (event.source === 'claude' && event.event === 'subagent_stop') {
        return vscode.l10n.t('Claude Subagent Complete');
    }
    if (event.source === 'claude' && event.event === 'stop') {
        return vscode.l10n.t('Claude Turn Complete');
    }
    if (event.source === 'opencode' && event.event === 'turn_complete') {
        return vscode.l10n.t('OpenCode Turn Complete');
    }
    if (event.source === 'opencode' && event.event === 'approval_requested') {
        return vscode.l10n.t('OpenCode Approval Requested');
    }
    return vscode.l10n.t('Agent Event');
}

function renderNotificationContent(event: AgentEvent): { title: string; message: string } {
    const title = truncateWithEllipsis(normalizeText(titleForEvent(event)), TITLE_MAX_CHARS);
    const message = truncateWithEllipsis(normalizeText(event.message), MESSAGE_MAX_CHARS);
    return { title, message };
}

function normalizeText(value: string): string {
    return value.replace(/\s+/g, ' ').trim();
}

function truncateWithEllipsis(value: string, maxChars: number): string {
    if (!value || maxChars <= 0 || value.length <= maxChars) {
        return value;
    }
    if (maxChars === 1) {
        return '…';
    }
    return `${value.slice(0, maxChars - 1)}…`;
}
