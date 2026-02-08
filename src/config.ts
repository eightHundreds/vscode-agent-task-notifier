import * as vscode from 'vscode';

export const CONFIG_SECTION = 'agentTaskNotifier';
export type LogLevel = 'error' | 'warn' | 'info' | 'debug';

export function getSetting<T>(key: string, defaultValue: T): T {
    return vscode.workspace.getConfiguration(CONFIG_SECTION).get<T>(key, defaultValue);
}

export function isExtensionEnabled(): boolean {
    return getSetting<boolean>('enabled', true);
}

export function useOsNotifications(): boolean {
    return getSetting<boolean>('osNotification', true);
}

export function useVsCodeToast(): boolean {
    return getSetting<boolean>('vscodeToast', true);
}

export function getDedupeWindowMs(): number {
    return getSetting<number>('dedupeWindowMs', 3000);
}

export function isStrictWindowRouting(): boolean {
    return getSetting<boolean>('strictWindowRouting', true);
}

export function getLogLevel(): LogLevel {
    const value = getSetting<string>('logLevel', 'info');
    if (value === 'error' || value === 'warn' || value === 'info' || value === 'debug') {
        return value;
    }
    return 'info';
}

export async function setEnabledSetting(enabled: boolean): Promise<void> {
    await vscode.workspace
        .getConfiguration(CONFIG_SECTION)
        .update('enabled', enabled, vscode.ConfigurationTarget.Global);
}
