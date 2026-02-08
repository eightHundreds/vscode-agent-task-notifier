import * as os from 'node:os';
import * as path from 'node:path';
import { promises as fs } from 'node:fs';
import * as vscode from 'vscode';
import { Logger } from './logger';

const HOOK_EVENT_STOP = 'Stop';
const HOOK_EVENT_SUBAGENT_STOP = 'SubagentStop';

export type ClaudeConfigResultStatus = 'updated' | 'unchanged' | 'failed';

export interface ClaudeConfigResult {
    status: ClaudeConfigResultStatus;
    configPath: string;
    detail: string;
}

export function isClaudeCommand(commandLine: string): boolean {
    return /\bclaude(\s|$)/i.test(commandLine);
}

export class ClaudeHooksBootstrap {
    private readonly claudeHome = path.join(os.homedir(), '.claude');
    private readonly settingsPath = path.join(this.claudeHome, 'settings.json');
    private readonly adapterStopScriptPath: string;
    private readonly adapterSubagentStopScriptPath: string;
    private readonly externalStopScriptPath: string;
    private readonly externalSubagentStopScriptPath: string;

    constructor(
        private readonly context: vscode.ExtensionContext,
        private readonly logger: Logger,
    ) {
        this.adapterStopScriptPath = path.join(context.extensionPath, 'adapters', 'claude', 'stop-hook.sh');
        this.adapterSubagentStopScriptPath = path.join(context.extensionPath, 'adapters', 'claude', 'subagent-stop-hook.sh');
        this.externalStopScriptPath = path.join(this.claudeHome, 'agent-task-notifier', 'stop-hook.sh');
        this.externalSubagentStopScriptPath = path.join(this.claudeHome, 'agent-task-notifier', 'subagent-stop-hook.sh');
    }

    async handleClaudeCommandDetected(): Promise<void> {
        const result = await this.ensureConfiguredInternal();

        if (result.status === 'updated') {
            this.logger.info(`Claude hooks config rewritten: ${result.detail}`);
            void vscode.window.showInformationMessage(vscode.l10n.t('Claude hooks configuration was auto-updated. Restart the current claude process to apply changes.'));
        } else if (result.status === 'unchanged') {
            this.logger.info(`Claude hook scripts synced: ${result.detail}`);
        } else {
            this.logger.warn(`Claude hooks rewrite failed: ${result.detail}`);
            void vscode.window.showWarningMessage(vscode.l10n.t('Failed to auto-configure Claude hooks. See Agent Task Notifier logs for details.'));
        }
    }

    async repairNow(): Promise<void> {
        const result = await this.ensureConfiguredInternal();
        if (result.status === 'updated') {
            this.logger.info(`Manual Claude hooks repair applied: ${result.detail}`);
            void vscode.window.showInformationMessage(vscode.l10n.t('Claude hooks configuration repaired. Restart the current claude process.'));
            return;
        }
        if (result.status === 'unchanged') {
            this.logger.info(`Manual Claude hooks repair not needed: ${result.detail}`);
            void vscode.window.showInformationMessage(vscode.l10n.t('Claude hooks configuration is already up to date.'));
            return;
        }

        this.logger.warn(`Manual Claude hooks repair failed: ${result.detail}`);
        void vscode.window.showWarningMessage(vscode.l10n.t('Failed to repair Claude hooks configuration. See logs for details.'));
    }

    getPaths(): {
        configPath: string;
        externalStopScriptPath: string;
        externalSubagentStopScriptPath: string;
    } {
        return {
            configPath: this.settingsPath,
            externalStopScriptPath: this.externalStopScriptPath,
            externalSubagentStopScriptPath: this.externalSubagentStopScriptPath,
        };
    }

    private async ensureConfiguredInternal(): Promise<ClaudeConfigResult> {
        try {
            await this.ensureExternalHookScripts();
            const originalText = await this.readSettingsText();
            const stopCommand = buildShellCommand(this.externalStopScriptPath);
            const subagentStopCommand = buildShellCommand(this.externalSubagentStopScriptPath);
            const nextText = buildNextSettingsText(originalText, stopCommand, subagentStopCommand);
            if (nextText === originalText) {
                return {
                    status: 'unchanged',
                    configPath: this.settingsPath,
                    detail: `scripts synced to ${path.dirname(this.externalStopScriptPath)}; settings already managed`,
                };
            }

            await fs.mkdir(path.dirname(this.settingsPath), { recursive: true });
            await fs.writeFile(this.settingsPath, nextText, 'utf8');
            return {
                status: 'updated',
                configPath: this.settingsPath,
                detail: `rewritten ${this.settingsPath}`,
            };
        } catch (error) {
            return {
                status: 'failed',
                configPath: this.settingsPath,
                detail: String(error),
            };
        }
    }

    private async ensureExternalHookScripts(): Promise<void> {
        await fs.mkdir(path.dirname(this.externalStopScriptPath), { recursive: true });
        const stopScriptContent = await fs.readFile(this.adapterStopScriptPath, 'utf8');
        const subagentStopScriptContent = await fs.readFile(this.adapterSubagentStopScriptPath, 'utf8');
        await fs.writeFile(this.externalStopScriptPath, stopScriptContent, { encoding: 'utf8', mode: 0o755 });
        await fs.writeFile(this.externalSubagentStopScriptPath, subagentStopScriptContent, { encoding: 'utf8', mode: 0o755 });
        await fs.chmod(this.externalStopScriptPath, 0o755);
        await fs.chmod(this.externalSubagentStopScriptPath, 0o755);
    }

