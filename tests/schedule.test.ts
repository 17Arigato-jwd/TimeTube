import assert from 'node:assert/strict';
import test from 'node:test';
import {
  EMPTY_SCHEDULE, getScheduleStatus, getScheduleStrip, migrateSchedule, updateCounting, recordUsage, resolveScheduledStart, validateSchedule, type ScheduleState,
} from '../src/core/schedule';

const rule = { id: 'night', days: [1], start: '22:00', end: '01:00', limitMinutes: 45, mode: 'playback' as const };
const schedule = { ...EMPTY_SCHEDULE, enabled: true, rules: [rule] };
const local = (day: number, hour: number, minute = 0) => new Date(2026, 10, day, hour, minute).getTime();

test('an overnight occurrence belongs to the day the window starts', () => {
  assert.equal(getScheduleStatus(schedule, local(23, 21)).kind, 'closed');
  const current = getScheduleStatus(schedule, local(24, 0, 30));
  assert.equal(current.kind, 'open');
  if (current.kind !== 'open') return;
  assert.equal(current.opensAt, local(23, 22));
  assert.equal(current.closesAt, local(24, 1));
  assert.equal(getScheduleStatus(schedule, local(24, 1)).kind, 'unassigned');
});

test('validation points out the rule that already owns the day', () => {
  assert.throws(() => validateSchedule(true, [rule, { ...rule, id: 'other' }]), /Monday/);
});

test('overlapping playback samples count once across tabs and retain missed gaps', () => {
  const start = local(23, 22);
  let next = recordUsage(schedule, start, start + 1000);
  next = recordUsage(next, start + 500, start + 1500);
  next = recordUsage(next, start + 2000, start + 3000);
  next = recordUsage(next, start + 1000, start + 2500);
  const current = getScheduleStatus(next, start + 3500);
  assert.equal(current.kind === 'open' && current.remainingMs, 45 * 60_000 - 3000);
});

test('shortening uses exact available time, while extra time applies only once', () => {
  const now = local(24, 0, 59);
  const spec = { mode: 'countdown' as const, durationMinutes: 25 };
  const conflict = resolveScheduledStart(schedule, spec, now);
  assert.equal(conflict.kind, 'conflict');
  if (conflict.kind !== 'conflict') return;
  const shortened = resolveScheduledStart(schedule, spec, now, { action: 'shorten', key: conflict.key });
  assert.equal(shortened.kind === 'start' && shortened.endsAtMs, local(24, 1));
  const extra = resolveScheduledStart(schedule, spec, now, { action: 'extra', key: conflict.key });
  assert.equal(extra.kind, 'start');
  if (extra.kind !== 'start') return;
  assert.equal(getScheduleStatus(extra.schedule, local(24, 1, 10)).kind, 'open');
  assert.equal(extra.schedule.rules[0]?.end, '01:00');
  assert.equal(getScheduleStatus(extra.schedule, local(30, 23, 59)).kind, 'open');
  assert.equal(getScheduleStatus(extra.schedule, new Date(2026, 11, 1, 1, 10).getTime()).kind, 'unassigned');
});

test('a spent daily limit stays restricted until the next eligible occurrence', () => {
  const start = local(23, 22);
  const limited = { ...schedule, rules: [{ ...rule, days: [1, 2], limitMinutes: 1 }] };
  let next: ScheduleState = limited;
  for (let second = 0; second < 60; second++) {
    next = recordUsage(next, start + second * 1000, start + (second + 1) * 1000);
  }
  assert.deepEqual(getScheduleStatus(next, start + 60_000), {
    kind: 'spent', nextOpen: local(24, 0),
  });
  assert.equal(getScheduleStatus(next, local(24, 22)).kind, 'open');
});

test('confirmation cannot silently roll an elapsed end time over to tomorrow', () => {
  const now = local(23, 22);
  const spec = { mode: 'until' as const, endTime: '23:00' };
  const conflict = resolveScheduledStart(schedule, spec, now);
  assert.equal(conflict.kind, 'conflict');
  if (conflict.kind !== 'conflict') return;
  const result = resolveScheduledStart(schedule, spec, local(23, 23), {
    action: 'extra', key: conflict.key, untilAt: conflict.untilAt,
  });
  assert.equal(result.kind, 'unavailable');
});

test('max length remains available in an open window and respects a closed window', () => {
  const spec = { mode: 'maxLength' as const, maxMinutes: 25 };
  const result = resolveScheduledStart(schedule, spec, local(24, 0, 59));
  assert.equal(result.kind === 'start' && result.endsAtMs, null);
  assert.equal(resolveScheduledStart(schedule, spec, local(23, 21)).kind, 'unavailable');
});

