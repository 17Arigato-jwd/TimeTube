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
  if (!state.spec || state.spec.mode === "maxLength") {
    return null;
  }
  if (state.status === "paused") {
    return state.pausedRemainingMs !== null ? Math.max(0, state.pausedRemainingMs) : null;
  }
  if (state.status !== "active" || state.endsAtMs === null) {
    return null;
  }
  return Math.max(0, state.endsAtMs - nowMs);
}
function shouldAutoResetExpiredSession(state, nowMs, cooldownMs = 1e4) {
  if (state.status !== "expired" || state.allYouTubeClosedAtMs === null) {
    return false;
  }
  return nowMs - state.allYouTubeClosedAtMs >= cooldownMs;
}

// src/core/schedule.ts
var SCHEDULE_KEY = "timeTubeSchedule";
var DAY_NAMES = ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"];
var MINUTE_MS = 6e4;
var MAX_SAMPLE_GAP_MS = 1e4;
var EMPTY_SCHEDULE = { enabled: false, rules: [], usage: {} };
function ruleLabel(days) {
  const ordered = [1, 2, 3, 4, 5, 6, 0].filter((day) => days.includes(day));
  if (ordered.length === 7) return "Every day";
  if (ordered.join() === "1,2,3,4,5") return "Weekdays";
  if (ordered.join() === "6,0") return "Weekends";
  return ordered.map((day) => DAY_NAMES[day]).join(", ");
}
function validateSchedule(enabled, rules) {
  if (enabled && !rules.length) throw new Error("Add a rule before enabling the schedule.");
  const owners = /* @__PURE__ */ new Map();
  const ids = /* @__PURE__ */ new Set();
  for (const rule of rules) {
    if (!rule.id || ids.has(rule.id)) throw new Error("Each rule must have a unique ID.");
    ids.add(rule.id);
    if (!rule.days.length) throw new Error("Select at least one day.");
    for (const day of rule.days) {
      if (!Number.isInteger(day) || day < 0 || day > 6) throw new Error("Select a valid day.");
      const owner = owners.get(day);
      if (owner) throw new Error(`${DAY_NAMES[day]} already belongs to the ${ruleLabel(owner.days)} rule.`);
      owners.set(day, rule);
    }
    const time = /^(?:[01]\d|2[0-3]):[0-5]\d$/;
    if (!time.test(rule.start) || !time.test(rule.end) || rule.start === rule.end) {
      throw new Error("Choose different start and end times.");
    }
    if (!Number.isInteger(rule.limitMinutes) || rule.limitMinutes < 1 || rule.limitMinutes > 1440) {
      throw new Error("Enter a daily limit between 1 and 1,440 minutes.");
    }
    if (rule.mode !== "site" && rule.mode !== "playback") throw new Error("Choose how to count usage.");
  }
}
function dateKey(date) {
  return [date.getFullYear(), date.getMonth() + 1, date.getDate()].map((part) => String(part).padStart(2, "0")).join("-");
}
function atTime(day, time, nextDay = false) {
  const [hour = 0, minute = 0] = time.split(":").map(Number);
  return new Date(day.getFullYear(), day.getMonth(), day.getDate() + Number(nextDay), hour, minute).getTime();
}
function occurrences(state, now, lastOffset) {
  const date = new Date(now);
  const windows = [];
  for (let offset = -2; offset <= lastOffset; offset++) {
    const day = new Date(date.getFullYear(), date.getMonth(), date.getDate() + offset);
    const rule = state.rules.find((item) => item.days.includes(day.getDay()));
    if (!rule) continue;
    const key = dateKey(day);
    const exception = state.usage[key]?.extra;
    const opensAt = atTime(day, rule.start);
    const closesAt = Math.max(atTime(day, rule.end, rule.end < rule.start), exception?.closesAt ?? 0);
    windows.push({ key, rule, opensAt, closesAt, limitMs: Math.max(rule.limitMinutes * MINUTE_MS, exception?.limitMs ?? 0) });
  }
  return windows;
}
function getScheduleStatus(state, now) {
  if (!state.enabled) return { kind: "off" };
  const today = dateKey(new Date(now));
  const windows = occurrences(state, now, 7);
  const open = windows.filter((window) => window.opensAt <= now && now < window.closesAt);
  for (const window of open) {
    const remainingMs = window.limitMs - (state.usage[window.key]?.usedMs ?? 0);
    if (remainingMs > 0) return { kind: "open", ...window, remainingMs };
  }
  if (!open.length && !windows.some((window) => window.key === today)) return { kind: "unassigned" };
  const candidates = windows.flatMap(({ opensAt, closesAt }) => [opensAt, closesAt]);
  const date = new Date(now);
  for (let offset = 1; offset <= 7; offset++) {
    candidates.push(new Date(date.getFullYear(), date.getMonth(), date.getDate() + offset).getTime());
  }
  const nextOpen = candidates.filter((time) => time > now).sort((a, b) => a - b).find((time) => {
    const current = windows.filter(({ opensAt, closesAt }) => opensAt <= time && time < closesAt);
    if (current.length) return current.some(({ key, limitMs }) => (state.usage[key]?.usedMs ?? 0) < limitMs);
    const day = dateKey(new Date(time));
    return !windows.some((window) => window.key === day);
  }) ?? null;
  return { kind: open.length ? "spent" : "closed", nextOpen };
}
function recordUsage(state, start, end) {
  if (end <= start || end - start > MAX_SAMPLE_GAP_MS) return state;
  const status = getScheduleStatus(state, start);
  const window = status.kind === "open" ? status : getScheduleStatus(state, end - 1);
  if (window.kind !== "open") return state;
  start = Math.max(start, window.opensAt);
  end = Math.min(end, window.closesAt);
  if (end <= start) return state;
  const previous = state.usage[window.key] ?? { usedMs: 0, recent: [] };
  const recent = [];
  let added = end - start;
  let mergedStart = start;
  let mergedEnd = end;
  for (const [from, to] of previous.recent) {
    if (to < end - MAX_SAMPLE_GAP_MS) continue;
    added -= Math.max(0, Math.min(end, to) - Math.max(start, from));
    if (to < mergedStart || from > mergedEnd) {
      recent.push([from, to]);
    } else {
      mergedStart = Math.min(mergedStart, from);
      mergedEnd = Math.max(mergedEnd, to);
    }
  }
  if (added <= 0) return state;
  recent.push([mergedStart, mergedEnd]);
  recent.sort(([left], [right]) => left - right);
  const oldest = new Date(end);
  oldest.setDate(oldest.getDate() - 7);
  const usage = Object.fromEntries(Object.entries(state.usage).filter(([key]) => key >= dateKey(oldest)));
  usage[window.key] = { ...previous, usedMs: previous.usedMs + added, recent };
  return { ...state, usage };
}
function resolveScheduledStart(state, spec, now, choice) {
  const status = getScheduleStatus(state, now);
  if (status.kind === "closed" || status.kind === "spent") return { kind: "unavailable" };
  const { endsAtMs } = resolveBudgetBounds(spec, now);
  if (choice && (status.kind !== "open" || status.key !== choice.key || choice.untilAt !== void 0 && choice.untilAt !== endsAtMs)) return { kind: "unavailable" };
  if (status.kind !== "open" || endsAtMs === null) return { kind: "start", endsAtMs, schedule: state };
  const availableMs = Math.min(status.remainingMs, status.closesAt - now);
  const requestedMs = endsAtMs - now;
  if (requestedMs <= availableMs) return { kind: "start", endsAtMs, schedule: state };
  const extraUsageMs = Math.max(0, requestedMs - status.remainingMs);
  const extraWindowMs = Math.max(0, endsAtMs - status.closesAt);
  if (!choice) {
    const untilAt = spec.mode === "until" ? endsAtMs : void 0;
    return { kind: "conflict", key: status.key, availableMs, requestedMs, extraUsageMs, extraWindowMs, untilAt };
  }
  if (choice.action === "shorten") return { kind: "start", endsAtMs: now + availableMs, schedule: state };
  const usage = state.usage[status.key] ?? { usedMs: 0, recent: [] };
  return {
    kind: "start",
    endsAtMs,
    schedule: {
      ...state,
      usage: {
        ...state.usage,
        [status.key]: { ...usage, extra: { closesAt: Math.max(status.closesAt, endsAtMs), limitMs: status.limitMs + extraUsageMs } }
      }
    }
  };
}

