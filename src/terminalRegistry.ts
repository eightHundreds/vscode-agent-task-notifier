import { randomUUID } from 'node:crypto';
import * as vscode from 'vscode';
import { Logger } from './logger';

export class TerminalRegistry {
    private readonly terminalToId = new Map<vscode.Terminal, string>();
    private readonly idToTerminal = new Map<string, vscode.Terminal>();

    constructor(context: vscode.ExtensionContext, private readonly logger: Logger) {
        context.subscriptions.push(
            vscode.window.onDidCloseTerminal((terminal) => {
                this.unregister(terminal);
            }),
        );
    }

    getOrAssignId(terminal: vscode.Terminal): string {
        const existing = this.terminalToId.get(terminal);
        if (existing) {
            return existing;
        }

        const id = randomUUID();
        this.terminalToId.set(terminal, id);
        this.idToTerminal.set(id, terminal);
        this.logger.debug(`Registered terminal ${id}`);
        return id;
    }

    getTerminalById(terminalId: string): vscode.Terminal | undefined {
        return this.idToTerminal.get(terminalId);
    }

    private unregister(terminal: vscode.Terminal): void {
        const terminalId = this.terminalToId.get(terminal);
        if (!terminalId) {
            return;
        }

        this.terminalToId.delete(terminal);
        this.idToTerminal.delete(terminalId);
        this.logger.debug(`Unregistered terminal ${terminalId}`);
    }
}
