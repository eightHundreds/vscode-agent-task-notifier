import * as os from 'node:os';
import * as path from 'node:path';
import { promises as fs } from 'node:fs';
import * as vscode from 'vscode';
import { Logger } from './logger';

const MANAGED_START = '# >>> agent-task-notifier managed notify';
const MANAGED_END = '# <<< agent-task-notifier managed notify';

export type CodexConfigResultStatus = 'updated' | 'unchanged' | 'failed';

export interface CodexConfigResult {
    status: CodexConfigResultStatus;
    configPath: string;
    detail: string;
}

export function isCodexCommand(commandLine: string): boolean {
    return /\bcodex(\s|$)/i.test(commandLine);
}

export class CodexNotifyBootstrap {
    private readonly codexHome = path.join(os.homedir(), '.codex');
    private readonly configPath = path.join(this.codexHome, 'config.toml');
    private readonly adapterScriptPath: string;
    private readonly externalNotifyScriptPath: string;

    constructor(
        private readonly context: vscode.ExtensionContext,
        private readonly logger: Logger,
    ) {
        this.adapterScriptPath = path.join(context.extensionPath, 'adapters', 'codex', 'notify.sh');
        this.externalNotifyScriptPath = path.join(this.codexHome, 'agent-task-notifier', 'notify.sh');
    }

    async handleCodexCommandDetected(): Promise<void> {
        const result = await this.ensureConfiguredInternal();

        if (result.status === 'updated') {
            this.logger.info(`Codex notify config rewritten: ${result.detail}`);
            void vscode.window.showInformationMessage(vscode.l10n.t('Codex notify configuration was auto-updated. Restart the current codex process to apply changes.'));
        } else if (result.status === 'unchanged') {
            this.logger.info(`Codex notify script synced: ${result.detail}`);
        } else {
            this.logger.warn(`Codex config rewrite failed: ${result.detail}`);
            void vscode.window.showWarningMessage(vscode.l10n.t('Failed to auto-configure Codex notify. See Agent Task Notifier logs for details.'));
        }
    }

    async repairNow(): Promise<void> {
        const result = await this.ensureConfiguredInternal();
        if (result.status === 'updated') {
            this.logger.info(`Manual codex notify repair applied: ${result.detail}`);
            void vscode.window.showInformationMessage(vscode.l10n.t('Codex notify configuration repaired. Restart the current codex process.'));
            return;
        }
        if (result.status === 'unchanged') {
            this.logger.info(`Manual codex notify repair not needed: ${result.detail}`);
            void vscode.window.showInformationMessage(vscode.l10n.t('Codex notify configuration is already up to date.'));
            return;
        }

        this.logger.warn(`Manual codex notify repair failed: ${result.detail}`);
        void vscode.window.showWarningMessage(vscode.l10n.t('Failed to repair Codex notify configuration. See logs for details.'));
    }

    getPaths(): { configPath: string; externalScriptPath: string } {
        return {
            configPath: this.configPath,
            externalScriptPath: this.externalNotifyScriptPath,
        };
    }

    private async ensureConfiguredInternal(): Promise<CodexConfigResult> {
        try {
            await this.ensureExternalNotifyScript();
            const originalText = await this.readConfigText();
            const nextText = buildNextConfigText(originalText, this.externalNotifyScriptPath);
            if (nextText === originalText) {
                return {
                    status: 'unchanged',
                    configPath: this.configPath,
                    detail: `script synced to ${this.externalNotifyScriptPath}; config already managed`,
                };
            }

            await fs.mkdir(path.dirname(this.configPath), { recursive: true });
            await fs.writeFile(this.configPath, nextText, 'utf8');
            return {
                status: 'updated',
                configPath: this.configPath,
                detail: `rewritten ${this.configPath}`,
            };
        } catch (error) {
            return {
                status: 'failed',
                configPath: this.configPath,
                detail: String(error),
            };
        }
    }

    private async ensureExternalNotifyScript(): Promise<void> {
        await fs.mkdir(path.dirname(this.externalNotifyScriptPath), { recursive: true });
        const scriptContent = await fs.readFile(this.adapterScriptPath, 'utf8');
        await fs.writeFile(this.externalNotifyScriptPath, scriptContent, { encoding: 'utf8', mode: 0o755 });
        await fs.chmod(this.externalNotifyScriptPath, 0o755);
    }