// src/shared/webext.ts
var rawApi = globalThis.browser ?? globalThis.chrome;
var webext = rawApi;

// src/background/schedule.ts
var samples = /* @__PURE__ */ new Map();
var pending = Promise.resolve();
async function processMessage(message, sender, startSession2) {
  const stored = await webext.storage.local.get(SCHEDULE_KEY);
  const schedule = stored[SCHEDULE_KEY] ?? EMPTY_SCHEDULE;
  const now = Date.now();
  switch (message.type) {
    case "SAVE_SCHEDULE": {
      validateSchedule(message.enabled, message.rules);
      const rulesChanged = JSON.stringify(message.rules) !== JSON.stringify(schedule.rules);
      const usage = rulesChanged ? Object.fromEntries(Object.entries(schedule.usage).map(([key, { usedMs, recent }]) => [key, { usedMs, recent }])) : schedule.usage;
      const next = { enabled: message.enabled, rules: message.rules, usage };
      await webext.storage.local.set({ [SCHEDULE_KEY]: next });
      if (rulesChanged || message.enabled !== schedule.enabled) samples.clear();
      return next;
    }
    case "SCHEDULE_SAMPLE": {
      const tabId = sender?.tab?.id;
      if (tabId === void 0 || !schedule.enabled) return;
      const id = `${tabId}:${message.documentId}`;
      const previous = samples.get(id);
      for (const [key, sample] of samples) {
        if (now - sample.at > MAX_SAMPLE_GAP_MS) samples.delete(key);
      }
      samples.set(id, { at: now, visible: message.visible, playing: message.playing });
      if (!previous || now - previous.at > MAX_SAMPLE_GAP_MS) return;
      const before = getScheduleStatus(schedule, previous.at);
      const current = before.kind === "open" ? before : getScheduleStatus(schedule, now);
      if (current.kind !== "open" || !(current.rule.mode === "site" ? previous.visible : previous.playing)) return;
      const next = recordUsage(schedule, previous.at, now);
      if (next !== schedule) await webext.storage.local.set({ [SCHEDULE_KEY]: next });
      return;
    }
    case "START_SCHEDULED_SESSION": {
      const decision = resolveScheduledStart(schedule, message.spec, now, message.choice);
      if (decision.kind !== "start") return decision;
      const state = await startSession2(
        message.spec,
        now,
        decision.endsAtMs,
        decision.schedule !== schedule ? decision.schedule : void 0
      );
      return { kind: "start", state };
    }
  }
}
function runScheduleMessage(message, sender, startSession2) {
  const next = pending.then(() => processMessage(message, sender, startSession2));
  pending = next.catch(() => void 0);
  return next;
}

