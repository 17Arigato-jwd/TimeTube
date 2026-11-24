import {
  EMPTY_SCHEDULE, getScheduleStatus, MAX_SAMPLE_GAP_MS, recordUsage, resolveScheduledStart, SCHEDULE_KEY,
  validateSchedule, type ScheduleState,
} from '../core/schedule';
import type { BudgetSpec, PersistedSessionState, RuntimeMessage } from '../core/types';
import { webext } from '../shared/webext';

export type ScheduleMessage = Extract<RuntimeMessage, {
  type: 'SAVE_SCHEDULE' | 'SCHEDULE_SAMPLE' | 'START_SCHEDULED_SESSION';
}>;

type StartSession = (spec: BudgetSpec, now: number, endsAtMs: number | null, schedule?: ScheduleState) => Promise<PersistedSessionState>;

const samples = new Map<string, { at: number; visible: boolean; playing: boolean }>();
let pending: Promise<unknown> = Promise.resolve();

async function processMessage(
  message: ScheduleMessage,
  sender: unknown,
  startSession: StartSession,
): Promise<unknown> {
  const stored = await webext.storage.local.get<{ [SCHEDULE_KEY]?: ScheduleState }>(SCHEDULE_KEY);
  const schedule = stored[SCHEDULE_KEY] ?? EMPTY_SCHEDULE;
  const now = Date.now();

  switch (message.type) {
    case 'SAVE_SCHEDULE': {
      validateSchedule(message.enabled, message.rules);
      const rulesChanged = JSON.stringify(message.rules) !== JSON.stringify(schedule.rules);
      const usage = rulesChanged
        ? Object.fromEntries(Object.entries(schedule.usage).map(([key, { usedMs, recent }]) => [key, { usedMs, recent }]))
        : schedule.usage;
      const next = { enabled: message.enabled, rules: message.rules, usage };
      await webext.storage.local.set({ [SCHEDULE_KEY]: next });
      if (rulesChanged || message.enabled !== schedule.enabled) samples.clear();
      return next;
    }
    case 'SCHEDULE_SAMPLE': {
      const tabId = (sender as { tab?: { id?: number } } | undefined)?.tab?.id;
      if (tabId === undefined || !schedule.enabled) return;
      const id = `${tabId}:${message.documentId}`;
      const previous = samples.get(id);
      for (const [key, sample] of samples) {
        if (now - sample.at > MAX_SAMPLE_GAP_MS) samples.delete(key);
      }
      samples.set(id, { at: now, visible: message.visible, playing: message.playing });
      if (!previous || now - previous.at > MAX_SAMPLE_GAP_MS) return;
      const before = getScheduleStatus(schedule, previous.at);
      const current = before.kind === 'open' ? before : getScheduleStatus(schedule, now);
      if (current.kind !== 'open' || !(current.rule.mode === 'site' ? previous.visible : previous.playing)) return;
      const next = recordUsage(schedule, previous.at, now);
      if (next !== schedule) await webext.storage.local.set({ [SCHEDULE_KEY]: next });
      return;
    }
    case 'START_SCHEDULED_SESSION': {
      const decision = resolveScheduledStart(schedule, message.spec, now, message.choice);
      if (decision.kind !== 'start') return decision;
      const state = await startSession(
        message.spec, now, decision.endsAtMs, decision.schedule !== schedule ? decision.schedule : undefined,
      );
      return { kind: 'start', state };
    }
  }
}

export function runScheduleMessage(
  message: ScheduleMessage,
  sender: unknown,
  startSession: StartSession,
): Promise<unknown> {
  const next = pending.then(() => processMessage(message, sender, startSession));
  pending = next.catch(() => undefined);
  return next;
}
