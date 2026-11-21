// src/core/duration.ts
function extractLengthSecondsFromHtml(html) {
  const match = html.match(/"lengthSeconds"\s*:\s*"(\d+)"/);
  if (!match?.[1]) return null;
  const parsed = Number.parseInt(match[1], 10);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : null;
}

// src/core/policy.ts
function resolveBudgetBounds(spec, nowMs) {
  if (spec.mode === "maxLength") {
    return { startedAtMs: nowMs, endsAtMs: null };
  }
  if (spec.mode === "countdown") {
    const durationMs = Math.max(1, spec.durationMinutes) * 6e4;
    return { startedAtMs: nowMs, endsAtMs: nowMs + durationMs };
  }
  const parts = spec.endTime.split(":").map((n) => Number.parseInt(n, 10));
  const hours = parts[0];
  const minutes = parts[1];
  if (hours === void 0 || minutes === void 0 || Number.isNaN(hours) || Number.isNaN(minutes) || hours < 0 || hours > 23 || minutes < 0 || minutes > 59) {
    throw new Error(`Invalid endTime format "${spec.endTime}". Expected "HH:MM".`);
  }
  const target = new Date(nowMs);
  target.setHours(hours, minutes, 0, 0);
  if (target.getTime() <= nowMs) {
    target.setDate(target.getDate() + 1);
  }
  return { startedAtMs: nowMs, endsAtMs: target.getTime() };
}
function computeRemainingMs(state, nowMs) {
  if (state.status !== "active" || !state.spec || state.spec.mode === "maxLength") {
    return null;
  }
  if (state.endsAtMs === null) return null;
  return Math.max(0, state.endsAtMs - nowMs);
}

// src/core/types.ts
var DEFAULT_POLICY = {
  shortsMode: "escalatingNudge",
  shortsLockCutoffMinutes: 5,
  hideShortsNavButton: true,
  showShortDurationBadges: true,
  livestreams: "hide",
  unknownDuration: "hide",
  exceedAction: "hide",
  bufferSeconds: 15
};
var INITIAL_PERSISTED_STATE = {
  id: null,
  status: "idle",
  spec: null,
  startedAtMs: null,
  endsAtMs: null,
  autoplayOnboarding: "unseen",
  shortsLockedForSession: false,
  acknowledgedPrompts: {
    nudge_50: false,
    nudge_25: false
  },
  policy: { ...DEFAULT_POLICY }
};

// src/shared/webext.ts
var rawApi = globalThis.browser ?? globalThis.chrome;
var webext = rawApi;

