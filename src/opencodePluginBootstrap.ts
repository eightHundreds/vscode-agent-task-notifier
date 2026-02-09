import * as os from 'node:os';
import * as path from 'node:path';
import { promises as fs } from 'node:fs';
import * as vscode from 'vscode';
import { Logger } from './logger';

export type OpenCodeConfigResultStatus = 'updated' | 'unchanged' | 'failed';

export interface OpenCodeConfigResult {
    status: OpenCodeConfigResultStatus;
    pluginPath: string;
    emitScriptPath: string;
    detail: string;
}

export function isOpenCodeCommand(commandLine: string): boolean {
    return /\bopencode(\s|$)/i.test(commandLine);
}

export class OpenCodePluginBootstrap {
    private readonly opencodeHome = path.join(os.homedir(), '.opencode');
    private readonly pluginsDir = path.join(this.opencodeHome, 'plugins');
    private readonly adapterPluginScriptPath: string;
    private readonly adapterEmitScriptPath: string;
    private readonly externalPluginScriptPath = path.join(this.pluginsDir, 'agent-task-notifier.js');
    private readonly externalEmitScriptPath = path.join(this.pluginsDir, 'agent-task-notifier-emit.sh');

    constructor(
        private readonly context: vscode.ExtensionContext,
        private readonly logger: Logger,
    ) {
        this.adapterPluginScriptPath = path.join(context.extensionPath, 'adapters', 'opencode', 'agent-task-notifier.js');
        this.adapterEmitScriptPath = path.join(context.extensionPath, 'adapters', 'opencode', 'agent-task-notifier-emit.sh');
    }

    async handleOpenCodeCommandDetected(): Promise<void> {
        const result = await this.ensureConfiguredInternal();

        if (result.status === 'updated') {
            this.logger.info(`OpenCode plugin scripts synced: ${result.detail}`);
            void vscode.window.showInformationMessage(vscode.l10n.t('OpenCode plugin was auto-updated. Restart the current opencode process to apply changes.'));
        } else if (result.status === 'unchanged') {
            this.logger.info(`OpenCode plugin scripts unchanged: ${result.detail}`);
        } else {
            this.logger.warn(`OpenCode plugin sync failed: ${result.detail}`);
            void vscode.window.showWarningMessage(vscode.l10n.t('Failed to auto-configure OpenCode plugin. See Agent Task Notifier logs for details.'));
        }
    }

    async repairNow(): Promise<void> {
        const result = await this.ensureConfiguredInternal();
        if (result.status === 'updated') {
            this.logger.info(`Manual OpenCode plugin repair applied: ${result.detail}`);
            void vscode.window.showInformationMessage(vscode.l10n.t('OpenCode plugin repaired. Restart the current opencode process.'));
            return;
        }
        if (result.status === 'unchanged') {
            this.logger.info(`Manual OpenCode plugin repair not needed: ${result.detail}`);
            void vscode.window.showInformationMessage(vscode.l10n.t('OpenCode plugin is already up to date.'));
            return;
        }

        this.logger.warn(`Manual OpenCode plugin repair failed: ${result.detail}`);
        void vscode.window.showWarningMessage(vscode.l10n.t('Failed to repair OpenCode plugin. See logs for details.'));
    }

    getPaths(): { pluginPath: string; emitScriptPath: string } {
        return {
            pluginPath: this.externalPluginScriptPath,
            emitScriptPath: this.externalEmitScriptPath,
        };
    }

    private async ensureConfiguredInternal(): Promise<OpenCodeConfigResult> {
        try {
            const changed = await this.ensureExternalPluginScripts();
            return {
                status: changed ? 'updated' : 'unchanged',
                pluginPath: this.externalPluginScriptPath,
                emitScriptPath: this.externalEmitScriptPath,
                detail: changed
                    ? `synced scripts to ${this.pluginsDir}`
                    : `scripts already synced to ${this.pluginsDir}`,
            };
        } catch (error) {
            return {
                status: 'failed',
                pluginPath: this.externalPluginScriptPath,
                emitScriptPath: this.externalEmitScriptPath,
                detail: String(error),
            };
        }
    }

    private async ensureExternalPluginScripts(): Promise<boolean> {
        await fs.mkdir(this.pluginsDir, { recursive: true });

        const pluginChanged = await syncFile(this.adapterPluginScriptPath, this.externalPluginScriptPath, 0o644);
        const emitChanged = await syncFile(this.adapterEmitScriptPath, this.externalEmitScriptPath, 0o755);
        await fs.chmod(this.externalEmitScriptPath, 0o755);
        return pluginChanged || emitChanged;
    }
}

async function syncFile(sourcePath: string, destinationPath: string, mode: number): Promise<boolean> {
    const sourceContent = await fs.readFile(sourcePath, 'utf8');
    let destinationContent = '';
    try {
        destinationContent = await fs.readFile(destinationPath, 'utf8');
    } catch (error) {
        const code = (error as NodeJS.ErrnoException).code;
        if (code !== 'ENOENT') {
            throw error;
        }
    }

    if (destinationContent === sourceContent) {
        return false;
    }

    await fs.writeFile(destinationPath, sourceContent, { encoding: 'utf8', mode });
    return true;
}
