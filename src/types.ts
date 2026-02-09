import * as vscode from 'vscode';

export type AgentEventSource = 'codex' | 'claude' | 'opencode';
export type AgentEventType = 'turn_complete' | 'approval_requested' | 'stop' | 'subagent_stop';
export type AgentEventStatus = 'success' | 'info' | 'warning';

export interface AgentEventPayloadV1 {
    version: 1;
    source: AgentEventSource;
    event: AgentEventType;
    status: AgentEventStatus;
    title?: string;
    message: string;
    createdAt: number;
    sessionId?: string;
    taskId?: string;
    turnId?: string;
    dedupeKey?: string;
}

export interface AgentEvent extends AgentEventPayloadV1 {
    terminal: vscode.Terminal;
    terminalId: string;
}
