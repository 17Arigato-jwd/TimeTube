import assert from 'node:assert/strict';
import test from 'node:test';
import {
  extractLengthSecondsFromHtml,
  extractShortIdFromHref,
  formatDurationBadge,
  parseDurationText,
} from '../src/core/duration';
import {
  buildSessionSnapshot,
  buildStandardWatchUrl,
  computeMaxAllowedSeconds,
  computeShortsStage,
  evaluateVideoCandidate,
  resolveBudgetBounds,
} from '../src/core/policy';
import {
  DEFAULT_POLICY,
  INITIAL_PERSISTED_STATE,
  PersistedSessionState,
} from '../src/core/types';

function makeActiveSession(overrides: Partial<PersistedSessionState> = {}): PersistedSessionState {
  const startedAtMs = Date.parse('2026-11-21T16:00:00Z');
  const endsAtMs = Date.parse('2026-11-21T16:40:00Z'); // 40-minute break
  return {
    ...INITIAL_PERSISTED_STATE,
    id: 'sess_1',
    status: 'active',
    spec: { mode: 'countdown', durationMinutes: 40 },
    startedAtMs,
    endsAtMs,
    autoplayOnboarding: 'verified_disabled',
    policy: { ...DEFAULT_POLICY, bufferSeconds: 0 },
    ...overrides,
  };
}

test('parseDurationText handles MM:SS, HH:MM:SS, ARIA labels, and rejects LIVE', () => {
  assert.equal(parseDurationText('0:45'), 45);
  assert.equal(parseDurationText('12:30'), 750);
  assert.equal(parseDurationText('1:05:20'), 3920);
  assert.equal(parseDurationText('12 minutes, 30 seconds'), 750);
  assert.equal(parseDurationText('45 seconds'), 45);
  assert.equal(parseDurationText('LIVE'), null);
  assert.equal(parseDurationText('SHORTS'), null);
  assert.equal(parseDurationText(''), null);
});

test('formatDurationBadge & HTML duration extraction work accurately', () => {
  assert.equal(formatDurationBadge(42), '0:42');
  assert.equal(formatDurationBadge(185), '3:05');
  assert.equal(formatDurationBadge(3665), '1:01:05');
  assert.equal(extractLengthSecondsFromHtml('{"videoDetails":{"lengthSeconds":"127"}}'), 127);
  assert.equal(extractShortIdFromHref('/shorts/abcDEF12345?feature=share'), 'abcDEF12345');
  assert.equal(buildStandardWatchUrl('abcDEF12345', 37.9), 'https://www.youtube.com/watch?v=abcDEF12345&t=37s');
});

test('resolveBudgetBounds handles countdown and next-day until rollover', () => {
  const now = new Date(2026, 10, 21, 18, 0, 0, 0).getTime(); // 18:00 local
  const sameDay = resolveBudgetBounds({ mode: 'until', endTime: '19:30' }, now);
  assert.equal((sameDay.endsAtMs! - now) / 60_000, 90);

  const nextDay = resolveBudgetBounds({ mode: 'until', endTime: '17:00' }, now);
  assert.equal((nextDay.endsAtMs! - now) / 60_000, 23 * 60);
});

test('dynamic sidebar pruning shrinks maxAllowedVideoSeconds as time elapses', () => {
  const session = makeActiveSession({ policy: { ...DEFAULT_POLICY, bufferSeconds: 15 } });
  const t1 = Date.parse('2026-11-21T16:30:00Z'); // 10 min left
  assert.equal(computeMaxAllowedSeconds(session, t1), 585);

  const snap1 = buildSessionSnapshot(session, t1, { autoplayObserved: 'disabled' });
  assert.equal(evaluateVideoCandidate({ id: 'v1', kind: 'video', durationSeconds: 580 }, snap1), 'allow');
  assert.equal(evaluateVideoCandidate({ id: 'v2', kind: 'video', durationSeconds: 600 }, snap1), 'hide');

  // 2 minutes later (8 min left = 480s - 15s = 465s): v1 (580s) now gets hidden
  const t2 = Date.parse('2026-11-21T16:32:00Z');
  const snap2 = buildSessionSnapshot(session, t2, { autoplayObserved: 'disabled' });
  assert.equal(evaluateVideoCandidate({ id: 'v1', kind: 'video', durationSeconds: 580 }, snap2), 'hide');
});

