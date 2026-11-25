import {
  EMPTY_SCHEDULE, migrateSchedule, updateCounting, MAX_SAMPLE_GAP_MS, recordUsage, resolveScheduledStart, SCHEDULE_KEY,
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
  const now = Date.now();
  const raw = stored[SCHEDULE_KEY] ?? EMPTY_SCHEDULE;
  const schedule = migrateSchedule(raw, now);
  if (raw !== schedule) await webext.storage.local.set({ [SCHEDULE_KEY]: schedule });

  switch (message.type) {
    case 'SAVE_SCHEDULE': {
      const rules = message.rules ?? schedule.rules;
      validateSchedule(message.enabled, rules);
      const rulesChanged = JSON.stringify(rules) !== JSON.stringify(schedule.rules);
      const enabledChanged = message.enabled !== schedule.enabled;
      const usage = { ...schedule.usage };
      if (rulesChanged || enabledChanged) {
        for (const [key, entry] of Object.entries(usage)) {
          const [year, month, day] = key.split('-').map(Number);
          if (year === undefined || month === undefined || day === undefined) continue;
          const weekday = new Date(year, month - 1, day).getDay();
          const oldRule = schedule.rules.find((rule) => rule.days.includes(weekday));
          const newRule = rules.find((rule) => rule.days.includes(weekday));
          const retained = { ...entry, countingUntil: 0 };
          if (!oldRule || !newRule || oldRule.id !== newRule.id || oldRule.start !== newRule.start ||
              oldRule.end !== newRule.end || oldRule.windowEnabled !== newRule.windowEnabled) {
            delete retained.closesAtOverride;
          }
          if (!oldRule || !newRule || oldRule.id !== newRule.id || oldRule.limitMinutes !== newRule.limitMinutes ||
              oldRule.resetTime !== newRule.resetTime || oldRule.limitEnabled !== newRule.limitEnabled) {
            delete retained.limitOverrideMs;
          }
          usage[key] = retained;
        }
      }
      const next: ScheduleState = { ...schedule, enabled: message.enabled, rules, usage };
      if (rulesChanged) delete next.legacyCarry;
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
      const sample = { at: now, visible: message.visible, playing: message.playing };
      const charged = previous ? recordUsage(schedule, previous.at, now, previous) : schedule;
      const activeSamples = [...samples].filter(([key, cursor]) => key !== id && now - cursor.at < 2500);
      const next = updateCounting(charged, now, [sample, ...activeSamples.map(([, cursor]) => cursor)]);
      if (next !== schedule) await webext.storage.local.set({ [SCHEDULE_KEY]: next });
      samples.set(id, sample);
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
