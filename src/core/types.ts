export type BudgetSpec =
  | { mode: 'countdown'; durationMinutes: number }
  | { mode: 'until'; endTime: string } // Local 24-hour "HH:MM"
  | { mode: 'maxLength'; maxMinutes: number };

export type ShortsMode =
  | 'redirectToWatch'   // Toggle ON: open Shorts in standard /watch?v= player
  | 'escalatingNudge';  // Toggle OFF: 50% -> 25% -> forced switch & lock at 5/10m

export type ShortsStage =
  | 'unrestricted'
  | 'nudge_50'
  | 'nudge_25'
  | 'locked_to_watch';

export type AutoplayOnboardingState =
  | 'unseen'
  | 'claimed_disabled'
  | 'verified_disabled';

export type AutoplayObservedState = 'unknown' | 'disabled' | 'enabled';

export type SessionStatus =
  | 'idle'
  | 'needs_autoplay_setup'
  | 'snoozed'
  | 'active'
  | 'expired';

export interface FilterPolicy {
  shortsMode: ShortsMode;
  shortsLockCutoffMinutes: 5 | 10;
  hideShortsNavButton: boolean;
  showShortDurationBadges: boolean;
  livestreams: 'hide' | 'allow';
  unknownDuration: 'hide' | 'allow';
  exceedAction: 'hide' | 'dim';
  bufferSeconds: number;
}

export interface PersistedSessionState {
  id: string | null;
  status: 'idle' | 'active' | 'expired';
  spec: BudgetSpec | null;
  startedAtMs: number | null;
  endsAtMs: number | null;
  autoplayOnboarding: AutoplayOnboardingState;
  shortsLockedForSession: boolean;
  acknowledgedPrompts: {
    nudge_50: boolean;
    nudge_25: boolean;
  };
  policy: FilterPolicy;
}

export interface SessionSnapshot {
  id: string | null;
  status: SessionStatus;
  spec: BudgetSpec | null;
  startedAtMs: number | null;
  endsAtMs: number | null;
  remainingMs: number | null;
  maxAllowedVideoSeconds: number | null;
  autoplayOnboarding: AutoplayOnboardingState;
  autoplayObserved: AutoplayObservedState;
  shortsStage: ShortsStage;
  shortsLockedForSession: boolean;
  acknowledgedPrompts: {
    nudge_50: boolean;
    nudge_25: boolean;
  };
  policy: FilterPolicy;
}

export interface VideoCandidate {
  id: string;
  kind: 'video' | 'short' | 'livestream' | 'unknown';
  durationSeconds: number | null;
}

export type FilterVerdict = 'allow' | 'hide' | 'dim';

export interface Clock {
  now(): number;
}

export const DEFAULT_POLICY: FilterPolicy = {
  shortsMode: 'escalatingNudge',
  shortsLockCutoffMinutes: 5,
  hideShortsNavButton: true,
  showShortDurationBadges: true,
  livestreams: 'hide',
  unknownDuration: 'hide',
  exceedAction: 'hide',
  bufferSeconds: 15,
};

export const INITIAL_PERSISTED_STATE: PersistedSessionState = {
  id: null,
  status: 'idle',
  spec: null,
  startedAtMs: null,
  endsAtMs: null,
  autoplayOnboarding: 'unseen',
  shortsLockedForSession: false,
  acknowledgedPrompts: {
    nudge_50: false,
    nudge_25: false,
  },
  policy: { ...DEFAULT_POLICY },
};

// Cross-context message contracts
export type RuntimeMessage =
  | { type: 'GET_STATE' }
  | { type: 'START_SESSION'; spec: BudgetSpec; policyOverrides?: Partial<FilterPolicy> }
  | { type: 'EXTEND_SESSION'; additionalMinutes: number }
  | { type: 'STOP_SESSION' }
  | { type: 'UPDATE_POLICY'; patch: Partial<FilterPolicy> }
  | { type: 'SET_AUTOPLAY_ONBOARDING'; state: AutoplayOnboardingState }
  | { type: 'ACK_SHORTS_PROMPT'; stage: 'nudge_50' | 'nudge_25' }
  | { type: 'LOCK_SHORTS_FOR_SESSION' }
  | { type: 'WAKE_FROM_POPUP' }
  | { type: 'FETCH_SHORT_DURATION'; videoId: string };