test('Shorts thumbnails on Home/Search are filtered by duration, not blanket-blocked', () => {
  const session = makeActiveSession();
  const twoMinsLeft = Date.parse('2026-11-21T16:38:00Z'); // 120s left
  const snap = buildSessionSnapshot(session, twoMinsLeft, { autoplayObserved: 'disabled' });

  // Unresolved Short duration stays visible while background fetch resolves
  assert.equal(evaluateVideoCandidate({ id: 's0', kind: 'short', durationSeconds: null }, snap), 'allow');
  // 45s Short fits in 2 min remaining
  assert.equal(evaluateVideoCandidate({ id: 's1', kind: 'short', durationSeconds: 45 }, snap), 'allow');
  // 2m45s (165s) Short exceeds 2 min remaining -> hidden
  assert.equal(evaluateVideoCandidate({ id: 's2', kind: 'short', durationSeconds: 165 }, snap), 'hide');
});

test('graduated Shorts escalation fires at 50% -> 25% -> final 5/10 min cutoff', () => {
  const session = makeActiveSession({
    policy: { ...DEFAULT_POLICY, shortsMode: 'escalatingNudge', shortsLockCutoffMinutes: 5 },
  });

  // 40m session: 30m left (25% elapsed) -> unrestricted
  assert.equal(computeShortsStage(session, Date.parse('2026-11-21T16:10:00Z')), 'unrestricted');
  // 20m left (50% elapsed) -> nudge_50
  assert.equal(computeShortsStage(session, Date.parse('2026-11-21T16:20:00Z')), 'nudge_50');
  // 10m left (25% remaining) -> nudge_25
  assert.equal(computeShortsStage(session, Date.parse('2026-11-21T16:30:00Z')), 'nudge_25');
  // 5m left (cutoff) -> locked_to_watch
  assert.equal(computeShortsStage(session, Date.parse('2026-11-21T16:35:00Z')), 'locked_to_watch');

  // Toggle ON always locks immediately to standard player
  const disabledShorts = makeActiveSession({
    policy: { ...DEFAULT_POLICY, shortsMode: 'redirectToWatch' },
  });
  assert.equal(computeShortsStage(disabledShorts, Date.parse('2026-11-21T16:01:00Z')), 'locked_to_watch');
});

test('Autoplay onboarding, claim verification, and Not Now snooze states work properly', () => {
  const unseen = makeActiveSession({ autoplayOnboarding: 'unseen' });
  const now = Date.parse('2026-11-21T16:10:00Z');

  // Initial setup requires Autoplay onboarding
  assert.equal(buildSessionSnapshot(unseen, now).status, 'needs_autoplay_setup');

  // Clicking "Not now" snoozes until reload or popup wake
  assert.equal(buildSessionSnapshot(unseen, now, { snoozed: true }).status, 'snoozed');

  // Clicking "I've already done it" allows active browsing until Watch player proves Autoplay is still ON
  const claimed = makeActiveSession({ autoplayOnboarding: 'claimed_disabled' });
  assert.equal(buildSessionSnapshot(claimed, now, { autoplayObserved: 'unknown' }).status, 'active');
  assert.equal(buildSessionSnapshot(claimed, now, { autoplayObserved: 'enabled' }).status, 'needs_autoplay_setup');
  assert.equal(buildSessionSnapshot(claimed, now, { autoplayObserved: 'disabled' }).status, 'active');
});
