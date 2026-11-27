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
  windowEnabled?: boolean;
  limitEnabled?: boolean;
  resetTime?: string;
}

interface OccurrenceUsage {
  usedMs: number;
  recent: Array<[number, number]>;
  // v1 stored both overrides on the window's start date.
  extra?: { closesAt: number; limitMs: number };
  closesAtOverride?: number;
  limitOverrideMs?: number;
  countingUntil?: number;
}

export interface ScheduleState {
  version?: 2;
  // Finish charging an in-flight legacy overnight allowance when its new day is unassigned.
  legacyCarry?: { key: string; ruleId: string; start: number; end: number };
  enabled: boolean;
  rules: ScheduleRule[];
  usage: Record<string, OccurrenceUsage>;
}

export const EMPTY_SCHEDULE: ScheduleState = { version: 2, enabled: false, rules: [], usage: {} };

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
    if (rule.windowEnabled === false && rule.limitEnabled === false) throw new Error('Select an access window or daily limit.');
    if (rule.windowEnabled !== false && (!time.test(rule.start) || !time.test(rule.end) || rule.start === rule.end)) {
      throw new Error('Choose different start and end times.');
    }
    if (rule.limitEnabled === false) continue;
    if (!time.test(rule.resetTime ?? '00:00')) throw new Error('Choose a valid daily reset time.');
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

interface Period {
  key: string;
  rule: ScheduleRule;
  start: number;
  end: number;
}

function localDay(now: number, offset = 0): Date {
  const day = new Date(now);
  day.setHours(0, 0, 0, 0);
  day.setDate(day.getDate() + offset);
  return day;
}

interface Timeline {
  windows: Period[];
  budgets: Period[];
  boundaries: number[];
}

function timeline(state: ScheduleState, now: number, daysAhead: number): Timeline {
  const windows: Period[] = [];
  const budgets: Period[] = [];
  const boundaries = new Set<number>();
  for (let offset = -2; offset <= daysAhead; offset++) {
    const day = localDay(now, offset);
    boundaries.add(day.getTime());
    const rule = state.rules.find((item) => item.days.includes(day.getDay()));
    if (!rule) continue;
    const key = dateKey(day);
    if (rule.windowEnabled !== false) {
      const start = atTime(day, rule.start);
      const end = Math.max(atTime(day, rule.end, rule.end < rule.start), state.usage[key]?.closesAtOverride ?? 0);
      windows.push({ key, rule, start, end });
      boundaries.add(start);
      boundaries.add(end);
    }
    if (rule.limitEnabled !== false) {
      const reset = rule.resetTime ?? '00:00';
      const start = atTime(day, reset);
      const end = atTime(day, reset, true);
      budgets.push({ key, rule, start, end });
      boundaries.add(start);
      boundaries.add(end);
    }
  }
  const carry = state.legacyCarry;
  if (carry && carry.end > now - MAX_SAMPLE_GAP_MS) {
    const rule = state.rules.find((item) => item.id === carry.ruleId && item.limitEnabled !== false);
    if (rule) {
      budgets.push({ key: carry.key, rule, start: carry.start, end: carry.end });
      boundaries.add(carry.end);
    }
  }
  return { windows, budgets, boundaries: [...boundaries].sort((a, b) => a - b) };
}

function includesTime(period: Period, now: number): boolean {
  return period.start <= now && now < period.end;
}

