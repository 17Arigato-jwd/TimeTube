import { extractLengthSecondsFromHtml, formatApproxRemaining } from '../core/duration';
import {
  computeRemainingMs,
  resolveBudgetBounds,
} from '../core/policy';
import {
  INITIAL_PERSISTED_STATE,
  PersistedSessionState,
  RuntimeMessage,
} from '../core/types';
import { webext } from '../shared/webext';

const STATE_KEY = 'ytTimeFitSessionState';
const SHORT_CACHE_KEY = 'ytTimeFitShortDurationCache';
const EXPIRY_ALARM = 'yt-timetube-session-expiry';
const BADGE_TICK_ALARM = 'yt-timetube-badge-tick';
const SHORT_CACHE_TTL_MS = 7 * 24 * 60 * 60_000;

interface CachedDuration {
  durationSeconds: number;
  cachedAtMs: number;
}

const inflightShortFetches = new Map<string, Promise<number | null>>();

async function loadState(): Promise<PersistedSessionState> {
  const result = await webext.storage.local.get<Record<string, PersistedSessionState | undefined>>(STATE_KEY);
  const stored = result[STATE_KEY];
  if (!stored) {
    return {
      ...INITIAL_PERSISTED_STATE,
      policy: { ...INITIAL_PERSISTED_STATE.policy },
      acknowledgedPrompts: { ...INITIAL_PERSISTED_STATE.acknowledgedPrompts },
    };
  }
  return {
    ...INITIAL_PERSISTED_STATE,
    ...stored,
    policy: { ...INITIAL_PERSISTED_STATE.policy, ...(stored.policy ?? {}) },
    acknowledgedPrompts: {
      ...INITIAL_PERSISTED_STATE.acknowledgedPrompts,
      ...(stored.acknowledgedPrompts ?? {}),
    },
  };
}

async function saveState(state: PersistedSessionState): Promise<void> {
  await webext.storage.local.set({ [STATE_KEY]: state });
  await syncAlarmsAndBadge(state);
}

async function syncAlarmsAndBadge(state: PersistedSessionState): Promise<void> {
  await webext.alarms.clear(EXPIRY_ALARM);
  await webext.alarms.clear(BADGE_TICK_ALARM);

  const nowMs = Date.now();
  const remainingMs = computeRemainingMs(state, nowMs);

  if (state.status === 'paused') {
    const label = remainingMs !== null ? formatApproxRemaining(remainingMs) : 'II';
    await setBadge(label, '#d97706');
    return;
  }

  if (state.status === 'active' && state.spec) {
    if (state.spec.mode === 'maxLength') {
      await setBadge(formatApproxRemaining(state.spec.maxMinutes * 60_000), '#2563eb');
      return;
    }

    if (state.endsAtMs !== null && remainingMs !== null && remainingMs > 0) {
      webext.alarms.create(EXPIRY_ALARM, { when: state.endsAtMs });
      webext.alarms.create(BADGE_TICK_ALARM, { periodInMinutes: 1 });
      const label = formatApproxRemaining(remainingMs);
      await setBadge(label, remainingMs <= 5 * 60_000 ? '#ff0033' : '#0f766e');
      return;
    }
  }

  if (state.status === 'expired') {
    await setBadge('0s', '#ff0033');
  } else {
    await setBadge('', '#0f766e');
  }
}

async function setBadge(text: string, color: string): Promise<void> {
  try {
    await webext.action?.setBadgeText({ text });
    if (text) {
      await webext.action?.setBadgeBackgroundColor({ color });
    }
  } catch {
    // Some mobile Firefox builds omit badge styling APIs.
  }
}

