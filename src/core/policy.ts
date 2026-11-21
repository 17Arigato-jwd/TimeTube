import {
  AutoplayObservedState,
  BudgetSpec,
  FilterVerdict,
  PersistedSessionState,
  SessionSnapshot,
  ShortsStage,
  VideoCandidate,
} from './types';

/**
 * Resolves a BudgetSpec into canonical epoch timestamps.
 * For `until`, parses local 24h "HH:MM" and rolls over to tomorrow if that time has already passed.
 */
export function resolveBudgetBounds(
  spec: BudgetSpec,
  nowMs: number,
): { startedAtMs: number | null; endsAtMs: number | null } {
  if (spec.mode === 'maxLength') {
    return { startedAtMs: nowMs, endsAtMs: null };
  }

  if (spec.mode === 'countdown') {
    const durationMs = Math.max(1, spec.durationMinutes) * 60_000;
    return { startedAtMs: nowMs, endsAtMs: nowMs + durationMs };
  }

  // mode === 'until'
  const parts = spec.endTime.split(':').map((n) => Number.parseInt(n, 10));
  const hours = parts[0];
  const minutes = parts[1];
  if (
    hours === undefined ||
    minutes === undefined ||
    Number.isNaN(hours) ||
    Number.isNaN(minutes) ||
    hours < 0 ||
    hours > 23 ||
    minutes < 0 ||
    minutes > 59
  ) {
    throw new Error(`Invalid endTime format "${spec.endTime}". Expected "HH:MM".`);
  }

  const target = new Date(nowMs);
  target.setHours(hours, minutes, 0, 0);
  if (target.getTime() <= nowMs) {
    target.setDate(target.getDate() + 1);
  }
  return { startedAtMs: nowMs, endsAtMs: target.getTime() };
}

/** Computes remaining milliseconds for timed sessions (null for idle or static maxLength). */
export function computeRemainingMs(
  state: Pick<PersistedSessionState, 'status' | 'spec' | 'endsAtMs'>,
  nowMs: number,
): number | null {
  if (state.status !== 'active' || !state.spec || state.spec.mode === 'maxLength') {
    return null;
  }
  if (state.endsAtMs === null) return null;
  return Math.max(0, state.endsAtMs - nowMs);
}

/**
 * Computes the effective maximum video duration (in seconds) that a user can click *now*
 * and still finish before the time limit ends.
 */
export function computeMaxAllowedSeconds(
  state: Pick<PersistedSessionState, 'status' | 'spec' | 'endsAtMs' | 'policy'>,
  nowMs: number,
): number | null {
  if (state.status !== 'active' || !state.spec) return null;

  if (state.spec.mode === 'maxLength') {
    return Math.max(0, Math.round(state.spec.maxMinutes * 60));
  }

  const remainingMs = computeRemainingMs(state, nowMs);
  if (remainingMs === null) return null;

  const remainingSec = Math.floor(remainingMs / 1000);
  return Math.max(0, remainingSec - Math.max(0, state.policy.bufferSeconds));
}

/**
 * Computes the graduated Shorts escalation stage for a timed session:
 * - If Shorts toggle is ON (`redirectToWatch`) or already locked this session -> `locked_to_watch`
 * - If within final 5 or 10 minutes before break ends -> `locked_to_watch`
 * - Else if <= 25% of break remaining (75% elapsed) -> `nudge_25`
 * - Else if <= 50% of break remaining (50% elapsed) -> `nudge_50`
 * - Else -> `unrestricted`
 */
export function computeShortsStage(
  state: Pick<
    PersistedSessionState,
    'status' | 'spec' | 'startedAtMs' | 'endsAtMs' | 'shortsLockedForSession' | 'policy'
  >,
  nowMs: number,
): ShortsStage {
  if (state.policy.shortsMode === 'redirectToWatch') {
    return 'locked_to_watch';
  }

  if (state.shortsLockedForSession) {
    return 'locked_to_watch';
  }

  if (
    state.status !== 'active' ||
    !state.spec ||
    state.spec.mode === 'maxLength' ||
    state.startedAtMs === null ||
    state.endsAtMs === null
  ) {
    return 'unrestricted';
  }

  const totalMs = Math.max(1, state.endsAtMs - state.startedAtMs);
  const remainingMs = Math.max(0, state.endsAtMs - nowMs);
  const cutoffMs = state.policy.shortsLockCutoffMinutes * 60_000;

  if (remainingMs <= cutoffMs) {
    return 'locked_to_watch';
  }
  if (remainingMs <= totalMs * 0.25) {
    return 'nudge_25';
  }
  if (remainingMs <= totalMs * 0.5) {
    return 'nudge_50';
  }

  return 'unrestricted';
}