export function migrateSchedule(state: ScheduleState, now: number): ScheduleState {
  if (state.version === 2) return state;
  const usage: ScheduleState['usage'] = {};
  for (const [key, entry] of Object.entries(state.usage)) {
    const { extra, ...balance } = entry;
    usage[key] = extra
      ? { ...balance, closesAtOverride: extra.closesAt, limitOverrideMs: extra.limitMs }
      : balance;
  }
  const migrated: ScheduleState = { ...state, version: 2, usage };
  const { windows, budgets } = timeline(migrated, now, 0);
  const activeBudget = budgets.find((period) => includesTime(period, now));
  const oldWindow = windows.find((period) => includesTime(period, now));
  if (oldWindow && activeBudget && oldWindow.key !== activeBudget.key && usage[oldWindow.key]) {
    // A live overnight window used yesterday's balance before the upgrade.
    const previous = usage[oldWindow.key]!;
    const current = usage[activeBudget.key] ?? { usedMs: 0, recent: [] };
    const balance = { ...current, usedMs: current.usedMs + previous.usedMs };
    if (previous.limitOverrideMs !== undefined) {
      balance.limitOverrideMs = Math.max(current.limitOverrideMs ?? 0, previous.limitOverrideMs);
    }
    usage[activeBudget.key] = balance;
  }
  if (oldWindow && !activeBudget) {
    migrated.legacyCarry = { key: oldWindow.key, ruleId: oldWindow.rule.id, start: now, end: oldWindow.end };
  }
  return migrated;
}

function limitMs(state: ScheduleState, period: Period): number {
  return Math.max(period.rule.limitMinutes * MINUTE_MS, state.usage[period.key]?.limitOverrideMs ?? 0);
}

function remaining(state: ScheduleState, period: Period): number {
  return Math.max(0, limitMs(state, period) - (state.usage[period.key]?.usedMs ?? 0));
}

function currentPeriods(state: ScheduleState, line: Timeline, now: number) {
  const activeWindows = line.windows.filter((item) => includesTime(item, now));
  const today = dateKey(new Date(now));
  const window = activeWindows.at(-1) ?? line.windows.find((item) => item.key === today);
  const budgets = line.budgets.filter((item) => includesTime(item, now));
  // Consecutive rules with different reset times may briefly overlap.
  const budget = budgets.slice().sort((a, b) => remaining(state, a) - remaining(state, b))[0];
  const closed = !!window && !activeWindows.length;
  const spent = !!budget && remaining(state, budget) <= 0;
  return { window, budget, budgets, closed, spent };
}

export interface ScheduleStrip {
  window?: { opensAt: number; closesAt: number };
  budget?: { remainingMs: number; resetsAt: number; counting: boolean };
}

export function getScheduleStrip(raw: ScheduleState, now: number): ScheduleStrip {
  if (!raw.enabled) return {};
  const state = migrateSchedule(raw, now);
  const { window, budget, closed, spent } = currentPeriods(state, timeline(state, now, 0), now);
  const strip: ScheduleStrip = {};
  if (window) strip.window = { opensAt: window.start, closesAt: window.end };
  if (budget) strip.budget = {
    remainingMs: remaining(state, budget),
    resetsAt: budget.end,
    counting: !closed && !spent && (state.usage[budget.key]?.countingUntil ?? 0) > now,
  };
  return strip;
}

export function getScheduleStatus(raw: ScheduleState, now: number): ScheduleStatus {
  if (!raw.enabled) return { kind: 'off' };
  const state = migrateSchedule(raw, now);
  const line = timeline(state, now, 1);
  const { window, budget, budgets, closed, spent } = currentPeriods(state, line, now);
  const active = window ?? budget;
  if (!active) return { kind: 'unassigned' };
  if (closed || spent) {
    const future = timeline(state, now, 8);
    const nextOpen = future.boundaries.find((time) => {
      if (time <= now) return false;
      const status = currentPeriods(state, future, time);
      return !status.closed && !status.spent;
    }) ?? null;
    return { kind: spent ? 'spent' : 'closed', nextOpen };
  }
  const key = [window, ...budgets].filter((p): p is Period => !!p)
    .map((p) => p.key + '/' + p.rule.id).join('|');
  return {
    kind: 'open', key, rule: active.rule,
    opensAt: window?.start ?? active.start, closesAt: window?.end ?? Infinity,
    remainingMs: budget ? remaining(state, budget) : Infinity,
    limitMs: budget ? limitMs(state, budget) : Infinity,
  };
}

export interface Activity { visible: boolean; playing: boolean }

function eligible(rule: ScheduleRule, activity: Activity): boolean {
  return rule.mode === 'site' ? activity.visible : activity.playing;
}