    private async readSettingsText(): Promise<string> {
        try {
            return await fs.readFile(this.settingsPath, 'utf8');
        } catch (error) {
            const code = (error as NodeJS.ErrnoException).code;
            if (code === 'ENOENT') {
                return '';
            }
            throw error;
        }
    }
}

function buildNextSettingsText(
    originalText: string,
    stopCommand: string,
    subagentStopCommand: string,
): string {
    const root = parseSettingsObject(originalText);
    const hooks = ensureHooksObject(root);
    upsertCommandHook(hooks, HOOK_EVENT_STOP, stopCommand, 'stop-hook.sh');
    upsertCommandHook(hooks, HOOK_EVENT_SUBAGENT_STOP, subagentStopCommand, 'subagent-stop-hook.sh');
    return `${JSON.stringify(root, null, 2)}\n`;
}

function parseSettingsObject(text: string): Record<string, unknown> {
    if (!text.trim()) {
        return {};
    }

    let parsed: unknown;
    try {
        parsed = JSON.parse(text);
    } catch (error) {
        throw new Error(`Failed to parse Claude settings JSON: ${String(error)}`);
    }

    if (!isRecord(parsed)) {
        throw new Error('Invalid Claude settings JSON: expected an object at root');
    }
    return parsed;
}

function ensureHooksObject(root: Record<string, unknown>): Record<string, unknown> {
    const existing = root.hooks;
    if (existing === undefined) {
        const hooks: Record<string, unknown> = {};
        root.hooks = hooks;
        return hooks;
    }
    if (!isRecord(existing)) {
        throw new Error('Invalid Claude settings JSON: expected "hooks" to be an object');
    }
    return existing;
}

function upsertCommandHook(
    hooks: Record<string, unknown>,
    eventName: string,
    command: string,
    scriptFileName: string,
): void {
    const existing = hooks[eventName];
    const groups = normalizeHookGroups(eventName, existing);
    const withoutManaged = removeManagedCommands(groups, scriptFileName, command);
    if (!hasExactCommand(withoutManaged, command)) {
        withoutManaged.push({
            hooks: [
                {
                    type: 'command',
                    command,
                },
            ],
        });
    }
    hooks[eventName] = withoutManaged;
}

function normalizeHookGroups(eventName: string, value: unknown): Record<string, unknown>[] {
    if (value === undefined) {
        return [];
    }
    if (!Array.isArray(value)) {
        throw new Error(`Invalid Claude settings JSON: expected hooks.${eventName} to be an array`);
    }

    return value.map((entry, index) => {
        if (!isRecord(entry)) {
            throw new Error(`Invalid Claude settings JSON: expected hooks.${eventName}[${index}] to be an object`);
        }
        return entry;
    });
}

function removeManagedCommands(
    groups: Record<string, unknown>[],
    scriptFileName: string,
    exactCommand: string,
): Record<string, unknown>[] {
    const nextGroups: Record<string, unknown>[] = [];

    for (const group of groups) {
        const hooksValue = group.hooks;
        if (!Array.isArray(hooksValue)) {
            throw new Error('Invalid Claude settings JSON: each hook group must include a hooks array');
        }

        const nextHooks: Record<string, unknown>[] = [];
        for (let index = 0; index < hooksValue.length; index += 1) {
            const hook = hooksValue[index];
            if (!isRecord(hook)) {
                throw new Error('Invalid Claude settings JSON: each hook entry must be an object');
            }

            const type = hook.type;
            const hookCommand = hook.command;
            if (type === 'command' && typeof hookCommand === 'string') {
                if (hookCommand === exactCommand) {
                    nextHooks.push(hook);
                    continue;
                }
                if (isManagedCommandForScript(hookCommand, scriptFileName)) {
                    continue;
                }
            }
            nextHooks.push(hook);
        }

        if (nextHooks.length === 0) {
            continue;
        }
        nextGroups.push({
            ...group,
            hooks: nextHooks,
        });
    }

    return nextGroups;
}

function hasExactCommand(groups: Record<string, unknown>[], command: string): boolean {
    for (const group of groups) {
        const hooksValue = group.hooks;
        if (!Array.isArray(hooksValue)) {
            continue;
        }
        for (const hook of hooksValue) {
            if (!isRecord(hook)) {
                continue;
            }
            if (hook.type === 'command' && hook.command === command) {
                return true;
            }
        }
    }
    return false;
}

function isManagedCommandForScript(command: string, scriptFileName: string): boolean {
    const normalized = command.replace(/\\/g, '/');
    if (scriptFileName === 'stop-hook.sh' && normalized.includes('subagent-stop-hook.sh')) {
        return false;
    }
    return normalized.includes(`/adapters/claude/${scriptFileName}`)
        || normalized.includes(`/agent-task-notifier/${scriptFileName}`);
}

function buildShellCommand(scriptPath: string): string {
    return `bash ${shellDoubleQuote(scriptPath)}`;
}

function shellDoubleQuote(value: string): string {
    return `"${value
        .replace(/\\/g, '\\\\')
        .replace(/"/g, '\\"')
        .replace(/\$/g, '\\$')
        .replace(/`/g, '\\`')}"`;
}

function isRecord(value: unknown): value is Record<string, unknown> {
    return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
}
