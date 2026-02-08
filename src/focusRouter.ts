import { randomUUID } from 'node:crypto';
import * as vscode from 'vscode';
import { isStrictWindowRouting } from './config';
import { Logger } from './logger';
import { TerminalRegistry } from './terminalRegistry';

export class FocusRouter {
    private readonly windowToken = randomUUID();

    constructor(
        private readonly context: vscode.ExtensionContext,
        private readonly terminalRegistry: TerminalRegistry,
        private readonly logger: Logger,
    ) {
        context.subscriptions.push(
            vscode.window.registerUriHandler({
                handleUri: (uri) => {
                    void this.handleUri(uri);
                },
            }),
        );
    }

    async createFocusUri(terminalId: string): Promise<vscode.Uri> {
        const baseUri = vscode.Uri.parse(
            `${vscode.env.uriScheme}://${this.context.extension.id}/focus?tid=${encodeURIComponent(terminalId)}&wt=${encodeURIComponent(this.windowToken)}`,
        );
        const externalUri = await vscode.env.asExternalUri(baseUri);
        this.logger.debug(`Built focus URI for terminal ${terminalId}`);
        return externalUri;
    }

    async focusTerminalById(terminalId: string): Promise<void> {
        const terminal = this.terminalRegistry.getTerminalById(terminalId);
        if (terminal) {
            try {
                terminal.show();
                this.logger.info(`Focused terminal ${terminalId}`);
                return;
            } catch {
                this.logger.warn(`Failed direct focus for terminal ${terminalId}, trying fallback`);
            }
        }

        try {
            await vscode.commands.executeCommand('workbench.action.terminal.focus');
            this.logger.info(`Fallback focused terminal panel for ${terminalId}`);
        } catch {
            await vscode.commands.executeCommand('workbench.action.terminal.toggleTerminal');
            this.logger.warn(`Fallback toggled terminal panel for ${terminalId}`);
        }
    }

    private async handleUri(uri: vscode.Uri): Promise<void> {
        if (uri.path !== '/focus') {
            return;
        }

        const query = new URLSearchParams(uri.query);
        const terminalId = query.get('tid') ?? '';
        const token = query.get('wt') ?? '';

        if (!terminalId) {
            this.logger.warn('Received focus URI without terminal id');
            return;
        }

        if (isStrictWindowRouting() && token && token !== this.windowToken) {
            this.logger.debug(`Ignored focus URI due to token mismatch for terminal ${terminalId}`);
            return;
        }

        this.logger.debug(`Handling focus URI for terminal ${terminalId}`);
        await this.focusTerminalById(terminalId);
    }
}