export function updateCounting(state: ScheduleState, now: number, tabs: Activity[]): ScheduleState {
  const { budgets, closed, spent } = currentPeriods(state, timeline(state, now, 0), now);
  let next = state;
  for (const budget of budgets) {
    const active = !closed && !spent && tabs.some((tab) => eligible(budget.rule, tab));
    const entry = next.usage[budget.key] ?? { usedMs: 0, recent: [] };
    const countingUntil = active ? now + 2500 : 0;
    if ((entry.countingUntil ?? 0) === countingUntil) continue;
    next = { ...next, usage: { ...next.usage, [budget.key]: { ...entry, countingUntil } } };
  }
  return next;
}

export function recordUsage(raw: ScheduleState, start: number, end: number, activity?: Activity): ScheduleState {
  if (!raw.enabled || end <= start || end - start > MAX_SAMPLE_GAP_MS) return raw;
  let state = migrateSchedule(raw, start);
  const line = timeline(state, start, 1);
  let from = start;
  for (const to of [...line.boundaries.filter((t) => start < t && t < end), end]) {
    const { closed, spent, budgets } = currentPeriods(state, line, from);
    if (!closed && !spent) {
      const eligibleBudgets = budgets.filter((budget) => !activity || eligible(budget.rule, activity));
      for (const budget of eligibleBudgets) state = chargeInterval(state, budget.key, from, to);
    }
    from = to;
  }
  return state;
}

function chargeInterval(state: ScheduleState, key: string, start: number, end: number): ScheduleState {
  const previous = state.usage[key] ?? { usedMs: 0, recent: [] };
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
  usage[key] = { ...previous, usedMs: previous.usedMs + added, recent };
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
  state = migrateSchedule(state, now);
  const status = getScheduleStatus(state, now);
  if (status.kind === 'closed' || status.kind === 'spent') return { kind: 'unavailable' };
  const { endsAtMs } = resolveBudgetBounds(spec, now);
  if (choice && (status.kind !== 'open' || status.key !== choice.key ||
    (choice.untilAt !== undefined && choice.untilAt !== endsAtMs))) return { kind: 'unavailable' };
  if (status.kind !== 'open' || endsAtMs === null) return { kind: 'start', endsAtMs, schedule: state };

  const { window, budgets } = currentPeriods(state, timeline(state, now, 0), now);
  // A budget that resets before it can run out does not shorten this session.
  const binding = budgets.filter((budget) => remaining(state, budget) < budget.end - now);
  const usageAvailable = Math.min(...binding.map((budget) => remaining(state, budget)));
  const availableMs = Math.min(usageAvailable, status.closesAt - now);
  const requestedMs = endsAtMs - now;
  if (requestedMs <= availableMs) return { kind: 'start', endsAtMs, schedule: state };
  const extraUsageMs = Math.max(0, ...binding.map((budget) =>
    Math.min(requestedMs, budget.end - now) - remaining(state, budget),
  ));
  const extraWindowMs = Math.max(0, endsAtMs - status.closesAt);
  if (!choice) {
    const untilAt = spec.mode === 'until' ? endsAtMs : undefined;
    return { kind: 'conflict', key: status.key, availableMs, requestedMs, extraUsageMs, extraWindowMs, untilAt };
  }
  if (choice.action === 'shorten') return { kind: 'start', endsAtMs: now + availableMs, schedule: state };

  const usage = { ...state.usage };
  if (window && extraWindowMs > 0) {
    const entry = usage[window.key] ?? { usedMs: 0, recent: [] };
    usage[window.key] = { ...entry, closesAtOverride: endsAtMs };
  }
  for (const budget of binding) {
    const neededMs = Math.min(requestedMs, budget.end - now) - remaining(state, budget);
    if (neededMs <= 0) continue;
    const entry = usage[budget.key] ?? { usedMs: 0, recent: [] };
    usage[budget.key] = { ...entry, limitOverrideMs: limitMs(state, budget) + neededMs };
  }
  return { kind: 'start', endsAtMs, schedule: { ...state, usage } };
}
