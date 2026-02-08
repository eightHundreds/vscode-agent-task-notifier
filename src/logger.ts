import * as vscode from 'vscode';
import { getLogLevel, LogLevel } from './config';

const LOG_LEVEL_ORDER: Record<LogLevel, number> = {
    error: 0,
    warn: 1,
    info: 2,
    debug: 3,
};

export class Logger implements vscode.Disposable {
    private readonly channel = vscode.window.createOutputChannel(vscode.l10n.t('Agent Task Notifier'));

    constructor() { }

    debug(message: string): void {
        this.write('debug', message);
    }

    info(message: string): void {
        this.write('info', message);
    }

    warn(message: string): void {
        this.write('warn', message);
    }

    error(message: string): void {
        this.write('error', message);
    }

    show(preserveFocus = true): void {
        this.channel.show(preserveFocus);
    }

    dispose(): void {
        this.channel.dispose();
    }

    private write(level: LogLevel, message: string): void {
        if (!shouldLog(level)) {
            return;
        }

        const timestamp = new Date().toISOString();
        this.channel.appendLine(`[${timestamp}] [${level.toUpperCase()}] ${message}`);
    }
}

function shouldLog(level: LogLevel): boolean {
    return LOG_LEVEL_ORDER[level] <= LOG_LEVEL_ORDER[getLogLevel()];
}
