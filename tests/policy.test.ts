import assert from 'node:assert/strict';
import test from 'node:test';
import {
  extractLengthSecondsFromHtml,
  extractShortIdFromHref,
  formatApproxRemaining,
  formatDurationBadge,
  getDefaultEndTime,
  parseDurationText,
} from '../src/core/duration';
import {
  buildSessionSnapshot,
  buildStandardWatchUrl,
  computeMaxAllowedSeconds,
  computePlaybackOverrun,
  computeShortsStage,
  evaluateVideoCandidate,
  resolveBudgetBounds,
  shouldAutoResetExpiredSession,
} from '../src/core/policy';
import {
  DEFAULT_POLICY,
  INITIAL_PERSISTED_STATE,
  PersistedSessionState,
} from '../src/core/types';

function makeActiveSession(overrides: Partial<PersistedSessionState> = {}): PersistedSessionState {
  const startedAtMs = Date.parse('2026-11-21T16:00:00Z');
  const endsAtMs = Date.parse('2026-11-21T16:40:00Z');
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

test('parseDurationText handles MM:SS, HH:MM:SS, ARIA labels, and ignores LIVE / New / relative ago', () => {
  assert.equal(parseDurationText('0:45'), 45);
  assert.equal(parseDurationText('12:30'), 750);
  assert.equal(parseDurationText('1:05:20'), 3920);
  assert.equal(parseDurationText('Video Title by Creator 12 minutes, 30 seconds 2 hours ago'), 750);
  assert.equal(parseDurationText('45 seconds'), 45);
  assert.equal(parseDurationText('2 hours ago'), null);
  assert.equal(parseDurationText('New'), null);
  assert.equal(parseDurationText('LIVE'), null);
  assert.equal(parseDurationText('SHORTS'), null);
});

test('formatApproxRemaining formats 1hr, 1.5hr, 30m, 2m, 53s, 42s, 3s cleanly', () => {
  assert.equal(formatApproxRemaining(90 * 60_000), '1.5hr');
  assert.equal(formatApproxRemaining(60 * 60_000), '1hr');
  assert.equal(formatApproxRemaining(30 * 60_000), '30m');
  assert.equal(formatApproxRemaining(2 * 60_000), '2m');
  assert.equal(formatApproxRemaining(53_000), '53s');
  assert.equal(formatApproxRemaining(42_000), '42s');
  assert.equal(formatApproxRemaining(3_000), '3s');
  assert.equal(formatApproxRemaining(0), '0s');
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
  const now = new Date(2026, 10, 21, 18, 0, 0, 0).getTime();
  const sameDay = resolveBudgetBounds({ mode: 'until', endTime: '19:30' }, now);
  assert.equal((sameDay.endsAtMs! - now) / 60_000, 90);

  const nextDay = resolveBudgetBounds({ mode: 'until', endTime: '17:00' }, now);
  assert.equal((nextDay.endsAtMs! - now) / 60_000, 23 * 60);
});

test('dynamic sidebar pruning shrinks maxAllowedVideoSeconds as time elapses', () => {
  const session = makeActiveSession({ policy: { ...DEFAULT_POLICY, bufferSeconds: 15 } });
  const t1 = Date.parse('2026-11-21T16:30:00Z');
  assert.equal(computeMaxAllowedSeconds(session, t1), 585);

  const snap1 = buildSessionSnapshot(session, t1, { autoplayObserved: 'disabled' });
  assert.equal(evaluateVideoCandidate({ id: 'v1', kind: 'video', durationSeconds: 580 }, snap1), 'allow');
  assert.equal(evaluateVideoCandidate({ id: 'v2', kind: 'video', durationSeconds: 600 }, snap1), 'hide');

  const t2 = Date.parse('2026-11-21T16:32:00Z');
  const snap2 = buildSessionSnapshot(session, t2, { autoplayObserved: 'disabled' });
  assert.equal(evaluateVideoCandidate({ id: 'v1', kind: 'video', durationSeconds: 580 }, snap2), 'hide');
});

test('Shorts thumbnails on Home/Search are filtered by duration, not blanket-blocked', () => {
  const session = makeActiveSession();
  const twoMinsLeft = Date.parse('2026-11-21T16:38:00Z');
  const snap = buildSessionSnapshot(session, twoMinsLeft, { autoplayObserved: 'disabled' });

  assert.equal(evaluateVideoCandidate({ id: 's0', kind: 'short', durationSeconds: null }, snap), 'allow');
  assert.equal(evaluateVideoCandidate({ id: 's1', kind: 'short', durationSeconds: 45 }, snap), 'allow');
  assert.equal(evaluateVideoCandidate({ id: 's2', kind: 'short', durationSeconds: 165 }, snap), 'hide');
});

test('graduated Shorts escalation fires at 50% -> 25% -> final 5/10 min cutoff', () => {
  const session = makeActiveSession({
    policy: { ...DEFAULT_POLICY, shortsMode: 'escalatingNudge', shortsLockCutoffMinutes: 5 },
  });

  assert.equal(computeShortsStage(session, Date.parse('2026-11-21T16:10:00Z')), 'unrestricted');
  assert.equal(computeShortsStage(session, Date.parse('2026-11-21T16:20:00Z')), 'nudge_50');
  assert.equal(computeShortsStage(session, Date.parse('2026-11-21T16:30:00Z')), 'nudge_25');
  assert.equal(computeShortsStage(session, Date.parse('2026-11-21T16:35:00Z')), 'locked_to_watch');

  const disabledShorts = makeActiveSession({
    policy: { ...DEFAULT_POLICY, shortsMode: 'redirectToWatch' },
  });
  assert.equal(computeShortsStage(disabledShorts, Date.parse('2026-11-21T16:01:00Z')), 'locked_to_watch');
});

test('Autoplay only blocks when explicitly observed as enabled while playing', () => {
  const unseen = makeActiveSession({ autoplayOnboarding: 'unseen' });
  const now = Date.parse('2026-11-21T16:10:00Z');

  // Unseen / disabled / unknown never interrupt browsing
  assert.equal(buildSessionSnapshot(unseen, now, { autoplayObserved: 'unknown' }).status, 'active');
  assert.equal(buildSessionSnapshot(unseen, now, { autoplayObserved: 'disabled' }).status, 'active');
  // Confirmed ON triggers Autoplay prompt
  assert.equal(buildSessionSnapshot(unseen, now, { autoplayObserved: 'enabled' }).status, 'needs_autoplay_setup');
  // Snoozing overrides prompt until reload/popup
  assert.equal(buildSessionSnapshot(unseen, now, { autoplayObserved: 'enabled', snoozed: true }).status, 'snoozed');
});

test('computePlaybackOverrun calculates exact dynamic speeds (<=2x), extra seconds, and red cutoff %', () => {
  const plenty = computePlaybackOverrun(0, 600, 1, 30 * 60_000);
  assert.equal(plenty.isOverrunning, false);
  assert.equal(plenty.suggestedSpeed, null);

  const mid = computePlaybackOverrun(215, 1000, 1, 500_000);
  assert.equal(mid.isOverrunning, true);
  assert.equal(mid.extraSecondsNeeded, 285);
  assert.equal(mid.suggestedSpeed, 1.57);
  assert.equal(mid.cutoffVideoSeconds, 715);
  assert.equal(mid.cutoffPercent, 71.5);

  const tooLong = computePlaybackOverrun(0, 1500, 1, 500_000);
  assert.equal(tooLong.isOverrunning, true);
  assert.equal(tooLong.suggestedSpeed, null);
  assert.equal(tooLong.extraSecondsNeeded, 1000);
});

test('paused countdown freezes remainingMs cleanly', () => {
  const paused = makeActiveSession({
    status: 'paused',
    pausedAtMs: Date.parse('2026-11-21T16:10:00Z'),
    pausedRemainingMs: 18 * 60_000,
  });
  const later = Date.parse('2026-11-21T16:55:00Z');
  const snap = buildSessionSnapshot(paused, later, { autoplayObserved: 'disabled' });
  assert.equal(snap.status, 'paused');
  assert.equal(snap.remainingMs, 18 * 60_000);
});

test('getDefaultEndTime rounds strictly up to the next 15-minute mark', () => {
  assert.equal(getDefaultEndTime(new Date(2026, 10, 22, 2, 1, 0).getTime()), '02:15');
  assert.equal(getDefaultEndTime(new Date(2026, 10, 22, 3, 15, 0).getTime()), '03:30');
  assert.equal(getDefaultEndTime(new Date(2026, 10, 22, 14, 14, 59).getTime()), '14:15');
  assert.equal(getDefaultEndTime(new Date(2026, 10, 22, 23, 50, 0).getTime()), '00:00');
});

test('shouldAutoResetExpiredSession resets only after all YouTube tabs stay closed >= 10s', () => {
  const closedAt = Date.parse('2026-11-22T10:00:00Z');
  const expiredOpen = makeActiveSession({ status: 'expired', allYouTubeClosedAtMs: null });
  assert.equal(shouldAutoResetExpiredSession(expiredOpen, closedAt + 20_000), false);

  const expiredClosed = makeActiveSession({ status: 'expired', allYouTubeClosedAtMs: closedAt });
  assert.equal(shouldAutoResetExpiredSession(expiredClosed, closedAt + 5_000), false);
  assert.equal(shouldAutoResetExpiredSession(expiredClosed, closedAt + 10_000), true);
  assert.equal(shouldAutoResetExpiredSession(expiredClosed, closedAt + 60_000), true);
});
