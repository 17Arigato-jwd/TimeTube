import {
  EMPTY_SCHEDULE, getScheduleStatus, resolveScheduledStart, SCHEDULE_KEY,
  type ScheduleChoice, type ScheduledStart, type ScheduledStartResponse, type ScheduleState,
} from '../core/schedule';
import type { BudgetSpec } from '../core/types';
import { webext } from '../shared/webext';

let schedule = EMPTY_SCHEDULE;
let pendingSpec: BudgetSpec | null = null;
let conflictKey: string | null = null;
let conflictUntil: number | undefined;
let pending = false;

const statusLabel = document.querySelector<HTMLElement>('#schedule-status')!;
const detailLabel = document.querySelector<HTMLElement>('#schedule-detail')!;
const editButton = document.querySelector<HTMLButtonElement>('#schedule-open')!;
const dialog = document.querySelector<HTMLDialogElement>('#schedule-conflict')!;
const summary = document.querySelector<HTMLElement>('#conflict-summary')!;
const extra = document.querySelector<HTMLElement>('#conflict-extra')!;
const dialogError = document.querySelector<HTMLElement>('#conflict-error')!;
const startError = document.querySelector<HTMLElement>('#session-start-error')!;
const shorten = document.querySelector<HTMLButtonElement>('#conflict-shorten')!;
const extend = document.querySelector<HTMLButtonElement>('#conflict-extend')!;

function duration(ms: number): string {
  const seconds = Math.max(0, Math.ceil(ms / 1000));
  const minutes = Math.floor(seconds / 60);
  const remainder = seconds % 60;
  if (!minutes) return `${seconds} sec`;
  return remainder ? `${minutes} min ${remainder} sec` : `${minutes} min`;
}

function time(ms: number): string {
  return new Date(ms).toLocaleTimeString(undefined, { hour: 'numeric', minute: '2-digit' });
}

function showError(message: string): void {
  if (dialog.open) {
    dialogError.textContent = message;
  } else {
    startError.textContent = message;
    startError.classList.toggle('hidden', !message);
  }
}

function renderConflict(result: ScheduledStart): void {
  if (result.kind === 'unavailable' || (result.kind === 'conflict' && result.key !== conflictKey)) {
    summary.textContent = 'This access window is no longer available.';
    extra.textContent = '';
    shorten.disabled = extend.disabled = true;
    return;
  }
  if (result.kind === 'start') {
    summary.textContent = 'The requested session now fits your schedule.';
    extra.textContent = '';
    shorten.textContent = 'Start session';
    shorten.disabled = pending;
    extend.disabled = true;
    return;
  }
  shorten.textContent = 'Shorten session';
  shorten.disabled = extend.disabled = pending;
  summary.textContent = `${duration(result.requestedMs)} requested. ${duration(result.availableMs)} fits under ${result.extraUsageMs && result.extraWindowMs ? 'the daily limit and closing time' : result.extraUsageMs ? 'the daily limit' : 'the closing time'}.`;
  const adjustments = [];
  if (result.extraUsageMs) adjustments.push(`${duration(result.extraUsageMs)} to this window’s allowance`);
  if (result.extraWindowMs) adjustments.push(`${duration(result.extraWindowMs)} to its closing time`);
  extra.textContent = `Add ${adjustments.join(' and ')} for this occurrence only.`;
}

export function renderSchedule(): boolean {
  const now = Date.now();
  const status = getScheduleStatus(schedule, now);
  const restricted = status.kind === 'closed' || status.kind === 'spent';
  editButton.textContent = schedule.rules.length ? 'Edit schedule' : 'Set up schedule';
  detailLabel.textContent = '';
  if (status.kind === 'open') {
    statusLabel.textContent = `${duration(status.remainingMs)} remaining`;
    const sameDay = new Date(now).toDateString() === new Date(status.closesAt).toDateString();
    const closingDay = new Date(status.closesAt).toLocaleDateString(undefined, { weekday: 'long' });
    detailLabel.textContent = sameDay
      ? `Until ${time(status.closesAt)}`
      : `Until ${closingDay} at ${time(status.closesAt)}`;
  } else if (status.kind === 'closed' || status.kind === 'spent') {
    statusLabel.textContent = status.kind === 'spent' ? 'Time up' : 'Access restricted';
    if (status.nextOpen !== null) {
      const day = new Date(status.nextOpen).toLocaleDateString(undefined, { weekday: 'long' });
      detailLabel.textContent = `Access resumes ${day} at ${time(status.nextOpen)}`;
    }
  } else {
    statusLabel.textContent = status.kind === 'off' ? 'Schedule off' : 'No rule today';
  }
  if (dialog.open && pendingSpec) {
    if (conflictUntil !== undefined && conflictUntil <= now) {
      summary.textContent = 'The requested end time has passed.';
      extra.textContent = '';
      shorten.disabled = extend.disabled = true;
    } else {
      const result = status.kind === 'open' && status.key === conflictKey
        ? resolveScheduledStart(schedule, pendingSpec, now)
        : { kind: 'unavailable' } as const;
      renderConflict(result);
    }
  }
  return restricted;
}

export async function startScheduledSession(spec: BudgetSpec, choice?: ScheduleChoice): Promise<void> {
  if (pending) return;
  showError('');
  pending = true;
  shorten.disabled = extend.disabled = true;
  try {
    const result = await webext.runtime.sendMessage<ScheduledStartResponse | { error: string }>({
      type: 'START_SCHEDULED_SESSION', spec, choice,
    });
    if ('error' in result) throw new Error(result.error);
    if (result.kind === 'conflict') {
      pendingSpec = spec;
      conflictKey = result.key;
      conflictUntil = result.untilAt;
      dialogError.textContent = '';
      renderConflict(result);
      if (!dialog.open) dialog.showModal();
    } else if (result.kind === 'unavailable') {
      showError('This access window is no longer available.');
    } else if (dialog.open) {
      dialog.close();
    }
  } catch {
    showError('Could not start the session. Try again.');
  } finally {
    pending = false;
    if (dialog.open && pendingSpec) renderSchedule();
  }
}

export async function initSchedulePopup(onChange: () => void): Promise<void> {
  let receivedChange = false;
  webext.storage.onChanged.addListener((changes, area) => {
    if (area !== 'local' || !changes[SCHEDULE_KEY]) return;
    receivedChange = true;
    schedule = (changes[SCHEDULE_KEY].newValue as ScheduleState | undefined) ?? EMPTY_SCHEDULE;
    onChange();
  });
  const stored = await webext.storage.local.get<{ [SCHEDULE_KEY]?: ScheduleState }>(SCHEDULE_KEY);
  if (!receivedChange) schedule = stored[SCHEDULE_KEY] ?? EMPTY_SCHEDULE;
  editButton.addEventListener('click', () => {
    webext.runtime.openOptionsPage().catch(() => showError('Could not open schedule settings.'));
  });
  const confirm = (action: ScheduleChoice['action']) => {
    if (pendingSpec && conflictKey) void startScheduledSession(pendingSpec, { action, key: conflictKey, untilAt: conflictUntil });
  };
  shorten.addEventListener('click', () => confirm('shorten'));
  extend.addEventListener('click', () => confirm('extra'));
  dialog.addEventListener('close', () => {
    pendingSpec = conflictKey = null;
    conflictUntil = undefined;
  });
}