test('the next unrestricted day resumes access before a later weekly window', () => {
  const monday = { ...schedule, rules: [{ ...rule, start: '17:00', end: '21:00' }] };
  assert.deepEqual(getScheduleStatus(monday, local(23, 21)), {
    kind: 'closed', nextOpen: local(24, 0),
  });
});

test('a Monday budget starts at its reset time and runs until Tuesday at that time', () => {
  const budget = { ...rule, windowEnabled: false, resetTime: '04:00' };
  const state = { ...schedule, rules: [budget] };
  assert.equal(getScheduleStatus(state, local(23, 3, 59)).kind, 'unassigned');
  assert.equal(getScheduleStatus(state, local(23, 4)).kind, 'open');
  assert.deepEqual(getScheduleStrip(state, local(24, 3, 59)), {
    budget: { remainingMs: 45 * 60_000, resetsAt: local(24, 4), counting: false },
  });
  assert.equal(getScheduleStatus(state, local(24, 4)).kind, 'unassigned');
});

test('inactive section fields are optional; both inactive sections are invalid', () => {
  assert.doesNotThrow(() => validateSchedule(true, [{ ...rule, windowEnabled: false, start: '', end: '' }]));
  assert.doesNotThrow(() => validateSchedule(true, [{ ...rule, limitEnabled: false, limitMinutes: 0, resetTime: '' }]));
  assert.throws(() => validateSchedule(true, [{ ...rule, windowEnabled: false, limitEnabled: false }]));
  assert.throws(() => validateSchedule(true, [{ ...rule, resetTime: '25:99' }]));
});

test('usage samples split across reset boundaries inside an overnight window', () => {
  const state = { ...schedule, rules: [{ ...rule, days: [1, 2], resetTime: '00:30' }] };
  const reset = local(24, 0, 30);
  const next = recordUsage(state, reset - 1000, reset + 2000);
  assert.equal(next.usage['2026-11-23']?.usedMs, 1000);
  assert.equal(next.usage['2026-11-24']?.usedMs, 2000);
  const view = getScheduleStrip(next, reset + 2000);
  assert.equal(view.budget?.resetsAt, local(25, 0, 30));
  assert.equal(view.window?.opensAt, local(23, 22));
  assert.equal(view.window?.closesAt, local(24, 1));
});

test('a window-only rule measures no daily usage and limits only the closing time', () => {
  const state = { ...schedule, rules: [{ ...rule, limitEnabled: false, limitMinutes: 1 }] };
  const now = local(23, 22);
  assert.equal(recordUsage(state, now, now + 1000), state);
  assert.equal(getScheduleStrip(state, now).budget, undefined);
  const request = { mode: 'countdown' as const, durationMinutes: 30 };
  assert.equal(resolveScheduledStart(state, request, now).kind, 'start');
  const conflict = resolveScheduledStart(state, request, local(24, 0, 59));
  assert.equal(conflict.kind === 'conflict' && conflict.extraUsageMs, 0);
});

test('playback budgets pause, resume, and expire stale activity', () => {
  const now = local(23, 22);
  const paused = { visible: true, playing: false };
  const playing = { visible: false, playing: true };
  assert.equal(recordUsage(schedule, now, now + 1000, paused), schedule);
  const active = updateCounting(schedule, now, [paused, playing]);
  assert.equal(getScheduleStrip(active, now).budget?.counting, true);
  assert.equal(getScheduleStrip(active, now + 3000).budget?.counting, false);
  const idle = updateCounting(active, now + 100, [paused]);
  assert.equal(getScheduleStrip(idle, now + 100).budget?.counting, false);
});

test('legacy migration carries a live overnight balance exactly once', () => {
  const now = local(24, 0, 10);
  const usage = { '2026-11-23': { usedMs: 40 * 60_000, recent: [] } };
  const raw = { enabled: true, rules: [{ ...rule, days: [1, 2] }], usage };
  const migrated = migrateSchedule(raw, now);
  assert.equal(getScheduleStrip(migrated, now).budget?.remainingMs, 5 * 60_000);
  assert.equal(migrateSchedule(migrated, now), migrated);
  const unassignedTuesday = migrateSchedule({ ...raw, rules: [rule] }, now);
  assert.equal(getScheduleStrip(unassignedTuesday, now).budget?.remainingMs, 5 * 60_000);
  assert.equal(getScheduleStatus(unassignedTuesday, local(24, 1)).kind, 'unassigned');
});

test('an exception for one budget period cannot enlarge the next period', () => {
  const state = { ...schedule, rules: [{ ...rule, days: [1, 2], windowEnabled: false, limitMinutes: 2 }] };
  const now = local(23, 22);
  const spec = { mode: 'countdown' as const, durationMinutes: 10 };
  const conflict = resolveScheduledStart(state, spec, now);
  assert.equal(conflict.kind, 'conflict');
  if (conflict.kind !== 'conflict') return;
  assert.equal(conflict.extraWindowMs, 0);
  const started = resolveScheduledStart(state, spec, now, { action: 'extra', key: conflict.key });
  if (started.kind !== 'start') assert.fail('expected a confirmed start');
  assert.equal(getScheduleStrip(started.schedule, now).budget?.remainingMs, 10 * 60_000);
  assert.equal(getScheduleStrip(started.schedule, local(24, 0)).budget?.remainingMs, 2 * 60_000);
});