async function resolveShortDuration(videoId: string): Promise<number | null> {
  if (!/^[a-zA-Z0-9_-]{6,}$/.test(videoId)) return null;

  const existing = inflightShortFetches.get(videoId);
  if (existing) return existing;

  const task = (async (): Promise<number | null> => {
    const cacheResult = await webext.storage.local.get<Record<string, Record<string, CachedDuration> | undefined>>(
      SHORT_CACHE_KEY,
    );
    const cache = cacheResult[SHORT_CACHE_KEY] ?? {};
    const entry = cache[videoId];
    const now = Date.now();
    if (entry && now - entry.cachedAtMs < SHORT_CACHE_TTL_MS) {
      return entry.durationSeconds;
    }

    try {
      const resp = await fetch(`https://www.youtube.com/watch?v=${encodeURIComponent(videoId)}`, {
        credentials: 'omit',
      });
      if (!resp.ok) return null;
      const html = await resp.text();
      const seconds = extractLengthSecondsFromHtml(html);
      if (seconds !== null) {
        const keys = Object.keys(cache);
        if (keys.length > 400) {
          keys
            .sort((a, b) => (cache[a]?.cachedAtMs ?? 0) - (cache[b]?.cachedAtMs ?? 0))
            .slice(0, keys.length - 300)
            .forEach((k) => delete cache[k]);
        }
        cache[videoId] = { durationSeconds: seconds, cachedAtMs: now };
        await webext.storage.local.set({ [SHORT_CACHE_KEY]: cache });
      }
      return seconds;
    } catch {
      return null;
    } finally {
      inflightShortFetches.delete(videoId);
    }
  })();

  inflightShortFetches.set(videoId, task);
  return task;
}

async function wakeAllYouTubeTabs(): Promise<void> {
  try {
    const tabs = await webext.tabs.query({
      url: ['https://www.youtube.com/*', 'https://m.youtube.com/*'],
    });
    await Promise.allSettled(
      tabs
        .filter((t): t is { id: number } => typeof t.id === 'number')
        .map((t) => webext.tabs.sendMessage(t.id, { type: 'WAKE_FROM_POPUP' })),
    );
  } catch {
    // Ignore if no YouTube tabs are open.
  }
}

