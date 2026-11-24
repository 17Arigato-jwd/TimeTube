import { resolveBudgetBounds } from './policy';
import type { BudgetSpec, PersistedSessionState } from './types';

export const SCHEDULE_KEY = 'timeTubeSchedule';
export const DAY_NAMES = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];
export const MINUTE_MS = 60_000;
export const MAX_SAMPLE_GAP_MS = 10_000;

export interface ScheduleRule {
  id: string;
  days: number[];
  start: string;
  end: string;
  limitMinutes: number;
  mode: 'site' | 'playback';
}

interface OccurrenceUsage {
  usedMs: number;
  recent: Array<[number, number]>;
  extra?: { closesAt: number; limitMs: number };
}

export interface ScheduleState {
  enabled: boolean;
  rules: ScheduleRule[];
  usage: Record<string, OccurrenceUsage>;
}

export const EMPTY_SCHEDULE: ScheduleState = { enabled: false, rules: [], usage: {} };

interface Occurrence {
  key: string;
  rule: ScheduleRule;
  opensAt: number;
  closesAt: number;
  limitMs: number;
}

export type ScheduleStatus =
  | { kind: 'off' | 'unassigned' }
  | { kind: 'closed' | 'spent'; nextOpen: number | null }
  | ({ kind: 'open'; remainingMs: number } & Occurrence);

export function ruleLabel(days: number[]): string {
  const ordered = [1, 2, 3, 4, 5, 6, 0].filter((day) => days.includes(day));
  if (ordered.length === 7) return 'Every day';
  if (ordered.join() === '1,2,3,4,5') return 'Weekdays';
  if (ordered.join() === '6,0') return 'Weekends';
  return ordered.map((day) => DAY_NAMES[day]).join(', ');
}

export function validateSchedule(enabled: boolean, rules: ScheduleRule[]): void {
  if (enabled && !rules.length) throw new Error('Add a rule before enabling the schedule.');
  const owners = new Map<number, ScheduleRule>();
  const ids = new Set<string>();
  for (const rule of rules) {
    if (!rule.id || ids.has(rule.id)) throw new Error('Each rule must have a unique ID.');
    ids.add(rule.id);
    if (!rule.days.length) throw new Error('Select at least one day.');
    for (const day of rule.days) {
      if (!Number.isInteger(day) || day < 0 || day > 6) throw new Error('Select a valid day.');
      const owner = owners.get(day);
      if (owner) throw new Error(`${DAY_NAMES[day]} already belongs to the ${ruleLabel(owner.days)} rule.`);
      owners.set(day, rule);
    }
    const time = /^(?:[01]\d|2[0-3]):[0-5]\d$/;
    if (!time.test(rule.start) || !time.test(rule.end) || rule.start === rule.end) {
      throw new Error('Choose different start and end times.');
    }
    if (!Number.isInteger(rule.limitMinutes) || rule.limitMinutes < 1 || rule.limitMinutes > 1440) {
      throw new Error('Enter a daily limit between 1 and 1,440 minutes.');
    }
    if (rule.mode !== 'site' && rule.mode !== 'playback') throw new Error('Choose how to count usage.');
  }
}

function dateKey(date: Date): string {
  return [date.getFullYear(), date.getMonth() + 1, date.getDate()]
    .map((part) => String(part).padStart(2, '0')).join('-');
}

function atTime(day: Date, time: string, nextDay = false): number {
  const [hour = 0, minute = 0] = time.split(':').map(Number);
  return new Date(day.getFullYear(), day.getMonth(), day.getDate() + Number(nextDay), hour, minute).getTime();
}

function occurrences(state: ScheduleState, now: number, lastOffset: number): Occurrence[] {
  const date = new Date(now);
  const windows: Occurrence[] = [];
  for (let offset = -2; offset <= lastOffset; offset++) {
    const day = new Date(date.getFullYear(), date.getMonth(), date.getDate() + offset);
    const rule = state.rules.find((item) => item.days.includes(day.getDay()));
    if (!rule) continue;
    const key = dateKey(day);
    const exception = state.usage[key]?.extra;
    const opensAt = atTime(day, rule.start);
    const closesAt = Math.max(atTime(day, rule.end, rule.end < rule.start), exception?.closesAt ?? 0);
    windows.push({ key, rule, opensAt, closesAt, limitMs: Math.max(rule.limitMinutes * MINUTE_MS, exception?.limitMs ?? 0) });
  }
  return windows;
}