/**
 * Evaluates a single video or Short thumbnail against the current session snapshot.
 * Shorts are treated as normal video thumbnails on Home/Search and filtered strictly by duration.
 */
export function evaluateVideoCandidate(
  candidate: VideoCandidate,
  snapshot: SessionSnapshot,
): FilterVerdict {
  if (snapshot.status !== 'active' || snapshot.maxAllowedVideoSeconds === null) {
    return 'allow';
  }

  const failAction: FilterVerdict = snapshot.policy.exceedAction;

  if (candidate.kind === 'livestream') {
    return snapshot.policy.livestreams === 'hide' ? failAction : 'allow';
  }

  if (candidate.durationSeconds === null) {
    // Wait for Shorts duration to resolve rather than hiding them blindly on Home/Search
    if (candidate.kind === 'short') {
      return 'allow';
    }
    return snapshot.policy.unknownDuration === 'hide' ? failAction : 'allow';
  }

  if (candidate.durationSeconds > snapshot.maxAllowedVideoSeconds) {
    return failAction;
  }

  return 'allow';
}

/** Builds a derived, UI-ready SessionSnapshot from persisted state + tab runtime signals. */
export function buildSessionSnapshot(
  state: PersistedSessionState,
  nowMs: number,
  options: {
    snoozed?: boolean;
    autoplayObserved?: AutoplayObservedState;
  } = {},
): SessionSnapshot {
  const snoozed = options.snoozed ?? false;
  const autoplayObserved = options.autoplayObserved ?? 'unknown';

  const remainingMs = computeRemainingMs(state, nowMs);
  const isTimedExpired =
    state.status === 'active' &&
    state.spec !== null &&
    state.spec.mode !== 'maxLength' &&
    remainingMs !== null &&
    remainingMs <= 0;

  let derivedStatus: SessionSnapshot['status'];
  if (snoozed) {
    derivedStatus = 'snoozed';
  } else if (state.autoplayOnboarding === 'unseen') {
    derivedStatus = 'needs_autoplay_setup';
  } else if (autoplayObserved === 'enabled') {
    derivedStatus = 'needs_autoplay_setup';
  } else if (isTimedExpired) {
    derivedStatus = 'expired';
  } else {
    derivedStatus = state.status;
  }

  const effectiveState: PersistedSessionState = isTimedExpired
    ? { ...state, status: 'expired' }
    : state;

  return {
    id: effectiveState.id,
    status: derivedStatus,
    spec: effectiveState.spec,
    startedAtMs: effectiveState.startedAtMs,
    endsAtMs: effectiveState.endsAtMs,
    remainingMs: isTimedExpired ? 0 : remainingMs,
    maxAllowedVideoSeconds:
      derivedStatus === 'active' ? computeMaxAllowedSeconds(effectiveState, nowMs) : null,
    autoplayOnboarding: effectiveState.autoplayOnboarding,
    autoplayObserved,
    shortsStage: computeShortsStage(effectiveState, nowMs),
    shortsLockedForSession: effectiveState.shortsLockedForSession,
    acknowledgedPrompts: { ...effectiveState.acknowledgedPrompts },
    policy: { ...effectiveState.policy },
  };
}

/** Converts a YouTube Short ID and optional playback position into a standard watch URL. */
export function buildStandardWatchUrl(videoId: string, currentTimeSeconds?: number): string {
  const base = `https://www.youtube.com/watch?v=${encodeURIComponent(videoId)}`;
  if (currentTimeSeconds && currentTimeSeconds >= 1) {
    return `${base}&t=${Math.floor(currentTimeSeconds)}s`;
  }
  return base;
}