async function handleMessage(msg: RuntimeMessage): Promise<unknown> {
  const state = await loadState();
  const nowMs = Date.now();

  switch (msg.type) {
    case 'GET_STATE': {
      if (
        state.status === 'active' &&
        state.spec &&
        state.spec.mode !== 'maxLength' &&
        state.endsAtMs !== null &&
        state.endsAtMs <= nowMs
      ) {
        const expired: PersistedSessionState = { ...state, status: 'expired' };
        await saveState(expired);
        return expired;
      }
      await syncAlarmsAndBadge(state);
      return state;
    }

    case 'START_SESSION': {
      const bounds = resolveBudgetBounds(msg.spec, nowMs);
      const next: PersistedSessionState = {
        ...state,
        id: `sess_${nowMs}`,
        status: 'active',
        spec: msg.spec,
        startedAtMs: bounds.startedAtMs,
        endsAtMs: bounds.endsAtMs,
        pausedAtMs: null,
        pausedRemainingMs: null,
        shortsLockedForSession: false,
        acknowledgedPrompts: { nudge_50: false, nudge_25: false },
        policy: { ...state.policy, ...(msg.policyOverrides ?? {}) },
      };
      await saveState(next);
      await wakeAllYouTubeTabs();
      return next;
    }

    case 'EXTEND_SESSION': {
      if (state.status !== 'active' && state.status !== 'paused' && state.status !== 'expired') {
        return state;
      }
      if (!state.spec || state.spec.mode === 'maxLength') return state;
      const deltaMs = Math.max(1, msg.additionalMinutes) * 60_000;
      if (state.status === 'paused') {
        const next: PersistedSessionState = {
          ...state,
          pausedRemainingMs: (state.pausedRemainingMs ?? 0) + deltaMs,
        };
        await saveState(next);
        return next;
      }
      const baseEnd = Math.max(nowMs, state.endsAtMs ?? nowMs);
      const next: PersistedSessionState = {
        ...state,
        status: 'active',
        endsAtMs: baseEnd + deltaMs,
        pausedAtMs: null,
        pausedRemainingMs: null,
      };
      await saveState(next);
      return next;
    }

    case 'EXTEND_SESSION_SECONDS': {
      if (state.status !== 'active' && state.status !== 'paused' && state.status !== 'expired') {
        return state;
      }
      if (!state.spec || state.spec.mode === 'maxLength') return state;
      const deltaMs = Math.max(1, Math.ceil(msg.additionalSeconds)) * 1000;
      if (state.status === 'paused') {
        const next: PersistedSessionState = {
          ...state,
          pausedRemainingMs: (state.pausedRemainingMs ?? 0) + deltaMs,
        };
        await saveState(next);
        return next;
      }
      const baseEnd = Math.max(nowMs, state.endsAtMs ?? nowMs);
      const next: PersistedSessionState = {
        ...state,
        status: 'active',
        endsAtMs: baseEnd + deltaMs,
        pausedAtMs: null,
        pausedRemainingMs: null,
      };
      await saveState(next);
      return next;
    }

    case 'PAUSE_TIMER': {
      if (state.status !== 'active' || state.spec?.mode !== 'countdown' || state.endsAtMs === null) {
        return state;
      }
      const remaining = Math.max(0, state.endsAtMs - nowMs);
      const next: PersistedSessionState = {
        ...state,
        status: 'paused',
        pausedAtMs: nowMs,
        pausedRemainingMs: remaining,
      };
      await saveState(next);
      return next;
    }

    case 'RESUME_TIMER': {
      if (state.status !== 'paused' || state.pausedRemainingMs === null) {
        return state;
      }
      const pausedDurationMs = state.pausedAtMs !== null ? Math.max(0, nowMs - state.pausedAtMs) : 0;
      const next: PersistedSessionState = {
        ...state,
        status: 'active',
        startedAtMs: state.startedAtMs !== null ? state.startedAtMs + pausedDurationMs : nowMs,
        endsAtMs: nowMs + state.pausedRemainingMs,
        pausedAtMs: null,
        pausedRemainingMs: null,
      };
      await saveState(next);
      return next;
    }

    case 'STOP_SESSION': {
      const next: PersistedSessionState = {
        ...state,
        id: null,
        status: 'idle',
        spec: null,
        startedAtMs: null,
        endsAtMs: null,
        pausedAtMs: null,
        pausedRemainingMs: null,
        shortsLockedForSession: false,
        acknowledgedPrompts: { nudge_50: false, nudge_25: false },
      };
      await saveState(next);
      return next;
    }

    case 'UPDATE_POLICY': {
      const next: PersistedSessionState = {
        ...state,
        policy: { ...state.policy, ...msg.patch },
      };
      await saveState(next);
      return next;
    }

    case 'SET_AUTOPLAY_ONBOARDING': {
      const next: PersistedSessionState = {
        ...state,
        autoplayOnboarding: msg.state,
      };
      await saveState(next);
      return next;
    }

    case 'ACK_SHORTS_PROMPT': {
      const next: PersistedSessionState = {
        ...state,
        acknowledgedPrompts: {
          ...state.acknowledgedPrompts,
          [msg.stage]: true,
        },
      };
      await saveState(next);
      return next;
    }

    case 'LOCK_SHORTS_FOR_SESSION': {
      if (state.shortsLockedForSession) return state;
      const next: PersistedSessionState = {
        ...state,
        shortsLockedForSession: true,
      };
      await saveState(next);
      return next;
    }

    case 'SYNC_BADGE': {
      await syncAlarmsAndBadge(state);
      return { ok: true };
    }

    case 'WAKE_FROM_POPUP': {
      await wakeAllYouTubeTabs();
      return state;
    }

    case 'FETCH_SHORT_DURATION': {
      const durationSeconds = await resolveShortDuration(msg.videoId);
      return { videoId: msg.videoId, durationSeconds };
    }
  }
}

export function bootBackgroundSessionRuntime(): void {
  webext.runtime.onMessage.addListener((message, _sender, sendResponse) => {
    if (!message || typeof message !== 'object' || !('type' in message)) {
      return false;
    }
    handleMessage(message as RuntimeMessage)
      .then((res) => sendResponse(res))
      .catch((err) => sendResponse({ error: String(err) }));
    return true;
  });

  webext.alarms.onAlarm.addListener(async (alarm) => {
    const state = await loadState();
    if (alarm.name === EXPIRY_ALARM) {
      if (state.status === 'active' && state.endsAtMs !== null && state.endsAtMs <= Date.now()) {
        await saveState({ ...state, status: 'expired' });
      }
    } else if (alarm.name === BADGE_TICK_ALARM) {
      await syncAlarmsAndBadge(state);
    }
  });

  const rehydrate = () => {
    loadState().then((s) => syncAlarmsAndBadge(s)).catch(() => undefined);
  };
  webext.runtime.onInstalled?.addListener(rehydrate);
  webext.runtime.onStartup?.addListener(rehydrate);
  rehydrate();
}

bootBackgroundSessionRuntime();
