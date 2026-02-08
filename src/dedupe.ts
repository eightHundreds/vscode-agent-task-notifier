import { AgentEvent } from './types';
import { Logger } from './logger';

export class EventDedupe {
    private readonly eventTimestamps = new Map<string, number>();

    constructor(
        private readonly dedupeWindowMsProvider: () => number,
        private readonly logger: Logger,
    ) { }

    shouldEmit(event: AgentEvent): boolean {
        const now = Date.now();
        const windowMs = Math.max(0, this.dedupeWindowMsProvider());
        this.prune(now, windowMs);

        const key = this.buildKey(event);
        const lastSeen = this.eventTimestamps.get(key);

        if (lastSeen !== undefined && now - lastSeen < windowMs) {
            this.logger.debug(`Suppressed duplicate event ${key}`);
            return false;
        }

        this.eventTimestamps.set(key, now);
        return true;
    }

    private buildKey(event: AgentEvent): string {
        if (event.dedupeKey) {
            return `${event.terminalId}:${event.dedupeKey}`;
        }

        const normalizedMessage = event.message.trim().toLowerCase().replace(/\s+/g, ' ');
        return `${event.terminalId}:${event.source}:${event.event}:${event.status}:${normalizedMessage}`;
    }

    private prune(now: number, windowMs: number): void {
        const threshold = now - Math.max(windowMs * 4, 60_000);
        for (const [key, timestamp] of this.eventTimestamps) {
            if (timestamp < threshold) {
                this.eventTimestamps.delete(key);
            }
        }
    }
}