// src/core/duration.ts
function formatApproxRemaining(remainingMs) {
  const totalSec = Math.max(0, Math.ceil(remainingMs / 1e3));
  if (totalSec === 0) return "0s";
  if (totalSec < 60) return `${totalSec}s`;
  const totalMin = totalSec / 60;
  if (totalMin < 59.5) {
    return `${Math.max(1, Math.round(totalMin))}m`;
  }
  const halfHours = Math.round(totalSec / 3600 * 2) / 2;
  const formatted = Number.isInteger(halfHours) ? String(halfHours) : halfHours.toFixed(1);
  return `${formatted}hr`;
}
function extractLengthSecondsFromHtml(html) {
  const match = html.match(/"lengthSeconds"\s*:\s*"(\d+)"/);
  if (!match?.[1]) return null;
  const parsed = Number.parseInt(match[1], 10);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : null;
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
  pausedAtMs: null,
  pausedRemainingMs: null,
  allYouTubeClosedAtMs: null,
  lastExpiredNotice: null,
  autoplayOnboarding: "unseen",
  shortsLockedForSession: false,
  acknowledgedPrompts: {
    nudge_50: false,
    nudge_25: false
  },
  policy: { ...DEFAULT_POLICY }
};

// src/background/index.ts
var STATE_KEY = "ytTimeFitSessionState";
var SHORT_CACHE_KEY = "ytTimeFitShortDurationCache";
var EXPIRY_ALARM = "yt-timetube-session-expiry";
var BADGE_TICK_ALARM = "yt-timetube-badge-tick";
var SHORT_CACHE_TTL_MS = 7 * 24 * 60 * 6e4;
var EXPIRED_AUTO_RESET_MS = 1e4;
var expiredResetTimer = null;
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
async function saveState(state, schedule) {
  const changes = { [STATE_KEY]: state };
  if (schedule) changes[SCHEDULE_KEY] = schedule;
  await webext.storage.local.set(changes);
  await syncAlarmsAndBadge(state);
}
async function syncAlarmsAndBadge(state) {
  await webext.alarms.clear(EXPIRY_ALARM);
  await webext.alarms.clear(BADGE_TICK_ALARM);
  const nowMs = Date.now();
  const remainingMs = computeRemainingMs(state, nowMs);
  if (state.status === "paused") {
    const label = remainingMs !== null ? formatApproxRemaining(remainingMs) : "II";
    await setBadge(label, "#d97706");
    return;
  }
  if (state.status === "active" && state.spec) {
    if (state.spec.mode === "maxLength") {
      await setBadge(formatApproxRemaining(state.spec.maxMinutes * 6e4), "#2563eb");
      return;
    }
    if (state.endsAtMs !== null && remainingMs !== null && remainingMs > 0) {
      webext.alarms.create(EXPIRY_ALARM, { when: state.endsAtMs });
      webext.alarms.create(BADGE_TICK_ALARM, { periodInMinutes: 1 });
      const label = formatApproxRemaining(remainingMs);
      await setBadge(label, remainingMs <= 5 * 6e4 ? "#ff0033" : "#0f766e");
      return;
    }
  }
  if (state.status === "expired") {
    await setBadge("0s", "#ff0033");
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
async function finalizeExpiredAutoReset(state, nowMs) {
  const notice = state.spec ? { endedAtMs: state.endsAtMs ?? nowMs, lastSpec: state.spec } : state.lastExpiredNotice;
  const next = {
    ...state,
    id: null,
    status: "idle",
    spec: null,
    startedAtMs: null,
    endsAtMs: null,
    pausedAtMs: null,
    pausedRemainingMs: null,
    allYouTubeClosedAtMs: null,
    shortsLockedForSession: false,
    acknowledgedPrompts: { nudge_50: false, nudge_25: false },
    lastExpiredNotice: notice
  };
  await saveState(next);
  return next;
}
async function checkYouTubeTabsForExpiredReset() {
  const state = await loadState();
  if (state.status !== "expired") {
    if (expiredResetTimer !== null) {
      clearTimeout(expiredResetTimer);
      expiredResetTimer = null;
    }
    return;
  }
  let openYouTubeTabs = 0;
  try {
    const tabs = await webext.tabs.query({
      url: ["https://www.youtube.com/*", "https://m.youtube.com/*"]
    });
    openYouTubeTabs = tabs.length;
  } catch {
    return;
  }
  const nowMs = Date.now();
  if (openYouTubeTabs === 0) {
    if (state.allYouTubeClosedAtMs === null) {
      const stamped = { ...state, allYouTubeClosedAtMs: nowMs };
      await saveState(stamped);
    }
    if (expiredResetTimer !== null) clearTimeout(expiredResetTimer);
    const closedAt = state.allYouTubeClosedAtMs ?? nowMs;
    const waitMs = Math.max(0, EXPIRED_AUTO_RESET_MS - (nowMs - closedAt));
    expiredResetTimer = setTimeout(async () => {
      expiredResetTimer = null;
      const latest = await loadState();
      if (shouldAutoResetExpiredSession(latest, Date.now(), EXPIRED_AUTO_RESET_MS)) {
        try {
          const tabsNow = await webext.tabs.query({
            url: ["https://www.youtube.com/*", "https://m.youtube.com/*"]
          });
          if (tabsNow.length === 0) {
            await finalizeExpiredAutoReset(latest, Date.now());
          }
        } catch {
          await finalizeExpiredAutoReset(latest, Date.now());
        }
      }
    }, waitMs + 50);
  } else {
    if (expiredResetTimer !== null) {
      clearTimeout(expiredResetTimer);
      expiredResetTimer = null;
    }
    if (shouldAutoResetExpiredSession(state, nowMs, EXPIRED_AUTO_RESET_MS)) {
      await finalizeExpiredAutoReset(state, nowMs);
    } else if (state.allYouTubeClosedAtMs !== null) {
      await saveState({ ...state, allYouTubeClosedAtMs: null });
    }
  }
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
async function startSession(state, spec, nowMs, endsAtMs, schedule) {
  const next = {
    ...state,
    id: `sess_${nowMs}`,
    status: "active",
    spec,
    startedAtMs: nowMs,
    endsAtMs,
    pausedAtMs: null,
    pausedRemainingMs: null,
    allYouTubeClosedAtMs: null,
    lastExpiredNotice: null,
    shortsLockedForSession: false,
    acknowledgedPrompts: { nudge_50: false, nudge_25: false }
  };
  await saveState(next, schedule);
  await wakeAllYouTubeTabs();
  return next;
}
async function handleMessage(msg) {
  const state = await loadState();
  const nowMs = Date.now();
  switch (msg.type) {
    case "GET_STATE": {
      if (shouldAutoResetExpiredSession(state, nowMs, EXPIRED_AUTO_RESET_MS)) {
        return finalizeExpiredAutoReset(state, nowMs);
      }
      if (state.status === "expired" && state.allYouTubeClosedAtMs !== null) {
        const kept = { ...state, allYouTubeClosedAtMs: null };
        await saveState(kept);
        return kept;
      }
      if (state.status === "active" && state.spec && state.spec.mode !== "maxLength" && state.endsAtMs !== null && state.endsAtMs <= nowMs) {
        const expired = { ...state, status: "expired", allYouTubeClosedAtMs: null };
        await saveState(expired);
        return expired;
      }
      await syncAlarmsAndBadge(state);
      return state;
    }
    case "EXTEND_SESSION": {
      if (state.status !== "active" && state.status !== "paused" && state.status !== "expired") {
        return state;
      }
      if (!state.spec || state.spec.mode === "maxLength") return state;
      const deltaMs = Math.max(1, msg.additionalMinutes) * 6e4;
      if (state.status === "paused") {
        const next2 = {
          ...state,
          pausedRemainingMs: (state.pausedRemainingMs ?? 0) + deltaMs
        };
        await saveState(next2);
        return next2;
      }
      const baseEnd = Math.max(nowMs, state.endsAtMs ?? nowMs);
      const next = {
        ...state,
        status: "active",
        endsAtMs: baseEnd + deltaMs,
        pausedAtMs: null,
        pausedRemainingMs: null
      };
      await saveState(next);
      return next;
    }
    case "EXTEND_SESSION_SECONDS": {
      if (state.status !== "active" && state.status !== "paused" && state.status !== "expired") {
        return state;
      }
      if (!state.spec || state.spec.mode === "maxLength") return state;
      const deltaMs = Math.max(1, Math.ceil(msg.additionalSeconds)) * 1e3;
      if (state.status === "paused") {
        const next2 = {
          ...state,
          pausedRemainingMs: (state.pausedRemainingMs ?? 0) + deltaMs
        };
        await saveState(next2);
        return next2;
      }
      const baseEnd = Math.max(nowMs, state.endsAtMs ?? nowMs);
      const next = {
        ...state,
        status: "active",
        endsAtMs: baseEnd + deltaMs,
        pausedAtMs: null,
        pausedRemainingMs: null
      };
      await saveState(next);
      return next;
    }
    case "PAUSE_TIMER": {
      if (state.status !== "active" || !state.spec || state.spec.mode === "maxLength" || state.endsAtMs === null) {
        return state;
      }
      const remaining = Math.max(0, state.endsAtMs - nowMs);
      const next = {
        ...state,
        status: "paused",
        pausedAtMs: nowMs,
        pausedRemainingMs: remaining
      };
      await saveState(next);
      return next;
    }
    case "RESUME_TIMER": {
      if (state.status !== "paused" || state.pausedRemainingMs === null) {
        return state;
      }
      const pausedDurationMs = state.pausedAtMs !== null ? Math.max(0, nowMs - state.pausedAtMs) : 0;
      const next = {
        ...state,
        status: "active",
        startedAtMs: state.startedAtMs !== null ? state.startedAtMs + pausedDurationMs : nowMs,
        endsAtMs: nowMs + state.pausedRemainingMs,
        pausedAtMs: null,
        pausedRemainingMs: null
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
        pausedAtMs: null,
        pausedRemainingMs: null,
        allYouTubeClosedAtMs: null,
        lastExpiredNotice: null,
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
    case "DISMISS_EXPIRED_NOTICE": {
      const next = { ...state, lastExpiredNotice: null };
      await saveState(next);
      return next;
    }
    case "SYNC_BADGE": {
      await syncAlarmsAndBadge(state);
      return { ok: true };
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
async function handleScheduleMessage(message, sender) {
  return runScheduleMessage(
    message,
    sender,
    async (spec, now, endsAtMs, schedule) => startSession(await loadState(), spec, now, endsAtMs, schedule)
  );
}
function bootBackgroundSessionRuntime() {
  webext.runtime.onMessage.addListener((message, _sender, sendResponse) => {
    if (!message || typeof message !== "object" || !("type" in message)) {
      return false;
    }
    const request = message;
    const response = request.type === "SAVE_SCHEDULE" || request.type === "SCHEDULE_SAMPLE" || request.type === "START_SCHEDULED_SESSION" ? handleScheduleMessage(request, _sender) : handleMessage(request);
    response.then((res) => sendResponse(res)).catch((err) => sendResponse({ error: String(err) }));
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
  webext.tabs.onRemoved?.addListener(() => {
    checkYouTubeTabsForExpiredReset().catch(() => void 0);
  });
  webext.tabs.onUpdated?.addListener((_tabId, changeInfo) => {
    if (changeInfo.url || changeInfo.status === "complete") {
      checkYouTubeTabsForExpiredReset().catch(() => void 0);
    }
  });
  const rehydrate = () => {
    loadState().then(async (s) => {
      if (shouldAutoResetExpiredSession(s, Date.now(), EXPIRED_AUTO_RESET_MS)) {
        await finalizeExpiredAutoReset(s, Date.now());
      } else {
        await syncAlarmsAndBadge(s);
        await checkYouTubeTabsForExpiredReset();
      }
    }).catch(() => void 0);
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