// src/background/index.ts
var STATE_KEY = "ytTimeFitSessionState";
var SHORT_CACHE_KEY = "ytTimeFitShortDurationCache";
var EXPIRY_ALARM = "yt-timefit-session-expiry";
var BADGE_TICK_ALARM = "yt-timefit-badge-tick";
var SHORT_CACHE_TTL_MS = 7 * 24 * 60 * 6e4;
var inflightShortFetches = /* @__PURE__ */ new Map();
async function loadState() {
  const result = await webext.storage.local.get(STATE_KEY);
  const stored = result[STATE_KEY];
  if (!stored) {
    return {
      ...INITIAL_PERSISTED_STATE,
      policy: { ...INITIAL_PERSISTED_STATE.policy },
      acknowledgedPrompts: { ...INITIAL_PERSISTED_STATE.acknowledgedPrompts }
    };
  }
  return {
    ...INITIAL_PERSISTED_STATE,
    ...stored,
    policy: { ...INITIAL_PERSISTED_STATE.policy, ...stored.policy ?? {} },
    acknowledgedPrompts: {
      ...INITIAL_PERSISTED_STATE.acknowledgedPrompts,
      ...stored.acknowledgedPrompts ?? {}
    }
  };
}
async function saveState(state) {
  await webext.storage.local.set({ [STATE_KEY]: state });
  await syncAlarmsAndBadge(state);
}
async function syncAlarmsAndBadge(state) {
  await webext.alarms.clear(EXPIRY_ALARM);
  await webext.alarms.clear(BADGE_TICK_ALARM);
  const nowMs = Date.now();
  const remainingMs = computeRemainingMs(state, nowMs);
  if (state.status === "active" && state.spec) {
    if (state.spec.mode === "maxLength") {
      await setBadge(`${state.spec.maxMinutes}m`, "#2563eb");
      return;
    }
    if (state.endsAtMs !== null && remainingMs !== null && remainingMs > 0) {
      webext.alarms.create(EXPIRY_ALARM, { when: state.endsAtMs });
      webext.alarms.create(BADGE_TICK_ALARM, { periodInMinutes: 1 });
      const minsLeft = Math.max(1, Math.ceil(remainingMs / 6e4));
      await setBadge(`${minsLeft}m`, minsLeft <= 5 ? "#dc2626" : "#0f766e");
      return;
    }
  }
  if (state.status === "expired") {
    await setBadge("0m", "#dc2626");
  } else {
    await setBadge("", "#0f766e");
  }
}
async function setBadge(text, color) {
  try {
    await webext.action?.setBadgeText({ text });
    if (text) {
      await webext.action?.setBadgeBackgroundColor({ color });
    }
  } catch {
  }
}
async function resolveShortDuration(videoId) {
  if (!/^[a-zA-Z0-9_-]{6,}$/.test(videoId)) return null;
  const existing = inflightShortFetches.get(videoId);
  if (existing) return existing;
  const task = (async () => {
    const cacheResult = await webext.storage.local.get(
      SHORT_CACHE_KEY
    );
    const cache = cacheResult[SHORT_CACHE_KEY] ?? {};
    const entry = cache[videoId];
    const now = Date.now();
    if (entry && now - entry.cachedAtMs < SHORT_CACHE_TTL_MS) {
      return entry.durationSeconds;
    }
    try {
      const resp = await fetch(`https://www.youtube.com/watch?v=${encodeURIComponent(videoId)}`, {
        credentials: "omit"
      });
      if (!resp.ok) return null;
      const html = await resp.text();
      const seconds = extractLengthSecondsFromHtml(html);
      if (seconds !== null) {
        const keys = Object.keys(cache);
        if (keys.length > 400) {
          keys.sort((a, b) => (cache[a]?.cachedAtMs ?? 0) - (cache[b]?.cachedAtMs ?? 0)).slice(0, keys.length - 300).forEach((k) => delete cache[k]);
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
async function wakeAllYouTubeTabs() {
  try {
    const tabs = await webext.tabs.query({
      url: ["https://www.youtube.com/*", "https://m.youtube.com/*"]
    });
    await Promise.allSettled(
      tabs.filter((t) => typeof t.id === "number").map((t) => webext.tabs.sendMessage(t.id, { type: "WAKE_FROM_POPUP" }))
    );
  } catch {
  }
}
async function handleMessage(msg) {
  const state = await loadState();
  const nowMs = Date.now();
  switch (msg.type) {
    case "GET_STATE": {
      if (state.status === "active" && state.spec && state.spec.mode !== "maxLength" && state.endsAtMs !== null && state.endsAtMs <= nowMs) {
        const expired = { ...state, status: "expired" };
        await saveState(expired);
        return expired;
      }
      return state;
    }
    case "START_SESSION": {
      const bounds = resolveBudgetBounds(msg.spec, nowMs);
      const next = {
        ...state,
        id: `sess_${nowMs}`,
        status: "active",
        spec: msg.spec,
        startedAtMs: bounds.startedAtMs,
        endsAtMs: bounds.endsAtMs,
        shortsLockedForSession: false,
        acknowledgedPrompts: { nudge_50: false, nudge_25: false },
        policy: { ...state.policy, ...msg.policyOverrides ?? {} }
      };
      await saveState(next);
      await wakeAllYouTubeTabs();
      return next;
    }
    case "EXTEND_SESSION": {
      if (state.status !== "active" && state.status !== "expired") return state;
      if (!state.spec || state.spec.mode === "maxLength") return state;
      const baseEnd = Math.max(nowMs, state.endsAtMs ?? nowMs);
      const nextEnd = baseEnd + Math.max(1, msg.additionalMinutes) * 6e4;
      const next = {
        ...state,
        status: "active",
        endsAtMs: nextEnd
      };
      await saveState(next);
      return next;
    }
    case "STOP_SESSION": {
      const next = {
        ...state,
        id: null,
        status: "idle",
        spec: null,
        startedAtMs: null,
        endsAtMs: null,
        shortsLockedForSession: false,
        acknowledgedPrompts: { nudge_50: false, nudge_25: false }
      };
      await saveState(next);
      return next;
    }
    case "UPDATE_POLICY": {
      const next = {
        ...state,
        policy: { ...state.policy, ...msg.patch }
      };
      await saveState(next);
      return next;
    }
    case "SET_AUTOPLAY_ONBOARDING": {
      const next = {
        ...state,
        autoplayOnboarding: msg.state
      };
      await saveState(next);
      return next;
    }
    case "ACK_SHORTS_PROMPT": {
      const next = {
        ...state,
        acknowledgedPrompts: {
          ...state.acknowledgedPrompts,
          [msg.stage]: true
        }
      };
      await saveState(next);
      return next;
    }
    case "LOCK_SHORTS_FOR_SESSION": {
      if (state.shortsLockedForSession) return state;
      const next = {
        ...state,
        shortsLockedForSession: true
      };
      await saveState(next);
      return next;
    }
    case "WAKE_FROM_POPUP": {
      await wakeAllYouTubeTabs();
      return state;
    }
    case "FETCH_SHORT_DURATION": {
      const durationSeconds = await resolveShortDuration(msg.videoId);
      return { videoId: msg.videoId, durationSeconds };
    }
  }
}
function bootBackgroundSessionRuntime() {
  webext.runtime.onMessage.addListener((message, _sender, sendResponse) => {
    if (!message || typeof message !== "object" || !("type" in message)) {
      return false;
    }
    handleMessage(message).then((res) => sendResponse(res)).catch((err) => sendResponse({ error: String(err) }));
    return true;
  });
  webext.alarms.onAlarm.addListener(async (alarm) => {
    const state = await loadState();
    if (alarm.name === EXPIRY_ALARM) {
      if (state.status === "active" && state.endsAtMs !== null && state.endsAtMs <= Date.now()) {
        await saveState({ ...state, status: "expired" });
      }
    } else if (alarm.name === BADGE_TICK_ALARM) {
      await syncAlarmsAndBadge(state);
    }
  });
  const rehydrate = () => {
    loadState().then((s) => syncAlarmsAndBadge(s)).catch(() => void 0);
  };
  webext.runtime.onInstalled?.addListener(rehydrate);
  webext.runtime.onStartup?.addListener(rehydrate);
  rehydrate();
}
bootBackgroundSessionRuntime();
export {
  bootBackgroundSessionRuntime
};
//# sourceMappingURL=background.js.map
