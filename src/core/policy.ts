import {
  AutoplayObservedState,
  BudgetSpec,
  FilterVerdict,
  PersistedSessionState,
  PlaybackOverrunAnalysis,
  SessionSnapshot,
  ShortsStage,
  VideoCandidate,
} from './types';

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

export function computeRemainingMs(
  state: Pick<PersistedSessionState, 'status' | 'spec' | 'endsAtMs' | 'pausedRemainingMs'>,
  nowMs: number,
): number | null {
  if (!state.spec || state.spec.mode === 'maxLength') {
    return null;
  }
  if (state.status === 'paused') {
    return state.pausedRemainingMs !== null ? Math.max(0, state.pausedRemainingMs) : null;
  }
  if (state.status !== 'active' || state.endsAtMs === null) {
    return null;
  }
  return Math.max(0, state.endsAtMs - nowMs);
}

export function computeMaxAllowedSeconds(
  state: Pick<PersistedSessionState, 'status' | 'spec' | 'endsAtMs' | 'pausedRemainingMs' | 'policy'>,
  nowMs: number,
): number | null {
  if ((state.status !== 'active' && state.status !== 'paused') || !state.spec) return null;

  if (state.spec.mode === 'maxLength') {
    return Math.max(0, Math.round(state.spec.maxMinutes * 60));
  }

  const remainingMs = computeRemainingMs(state, nowMs);
  if (remainingMs === null) return null;

  const remainingSec = Math.floor(remainingMs / 1000);
  return Math.max(0, remainingSec - Math.max(0, state.policy.bufferSeconds));
}

export function computePlaybackOverrun(
  videoCurrentSeconds: number,
  videoDurationSeconds: number,
  playbackRate: number,
  remainingMs: number,
): PlaybackOverrunAnalysis {
  const safeDuration = Math.max(0, videoDurationSeconds);
  const safeCurrent = Math.min(safeDuration, Math.max(0, videoCurrentSeconds));
  const safeRate = Math.max(0.25, playbackRate || 1);
  const videoRemainingSeconds = Math.max(0, safeDuration - safeCurrent);
  const breakRemainingSeconds = Math.max(0, remainingMs / 1000);

  const effectiveVideoRemaining = videoRemainingSeconds / safeRate;
  const isOverrunning = safeDuration > 0 && effectiveVideoRemaining > breakRemainingSeconds + 2;

  const extraSecondsNeeded = isOverrunning
    ? Math.ceil(effectiveVideoRemaining - breakRemainingSeconds)
    : 0;

  let suggestedSpeed: number | null = null;
  if (isOverrunning && breakRemainingSeconds > 0) {
    const rawNeeded = videoRemainingSeconds / breakRemainingSeconds;
    const roundedUp = Math.ceil(rawNeeded * 100) / 100;
    if (roundedUp <= 2.0 && roundedUp > safeRate) {
      suggestedSpeed = roundedUp;
    }
  }

  const cutoffVideoSeconds = Math.min(
    safeDuration,
    safeCurrent + breakRemainingSeconds * safeRate,
  );
  const cutoffPercent =
    safeDuration > 0 ? Math.min(100, Math.max(0, (cutoffVideoSeconds / safeDuration) * 100)) : 100;

  return {
    isOverrunning,
    videoRemainingSeconds,
    breakRemainingSeconds,
    extraSecondsNeeded,
    suggestedSpeed,
    cutoffVideoSeconds,
    cutoffPercent,
  };
}

export function computeShortsStage(
  state: Pick<
    PersistedSessionState,
    'status' | 'spec' | 'startedAtMs' | 'endsAtMs' | 'pausedRemainingMs' | 'shortsLockedForSession' | 'policy'
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

export function evaluateVideoCandidate(
  candidate: VideoCandidate,
  snapshot: SessionSnapshot,
): FilterVerdict {
  if (
    (snapshot.status !== 'active' && snapshot.status !== 'paused') ||
    snapshot.maxAllowedVideoSeconds === null
  ) {
    return 'allow';
  }

  const failAction: FilterVerdict = snapshot.policy.exceedAction;

  if (candidate.kind === 'livestream') {
    return snapshot.policy.livestreams === 'hide' ? failAction : 'allow';
  }

  if (candidate.durationSeconds === null) {
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
      derivedStatus === 'active' || derivedStatus === 'paused'
        ? computeMaxAllowedSeconds(effectiveState, nowMs)
        : null,
    autoplayOnboarding: effectiveState.autoplayOnboarding,
    autoplayObserved,
    shortsStage: computeShortsStage(effectiveState, nowMs),
    shortsLockedForSession: effectiveState.shortsLockedForSession,
    acknowledgedPrompts: { ...effectiveState.acknowledgedPrompts },
    policy: { ...effectiveState.policy },
  };
}

export function buildStandardWatchUrl(
  videoId: string,
  currentTimeSeconds?: number,
  origin: string = 'https://www.youtube.com',
): string {
  const base = `${origin}/watch?v=${encodeURIComponent(videoId)}`;
  if (currentTimeSeconds && currentTimeSeconds >= 1) {
    return `${base}&t=${Math.floor(currentTimeSeconds)}s`;
  }
  return base;
}