export function getScheduleStatus(state: ScheduleState, now: number): ScheduleStatus {
  if (!state.enabled) return { kind: 'off' };
  const today = dateKey(new Date(now));
  const windows = occurrences(state, now, 7);
  const open = windows.filter((window) => window.opensAt <= now && now < window.closesAt);
  for (const window of open) {
    const remainingMs = window.limitMs - (state.usage[window.key]?.usedMs ?? 0);
    if (remainingMs > 0) return { kind: 'open', ...window, remainingMs };
  }
  if (!open.length && !windows.some((window) => window.key === today)) return { kind: 'unassigned' };
  const candidates = windows.flatMap(({ opensAt, closesAt }) => [opensAt, closesAt]);
  const date = new Date(now);
  for (let offset = 1; offset <= 7; offset++) {
    candidates.push(new Date(date.getFullYear(), date.getMonth(), date.getDate() + offset).getTime());
  }
  const nextOpen = candidates.filter((time) => time > now).sort((a, b) => a - b).find((time) => {
    const current = windows.filter(({ opensAt, closesAt }) => opensAt <= time && time < closesAt);
    if (current.length) return current.some(({ key, limitMs }) => (state.usage[key]?.usedMs ?? 0) < limitMs);
    const day = dateKey(new Date(time));
    return !windows.some((window) => window.key === day);
  }) ?? null;
  return { kind: open.length ? 'spent' : 'closed', nextOpen };
}

export function recordUsage(state: ScheduleState, start: number, end: number): ScheduleState {
  if (end <= start || end - start > MAX_SAMPLE_GAP_MS) return state;
  const status = getScheduleStatus(state, start);
  const window = status.kind === 'open' ? status : getScheduleStatus(state, end - 1);
  if (window.kind !== 'open') return state;
  start = Math.max(start, window.opensAt);
  end = Math.min(end, window.closesAt);
  if (end <= start) return state;
  const previous = state.usage[window.key] ?? { usedMs: 0, recent: [] };
  const recent: OccurrenceUsage['recent'] = [];
  let added = end - start;
  let mergedStart = start;
  let mergedEnd = end;

  for (const [from, to] of previous.recent) {
    if (to < end - MAX_SAMPLE_GAP_MS) continue;
    added -= Math.max(0, Math.min(end, to) - Math.max(start, from));
    if (to < mergedStart || from > mergedEnd) {
      recent.push([from, to]);
    } else {
      mergedStart = Math.min(mergedStart, from);
      mergedEnd = Math.max(mergedEnd, to);
    }
  }
  if (added <= 0) return state;
  recent.push([mergedStart, mergedEnd]);
  recent.sort(([left], [right]) => left - right);
  const oldest = new Date(end);
  oldest.setDate(oldest.getDate() - 7);
  const usage = Object.fromEntries(Object.entries(state.usage).filter(([key]) => key >= dateKey(oldest)));
  usage[window.key] = { ...previous, usedMs: previous.usedMs + added, recent };
  return { ...state, usage };
}

export interface ScheduleChoice {
  action: 'shorten' | 'extra';
  key: string;
  untilAt?: number;
}

export type ScheduledStart =
  | { kind: 'unavailable' }
  | { kind: 'conflict'; key: string; requestedMs: number; availableMs: number; extraUsageMs: number; extraWindowMs: number; untilAt?: number }
  | { kind: 'start'; endsAtMs: number | null; schedule: ScheduleState };

export type ScheduledStartResponse =
  | Exclude<ScheduledStart, { kind: 'start' }>
  | { kind: 'start'; state: PersistedSessionState };

export function resolveScheduledStart(state: ScheduleState, spec: BudgetSpec, now: number, choice?: ScheduleChoice): ScheduledStart {
  const status = getScheduleStatus(state, now);
  if (status.kind === 'closed' || status.kind === 'spent') return { kind: 'unavailable' };
  const { endsAtMs } = resolveBudgetBounds(spec, now);
  if (choice && (status.kind !== 'open' || status.key !== choice.key ||
    (choice.untilAt !== undefined && choice.untilAt !== endsAtMs))) return { kind: 'unavailable' };
  if (status.kind !== 'open' || endsAtMs === null) return { kind: 'start', endsAtMs, schedule: state };

  const availableMs = Math.min(status.remainingMs, status.closesAt - now);
  const requestedMs = endsAtMs - now;
  if (requestedMs <= availableMs) return { kind: 'start', endsAtMs, schedule: state };
  const extraUsageMs = Math.max(0, requestedMs - status.remainingMs);
  const extraWindowMs = Math.max(0, endsAtMs - status.closesAt);
  if (!choice) {
    const untilAt = spec.mode === 'until' ? endsAtMs : undefined;
    return { kind: 'conflict', key: status.key, availableMs, requestedMs, extraUsageMs, extraWindowMs, untilAt };
  }
  if (choice.action === 'shorten') return { kind: 'start', endsAtMs: now + availableMs, schedule: state };

  const usage = state.usage[status.key] ?? { usedMs: 0, recent: [] };
  return {
    kind: 'start',
    endsAtMs,
    schedule: {
      ...state,
      usage: {
        ...state.usage,
        [status.key]: { ...usage, extra: { closesAt: Math.max(status.closesAt, endsAtMs), limitMs: status.limitMs + extraUsageMs } },
      },
    },
  };
}