test('the conflict notice and grant stop at the reset boundary', () => {
  const now = local(23, 23, 58);
  const state = { ...schedule, rules: [{ ...rule, days: [1, 2], windowEnabled: false, limitMinutes: 1 }] };
  const spec = { mode: 'countdown' as const, durationMinutes: 10 };
  const conflict = resolveScheduledStart(state, spec, now);
  if (conflict.kind !== 'conflict') assert.fail('expected a conflict');
  assert.equal(conflict.availableMs, 60_000);
  assert.equal(conflict.extraUsageMs, 60_000);
  const result = resolveScheduledStart(state, spec, now, { action: 'extra', key: conflict.key });
  if (result.kind !== 'start') assert.fail('expected a confirmed start');
  assert.equal(getScheduleStrip(result.schedule, now).budget?.remainingMs, 120_000);
  assert.equal(getScheduleStrip(result.schedule, local(24, 0)).budget?.remainingMs, 60_000);
});

test('overnight migration preserves the larger confirmed allowance', () => {
  const now = local(24, 0, 10);
  for (const targetLimit of [undefined, 70 * 60_000]) {
    const raw = {
      ...schedule,
      version: undefined,
      rules: [{ ...rule, days: [1, 2] }],
      usage: {
        '2026-11-23': { usedMs: 50 * 60_000, recent: [], extra: { closesAt: local(24, 1), limitMs: 60 * 60_000 } },
        '2026-11-24': { usedMs: 0, recent: [], limitOverrideMs: targetLimit },
      },
    };
    assert.equal(getScheduleStrip(migrateSchedule(raw, now), now).budget?.remainingMs,
      (targetLimit ?? 60 * 60_000) - 50 * 60_000);
  }
});

test('an unused legacy overnight allowance stays usable and tracked on an unassigned day', () => {
  const now = local(24, 0, 10);
  const raw = { ...schedule, version: undefined };
  const migrated = migrateSchedule(raw, now);
  assert.equal(getScheduleStrip(migrated, now).budget?.remainingMs, 45 * 60_000);
  const next = recordUsage(migrated, now, now + 1000);
  assert.equal(getScheduleStrip(next, now + 1000).budget?.remainingMs, 45 * 60_000 - 1000);
  assert.equal(getScheduleStatus(next, local(24, 1)).kind, 'unassigned');
});

test('schedule messages recover failed charges and toggle the latest rules from storage', async (t) => {
  let stored: ScheduleState = {
    ...schedule,
    version: 2,
    rules: [{ ...rule, windowEnabled: false }],
  };
  let failWrite = false;
  t.mock.method(Date, 'now', () => now);
  let now = local(23, 22);
  Object.defineProperty(globalThis, 'chrome', {
    configurable: true,
    value: { storage: { local: {
      get: async () => ({ timeTubeSchedule: stored }),
      set: async ({ timeTubeSchedule }: { timeTubeSchedule: ScheduleState }) => {
        if (failWrite) throw new Error('storage unavailable');
        stored = timeTubeSchedule;
      },
    } } },
  });
  t.after(() => { Reflect.deleteProperty(globalThis, 'chrome'); });
  const { runScheduleMessage } = await import('../src/background/schedule');
  const noManualStart = async () => assert.fail('unexpected manual start');
  const sender = { tab: { id: 1 } };
  const sample = () => runScheduleMessage(
    { type: 'SCHEDULE_SAMPLE', documentId: 'document', visible: false, playing: true }, sender, noManualStart,
  );

  await sample();
  now += 1000;
  failWrite = true;
  await assert.rejects(sample(), /storage unavailable/);
  now += 1000;
  failWrite = false;
  await sample();
  assert.equal(stored.usage['2026-11-23']?.usedMs, 2000);

  await runScheduleMessage({ type: 'SAVE_SCHEDULE', enabled: false }, undefined, noManualStart);
  assert.equal(stored.enabled, false);
  assert.equal(stored.rules[0]?.windowEnabled, false);
  await runScheduleMessage({ type: 'SAVE_SCHEDULE', enabled: true }, undefined, noManualStart);
  assert.equal(stored.enabled, true);
  assert.equal(stored.rules[0]?.windowEnabled, false);
  await runScheduleMessage({ type: 'SAVE_SCHEDULE', enabled: false, rules: [] }, undefined, noManualStart);
  assert.deepEqual(stored.rules, []);
});
