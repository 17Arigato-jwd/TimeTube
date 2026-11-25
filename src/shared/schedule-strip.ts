import { getScheduleStatus, getScheduleStrip, type ScheduleState } from '../core/schedule';
import { formatMs } from './clock';

function time(ms: number): string {
  return new Date(ms).toLocaleTimeString(undefined, { hour: 'numeric', minute: '2-digit' });
}

function setText(element: HTMLElement, text: string): void {
  if (element.textContent !== text) element.textContent = text;
}

export function bindScheduleStrip(strip: HTMLElement) {
  const statusLabel = strip.querySelector<HTMLElement>('[data-schedule-status]')!;
  const detailLabel = strip.querySelector<HTMLElement>('[data-schedule-detail]')!;
  const budgetLine = strip.querySelector<HTMLElement>('[data-schedule-budget]')!;
  const pausedLabel = strip.querySelector<HTMLElement>('[data-schedule-paused]')!;
  const resetLabel = strip.querySelector<HTMLElement>('[data-schedule-reset]')!;
  const windowLine = strip.querySelector<HTMLElement>('[data-schedule-window]')!;
  const windowStart = strip.querySelector<HTMLElement>('[data-window-start]')!;
  const windowNow = strip.querySelector<HTMLElement>('[data-window-now]')!;
  const windowEnd = strip.querySelector<HTMLElement>('[data-window-end]')!;
  const windowProgress = strip.querySelector<HTMLElement>('[data-window-progress]')!;
  const segments = Array.from({ length: 24 }, () => document.createElement('span'));
  windowProgress.append(...segments);

  return (schedule: ScheduleState, now: number, status = getScheduleStatus(schedule, now)): boolean => {
    const restricted = status.kind === 'closed' || status.kind === 'spent';
    const { window: accessWindow, budget } = getScheduleStrip(schedule, now);
    strip.hidden = !accessWindow && !budget && !restricted;
    budgetLine.hidden = !budget;
    if (budget) {
      const spent = budget.remainingMs <= 0;
      setText(statusLabel, spent ? 'Time up' : `${formatMs(budget.remainingMs)} remaining`);
      pausedLabel.hidden = spent || budget.counting;
      setText(resetLabel, `Resets at ${time(budget.resetsAt)}`);
    }

    windowLine.hidden = !accessWindow;
    if (accessWindow) {
      const { opensAt, closesAt } = accessWindow;
      const elapsed = Math.min(1, Math.max(0, (now - opensAt) / (closesAt - opensAt)));
      const filled = Math.floor(segments.length * elapsed);
      segments.forEach((segment, index) => segment.classList.toggle('elapsed', index < filled));
      const start = time(opensAt);
      const current = time(now);
      const overnight = new Date(opensAt).toDateString() !== new Date(closesAt).toDateString();
      const end = time(closesAt) + (overnight ? ' next day' : '');
      setText(windowStart, start);
      setText(windowNow, `Now ${current}`);
      setText(windowEnd, end);
      windowProgress.setAttribute('aria-valuenow', String(Math.round(elapsed * 100)));
      windowProgress.setAttribute('aria-valuetext', `Access from ${start} to ${end}. Current time ${current}.`);
    }

    detailLabel.hidden = !restricted;
    if (status.kind === 'closed' || status.kind === 'spent') {
      if (status.nextOpen !== null) {
        const day = new Date(status.nextOpen).toLocaleDateString(undefined, { weekday: 'long' });
        setText(detailLabel, `Access resumes ${day} at ${time(status.nextOpen)}`);
      } else {
        setText(detailLabel, 'Access restricted');
      }
    }
    return restricted;
  };
}