    private async readConfigText(): Promise<string> {
        try {
            return await fs.readFile(this.configPath, 'utf8');
        } catch (error) {
            const code = (error as NodeJS.ErrnoException).code;
            if (code === 'ENOENT') {
                return '';
            }
            throw error;
        }
    }
}

function buildNextConfigText(originalText: string, scriptPath: string): string {
    const withoutManaged = removeManagedBlock(originalText);
    const commentedLegacy = commentLegacyNotifyAssignments(withoutManaged);
    const managedBlock = buildManagedBlock(scriptPath);
    return insertManagedBlockAtRoot(commentedLegacy, managedBlock);
}

function removeManagedBlock(text: string): string {
    const lines = splitLines(text);
    const nextLines: string[] = [];
    let inManagedBlock = false;

    for (const line of lines) {
        if (!inManagedBlock && line.trim() === MANAGED_START) {
            inManagedBlock = true;
            continue;
        }
        if (inManagedBlock) {
            if (line.trim() === MANAGED_END) {
                inManagedBlock = false;
            }
            continue;
        }
        nextLines.push(line);
    }

    return nextLines.join('\n');
}

function commentLegacyNotifyAssignments(text: string): string {
    const lines = splitLines(text);
    const output = [...lines];

    let index = 0;
    while (index < output.length) {
        const line = output[index];
        if (!isLegacyNotifyStart(line)) {
            index += 1;
            continue;
        }

        let end = index;
        let bracketBalance = countBracketDelta(line);
        while (bracketBalance > 0 && end + 1 < output.length) {
            end += 1;
            bracketBalance += countBracketDelta(output[end]);
        }

        for (let pointer = index; pointer <= end; pointer += 1) {
            output[pointer] = `# ${output[pointer]}`;
        }
        index = end + 1;
    }

    return output.join('\n');
}

function isLegacyNotifyStart(line: string): boolean {
    const trimmed = line.trimStart();
    if (trimmed.startsWith('#')) {
        return false;
    }
    return /^notify\s*=/.test(trimmed);
}

function countBracketDelta(line: string): number {
    const openCount = (line.match(/\[/g) ?? []).length;
    const closeCount = (line.match(/\]/g) ?? []).length;
    return openCount - closeCount;
}

function buildManagedBlock(scriptPath: string): string {
    const escapedPath = escapeTomlBasicString(scriptPath);
    return [
        MANAGED_START,
        `notify = ["bash", "${escapedPath}"]`,
        MANAGED_END,
    ].join('\n');
}

function escapeTomlBasicString(value: string): string {
    return value
        .replace(/\\/g, '\\\\')
        .replace(/"/g, '\\"');
}

function splitLines(text: string): string[] {
    if (!text) {
        return [];
    }
    return text.replace(/\r\n/g, '\n').replace(/\r/g, '\n').split('\n');
}

function insertManagedBlockAtRoot(text: string, managedBlock: string): string {
    const lines = splitLines(text);
    const firstTableIndex = lines.findIndex((line) => isTableHeaderLine(line));
    if (firstTableIndex === -1) {
        const trimmed = text.replace(/\s+$/g, '');
        if (!trimmed) {
            return `${managedBlock}\n`;
        }
        return `${trimmed}\n\n${managedBlock}\n`;
    }

    const before = trimTrailingBlankLines(lines.slice(0, firstTableIndex));
    const after = trimLeadingBlankLines(lines.slice(firstTableIndex));
    const sections: string[] = [];

    if (before.length > 0) {
        sections.push(before.join('\n'));
    }
    sections.push(managedBlock);
    if (after.length > 0) {
        sections.push(after.join('\n'));
    }

    return `${sections.join('\n\n').replace(/\s+$/g, '')}\n`;
}

function isTableHeaderLine(line: string): boolean {
    const trimmed = line.trimStart();
    if (trimmed.startsWith('#')) {
        return false;
    }
    return trimmed.startsWith('[');
}

function trimLeadingBlankLines(lines: string[]): string[] {
    let start = 0;
    while (start < lines.length && lines[start].trim() === '') {
        start += 1;
    }
    return lines.slice(start);
}

function trimTrailingBlankLines(lines: string[]): string[] {
    let end = lines.length;
    while (end > 0 && lines[end - 1].trim() === '') {
        end -= 1;
    }
    return lines.slice(0, end);
}
