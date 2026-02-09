import { AgentEventPayloadV1, AgentEventSource, AgentEventStatus, AgentEventType } from './types';

const ESC = '\x1b';
const BEL = '\x07';
const OSC_PREFIX = `${ESC}]`;
const ST = `${ESC}\\`;
const STRUCTURED_TITLE = 'AGENT_TASK_EVENT_V1';

interface ParserCallbacks {
    onStructured: (payload: AgentEventPayloadV1) => void;
    onDebug?: (message: string) => void;
}

export class AgentOutputParser {
    private streamBuffer = '';

    constructor(private readonly callbacks: ParserCallbacks) { }

    feed(chunk: string): void {
        this.streamBuffer += chunk;
        this.processBuffer();
    }

    flush(): void {
        this.streamBuffer = '';
    }

    private processBuffer(): void {
        let cursor = 0;

        while (cursor < this.streamBuffer.length) {
            const oscStart = this.streamBuffer.indexOf(OSC_PREFIX, cursor);
            if (oscStart === -1) {
                this.streamBuffer = '';
                return;
            }

            const contentStart = oscStart + OSC_PREFIX.length;
            const belEnd = this.streamBuffer.indexOf(BEL, contentStart);
            const stEnd = this.streamBuffer.indexOf(ST, contentStart);

            let oscEnd = -1;
            let terminatorLength = 0;
            if (belEnd !== -1 && (stEnd === -1 || belEnd < stEnd)) {
                oscEnd = belEnd;
                terminatorLength = 1;
            } else if (stEnd !== -1) {
                oscEnd = stEnd;
                terminatorLength = 2;
            } else {
                this.streamBuffer = this.streamBuffer.slice(oscStart);
                return;
            }

            const oscContent = this.streamBuffer.slice(contentStart, oscEnd).trim();
            this.tryParseStructuredEvent(oscContent);
            cursor = oscEnd + terminatorLength;
        }

        this.streamBuffer = '';
    }

    private tryParseStructuredEvent(content: string): void {
        if (!content.startsWith('777;notify;')) {
            return;
        }

        const rest = content.slice('777;notify;'.length);
        const splitIndex = rest.indexOf(';');
        if (splitIndex === -1) {
            this.callbacks.onDebug?.('Structured OSC skipped: missing title separator');
            return;
        }

        const title = rest.slice(0, splitIndex);
        if (title !== STRUCTURED_TITLE) {
            this.callbacks.onDebug?.(`Structured OSC skipped: unexpected title "${title}"`);
            return;
        }

        const encodedPayload = rest.slice(splitIndex + 1).trim();
        const decoded = decodeBase64Url(encodedPayload);
        if (!decoded) {
            this.callbacks.onDebug?.('Structured OSC skipped: base64 decode failed');
            return;
        }

        let parsed: unknown;
        try {
            parsed = JSON.parse(decoded);
        } catch {
            this.callbacks.onDebug?.('Structured OSC skipped: invalid JSON payload');
            return;
        }

        const payload = validatePayload(parsed);
        if (!payload) {
            this.callbacks.onDebug?.('Structured OSC skipped: schema validation failed');
            return;
        }

        this.callbacks.onStructured(payload);
    }
}

function decodeBase64Url(input: string): string | undefined {
    if (!input) {
        return undefined;
    }

    const normalized = input.replace(/-/g, '+').replace(/_/g, '/');
    const padded = normalized + '='.repeat((4 - (normalized.length % 4)) % 4);

    try {
        return Buffer.from(padded, 'base64').toString('utf8');
    } catch {
        return undefined;
    }
}

function validatePayload(value: unknown): AgentEventPayloadV1 | undefined {
    if (!value || typeof value !== 'object') {
        return undefined;
    }

    const record = value as Record<string, unknown>;
    if (record.version !== 1) {
        return undefined;
    }

    if (!isSource(record.source) || !isEventType(record.event) || !isStatus(record.status)) {
        return undefined;
    }

    if (typeof record.message !== 'string') {
        return undefined;
    }

    if (typeof record.createdAt !== 'number' || !Number.isFinite(record.createdAt)) {
        return undefined;
    }

    return {
        version: 1,
        source: record.source,
        event: record.event,
        status: record.status,
        title: maybeString(record.title),
        message: record.message,
        createdAt: record.createdAt,
        sessionId: maybeString(record.sessionId),
        taskId: maybeString(record.taskId),
        turnId: maybeString(record.turnId),
        dedupeKey: maybeString(record.dedupeKey),
    };
}

function maybeString(value: unknown): string | undefined {
    return typeof value === 'string' && value.length > 0 ? value : undefined;
}

function isSource(value: unknown): value is AgentEventSource {
    return value === 'codex' || value === 'claude' || value === 'opencode';
}

function isEventType(value: unknown): value is AgentEventType {
    return value === 'turn_complete'
        || value === 'approval_requested'
        || value === 'stop'
        || value === 'subagent_stop';
}

function isStatus(value: unknown): value is AgentEventStatus {
    return value === 'success' || value === 'info' || value === 'warning';
}
