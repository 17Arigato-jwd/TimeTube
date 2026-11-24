import assert from 'node:assert/strict';
import test from 'node:test';
import {
  EMPTY_SCHEDULE, getScheduleStatus, recordUsage, resolveScheduledStart, validateSchedule, type ScheduleState,
} from '../src/core/schedule';

const rule = { id: 'night', days: [1], start: '22:00', end: '01:00', limitMinutes: 45, mode: 'playback' as const };
const schedule = { ...EMPTY_SCHEDULE, enabled: true, rules: [rule] };
const local = (day: number, hour: number, minute = 0) => new Date(2026, 10, day, hour, minute).getTime();

test('an overnight occurrence belongs to the day the window starts', () => {
  assert.equal(getScheduleStatus(schedule, local(23, 21)).kind, 'closed');
  const current = getScheduleStatus(schedule, local(24, 0, 30));
  assert.equal(current.kind, 'open');
  if (current.kind !== 'open') return;
  assert.equal(current.key, '2026-11-23');
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
    kind: 'spent', nextOpen: local(24, 22),
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
