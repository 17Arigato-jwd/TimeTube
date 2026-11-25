// src/shared/clock.ts
function formatMs(ms) {
  const totalSec = Math.max(0, Math.ceil(ms / 1e3));
  const mins = Math.floor(totalSec / 60);
  const secs = totalSec % 60;
  return `${mins}:${String(secs).padStart(2, "0")}`;
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
function computeMaxAllowedSeconds(state, nowMs) {
  if (state.status !== "active" && state.status !== "paused" || !state.spec) return null;
  if (state.spec.mode === "maxLength") {
    return Math.max(0, Math.round(state.spec.maxMinutes * 60));
  }
  const remainingMs = computeRemainingMs(state, nowMs);
  if (remainingMs === null) return null;
  const remainingSec = Math.floor(remainingMs / 1e3);
  return Math.max(0, remainingSec - Math.max(0, state.policy.bufferSeconds));
}
function computeShortsStage(state, nowMs) {
  if (state.policy.shortsMode === "redirectToWatch") {
    return "locked_to_watch";
  }
  if (state.shortsLockedForSession) {
    return "locked_to_watch";
  }
  if (state.status !== "active" || !state.spec || state.spec.mode === "maxLength" || state.startedAtMs === null || state.endsAtMs === null) {
    return "unrestricted";
  }
  const totalMs = Math.max(1, state.endsAtMs - state.startedAtMs);
  const remainingMs = Math.max(0, state.endsAtMs - nowMs);
  const cutoffMs = state.policy.shortsLockCutoffMinutes * 6e4;
  if (remainingMs <= cutoffMs) {
    return "locked_to_watch";
  }
  if (remainingMs <= totalMs * 0.25) {
    return "nudge_25";
  }
  if (remainingMs <= totalMs * 0.5) {
    return "nudge_50";
  }
  return "unrestricted";
}
function buildSessionSnapshot(state, nowMs, options = {}) {
  const snoozed = options.snoozed ?? false;
  const autoplayObserved = options.autoplayObserved ?? "unknown";
  const remainingMs = computeRemainingMs(state, nowMs);
  const isTimedExpired = state.status === "active" && state.spec !== null && state.spec.mode !== "maxLength" && remainingMs !== null && remainingMs <= 0;
  let derivedStatus;
  if (snoozed) {
    derivedStatus = "snoozed";
  } else if (autoplayObserved === "enabled") {
    derivedStatus = "needs_autoplay_setup";
  } else if (isTimedExpired) {
    derivedStatus = "expired";
  } else {
    derivedStatus = state.status;
  }
  const effectiveState = isTimedExpired ? { ...state, status: "expired" } : state;
  return {
    id: effectiveState.id,
    status: derivedStatus,
    spec: effectiveState.spec,
    startedAtMs: effectiveState.startedAtMs,
    endsAtMs: effectiveState.endsAtMs,
    remainingMs: isTimedExpired ? 0 : remainingMs,
    maxAllowedVideoSeconds: derivedStatus === "active" || derivedStatus === "paused" ? computeMaxAllowedSeconds(effectiveState, nowMs) : null,
    autoplayOnboarding: effectiveState.autoplayOnboarding,
    autoplayObserved,
    shortsStage: computeShortsStage(effectiveState, nowMs),
    shortsLockedForSession: effectiveState.shortsLockedForSession,
    acknowledgedPrompts: { ...effectiveState.acknowledgedPrompts },
    policy: { ...effectiveState.policy }
  };
}

// src/core/schedule.ts
var SCHEDULE_KEY = "timeTubeSchedule";
var MINUTE_MS = 6e4;
var MAX_SAMPLE_GAP_MS = 1e4;
var EMPTY_SCHEDULE = { version: 2, enabled: false, rules: [], usage: {} };
function dateKey(date) {
  return [date.getFullYear(), date.getMonth() + 1, date.getDate()].map((part) => String(part).padStart(2, "0")).join("-");
}
function atTime(day, time2, nextDay = false) {
  const [hour = 0, minute = 0] = time2.split(":").map(Number);
  return new Date(day.getFullYear(), day.getMonth(), day.getDate() + Number(nextDay), hour, minute).getTime();
}
function localDay(now, offset = 0) {
  const day = new Date(now);
  day.setHours(0, 0, 0, 0);
  day.setDate(day.getDate() + offset);
  return day;
}
function timeline(state, now, daysAhead) {
  const windows = [];
  const budgets = [];
  const boundaries = /* @__PURE__ */ new Set();
  for (let offset = -2; offset <= daysAhead; offset++) {
    const day = localDay(now, offset);
    boundaries.add(day.getTime());
    const rule = state.rules.find((item) => item.days.includes(day.getDay()));
    if (!rule) continue;
    const key = dateKey(day);
    if (rule.windowEnabled !== false) {
      const start = atTime(day, rule.start);
      const end = Math.max(atTime(day, rule.end, rule.end < rule.start), state.usage[key]?.closesAtOverride ?? 0);
      windows.push({ key, rule, start, end });
      boundaries.add(start);
      boundaries.add(end);
    }
    if (rule.limitEnabled !== false) {
      const reset = rule.resetTime ?? "00:00";
      const start = atTime(day, reset);
      const end = atTime(day, reset, true);
      budgets.push({ key, rule, start, end });
      boundaries.add(start);
      boundaries.add(end);
    }
  }
  const carry = state.legacyCarry;
  if (carry && carry.end > now - MAX_SAMPLE_GAP_MS) {
    const rule = state.rules.find((item) => item.id === carry.ruleId && item.limitEnabled !== false);
    if (rule) {
      budgets.push({ key: carry.key, rule, start: carry.start, end: carry.end });
      boundaries.add(carry.end);
    }
  }
  return { windows, budgets, boundaries: [...boundaries].sort((a, b) => a - b) };
}
function includesTime(period, now) {
  return period.start <= now && now < period.end;
}
function migrateSchedule(state, now) {
  if (state.version === 2) return state;
  const usage = {};
  for (const [key, entry] of Object.entries(state.usage)) {
    const { extra: extra2, ...balance } = entry;
    usage[key] = extra2 ? { ...balance, closesAtOverride: extra2.closesAt, limitOverrideMs: extra2.limitMs } : balance;
  }
  const migrated = { ...state, version: 2, usage };
  const { windows, budgets } = timeline(migrated, now, 0);
  const activeBudget = budgets.find((period) => includesTime(period, now));
  const oldWindow = windows.find((period) => includesTime(period, now));
  if (oldWindow && activeBudget && oldWindow.key !== activeBudget.key && usage[oldWindow.key]) {
    const previous = usage[oldWindow.key];
    const current = usage[activeBudget.key] ?? { usedMs: 0, recent: [] };
    usage[activeBudget.key] = { ...current, usedMs: current.usedMs + previous.usedMs };
  }
  if (oldWindow && !activeBudget && usage[oldWindow.key]?.usedMs) {
    migrated.legacyCarry = { key: oldWindow.key, ruleId: oldWindow.rule.id, start: now, end: oldWindow.end };
  }
  return migrated;
}
function limitMs(state, period) {
  return Math.max(period.rule.limitMinutes * MINUTE_MS, state.usage[period.key]?.limitOverrideMs ?? 0);
}
function remaining(state, period) {
  return Math.max(0, limitMs(state, period) - (state.usage[period.key]?.usedMs ?? 0));
}
function currentPeriods(state, line, now) {
  const activeWindows = line.windows.filter((item) => includesTime(item, now));
  const today = dateKey(new Date(now));
  const window2 = activeWindows.at(-1) ?? line.windows.find((item) => item.key === today);
  const budgets = line.budgets.filter((item) => includesTime(item, now));
  const budget = budgets.slice().sort((a, b) => remaining(state, a) - remaining(state, b))[0];
  const closed = !!window2 && !activeWindows.length;
  const spent = !!budget && remaining(state, budget) <= 0;
  return { window: window2, budget, budgets, closed, spent };
}
function getScheduleStrip(raw, now) {
  if (!raw.enabled) return {};
  const state = migrateSchedule(raw, now);
  const { window: window2, budget, closed, spent } = currentPeriods(state, timeline(state, now, 0), now);
  const strip = {};
  if (window2) strip.window = { opensAt: window2.start, closesAt: window2.end };
  if (budget) strip.budget = {
    remainingMs: remaining(state, budget),
    resetsAt: budget.end,
    counting: !closed && !spent && (state.usage[budget.key]?.countingUntil ?? 0) > now
  };
  return strip;
}
function getScheduleStatus(raw, now) {
  if (!raw.enabled) return { kind: "off" };
  const state = migrateSchedule(raw, now);
  const line = timeline(state, now, 1);
  const { window: window2, budget, budgets, closed, spent } = currentPeriods(state, line, now);
  const active = window2 ?? budget;
  if (!active) return { kind: "unassigned" };
  if (closed || spent) {
    const future = timeline(state, now, 8);
    const nextOpen = future.boundaries.find((time2) => {
      if (time2 <= now) return false;
      const status = currentPeriods(state, future, time2);
      return !status.closed && !status.spent;
    }) ?? null;
    return { kind: spent ? "spent" : "closed", nextOpen };
  }
  const key = [window2, ...budgets].filter((p) => !!p).map((p) => p.key + "/" + p.rule.id).join("|");
  return {
    kind: "open",
    key,
    rule: active.rule,
    opensAt: window2?.start ?? active.start,
    closesAt: window2?.end ?? Infinity,
    remainingMs: budget ? remaining(state, budget) : Infinity,
    limitMs: budget ? limitMs(state, budget) : Infinity
  };
}
function resolveScheduledStart(state, spec, now, choice) {
  state = migrateSchedule(state, now);
  const status = getScheduleStatus(state, now);
  if (status.kind === "closed" || status.kind === "spent") return { kind: "unavailable" };
  const { endsAtMs } = resolveBudgetBounds(spec, now);
  if (choice && (status.kind !== "open" || status.key !== choice.key || choice.untilAt !== void 0 && choice.untilAt !== endsAtMs)) return { kind: "unavailable" };
  if (status.kind !== "open" || endsAtMs === null) return { kind: "start", endsAtMs, schedule: state };
  const { window: window2, budgets } = currentPeriods(state, timeline(state, now, 0), now);
  const binding = budgets.filter((budget) => remaining(state, budget) < budget.end - now);
  const usageAvailable = Math.min(...binding.map((budget) => remaining(state, budget)));
  const availableMs = Math.min(usageAvailable, status.closesAt - now);
  const requestedMs = endsAtMs - now;
  if (requestedMs <= availableMs) return { kind: "start", endsAtMs, schedule: state };
  const extraUsageMs = Math.max(0, ...binding.map(
    (budget) => Math.min(requestedMs, budget.end - now) - remaining(state, budget)
  ));
  const extraWindowMs = Math.max(0, endsAtMs - status.closesAt);
  if (!choice) {
    const untilAt = spec.mode === "until" ? endsAtMs : void 0;
    return { kind: "conflict", key: status.key, availableMs, requestedMs, extraUsageMs, extraWindowMs, untilAt };
  }
  if (choice.action === "shorten") return { kind: "start", endsAtMs: now + availableMs, schedule: state };
  const usage = { ...state.usage };
  if (window2 && extraWindowMs > 0) {
    const entry = usage[window2.key] ?? { usedMs: 0, recent: [] };
    usage[window2.key] = { ...entry, closesAtOverride: endsAtMs };
  }
  for (const budget of binding) {
    const neededMs = Math.min(requestedMs, budget.end - now) - remaining(state, budget);
    if (neededMs <= 0) continue;
    const entry = usage[budget.key] ?? { usedMs: 0, recent: [] };
    usage[budget.key] = { ...entry, limitOverrideMs: limitMs(state, budget) + neededMs };
  }
  return { kind: "start", endsAtMs, schedule: { ...state, usage } };
}

// src/shared/schedule-strip.ts
function time(ms) {
  return new Date(ms).toLocaleTimeString(void 0, { hour: "numeric", minute: "2-digit" });
}
function setText(element, text) {
  if (element.textContent !== text) element.textContent = text;
}
function bindScheduleStrip(strip) {
  const statusLabel = strip.querySelector("[data-schedule-status]");
  const detailLabel = strip.querySelector("[data-schedule-detail]");
  const budgetLine = strip.querySelector("[data-schedule-budget]");
  const pausedLabel = strip.querySelector("[data-schedule-paused]");
  const resetLabel = strip.querySelector("[data-schedule-reset]");
  const windowLine = strip.querySelector("[data-schedule-window]");
  const windowStart = strip.querySelector("[data-window-start]");
  const windowNow = strip.querySelector("[data-window-now]");
  const windowEnd = strip.querySelector("[data-window-end]");
  const windowProgress = strip.querySelector("[data-window-progress]");
  const segments = Array.from({ length: 24 }, () => document.createElement("span"));
  windowProgress.append(...segments);
  return (schedule2, now, status = getScheduleStatus(schedule2, now)) => {
    const restricted = status.kind === "closed" || status.kind === "spent";
    const { window: accessWindow, budget } = getScheduleStrip(schedule2, now);
    strip.hidden = !accessWindow && !budget && !restricted;
    budgetLine.hidden = !budget;
    if (budget) {
      const spent = budget.remainingMs <= 0;
      setText(statusLabel, spent ? "Time up" : `${formatMs(budget.remainingMs)} remaining`);
      pausedLabel.hidden = spent || budget.counting;
      setText(resetLabel, `Resets at ${time(budget.resetsAt)}`);
    }
    windowLine.hidden = !accessWindow;
    if (accessWindow) {
      const { opensAt, closesAt } = accessWindow;
      const elapsed = Math.min(1, Math.max(0, (now - opensAt) / (closesAt - opensAt)));
      const filled = Math.floor(segments.length * elapsed);
      segments.forEach((segment, index) => segment.classList.toggle("elapsed", index < filled));
      const start = time(opensAt);
      const current = time(now);
      const overnight = new Date(opensAt).toDateString() !== new Date(closesAt).toDateString();
      const end = time(closesAt) + (overnight ? " next day" : "");
      setText(windowStart, start);
      setText(windowNow, `Now ${current}`);
      setText(windowEnd, end);
      windowProgress.setAttribute("aria-valuenow", String(Math.round(elapsed * 100)));
      windowProgress.setAttribute("aria-valuetext", `Access from ${start} to ${end}. Current time ${current}.`);
    }
    detailLabel.hidden = !restricted;
    if (status.kind === "closed" || status.kind === "spent") {
      if (status.nextOpen !== null) {
        const day = new Date(status.nextOpen).toLocaleDateString(void 0, { weekday: "long" });
        setText(detailLabel, `Access resumes ${day} at ${time(status.nextOpen)}`);
      } else {
        setText(detailLabel, "Access restricted");
      }
    }
    return restricted;
  };
}

// src/shared/webext.ts
var rawApi = globalThis.browser ?? globalThis.chrome;
var webext = rawApi;

// src/popup/schedule.ts
var schedule = EMPTY_SCHEDULE;
var pendingSpec = null;
var conflictKey = null;
var conflictUntil;
var pending = false;
var renderStrip = bindScheduleStrip(document.querySelector("#schedule-strip"));
var editButton = document.querySelector("#schedule-open");
var dialog = document.querySelector("#schedule-conflict");
var summary = document.querySelector("#conflict-summary");
var extra = document.querySelector("#conflict-extra");
var dialogError = document.querySelector("#conflict-error");
var startError = document.querySelector("#session-start-error");
var shorten = document.querySelector("#conflict-shorten");
var extend = document.querySelector("#conflict-extend");
function duration(ms) {
  const seconds = Math.max(0, Math.ceil(ms / 1e3));
  const minutes = Math.floor(seconds / 60);
  const remainder = seconds % 60;
  if (!minutes) return `${seconds} sec`;
  return remainder ? `${minutes} min ${remainder} sec` : `${minutes} min`;
}
function showError(message) {
  if (dialog.open) {
    dialogError.textContent = message;
  } else {
    startError.textContent = message;
    startError.classList.toggle("hidden", !message);
  }
}
function renderConflict(result) {
  if (result.kind === "unavailable" || result.kind === "conflict" && result.key !== conflictKey) {
    summary.textContent = "This access window is no longer available.";
    extra.textContent = "";
    shorten.disabled = extend.disabled = true;
    return;
  }
  if (result.kind === "start") {
    summary.textContent = "The requested session now fits your schedule.";
    extra.textContent = "";
    shorten.textContent = "Start session";
    shorten.disabled = pending;
    extend.disabled = true;
    return;
  }
  shorten.textContent = "Shorten session";
  shorten.disabled = extend.disabled = pending;
  summary.textContent = `${duration(result.requestedMs)} requested. ${duration(result.availableMs)} fits under ${result.extraUsageMs && result.extraWindowMs ? "the daily limit and closing time" : result.extraUsageMs ? "the daily limit" : "the closing time"}.`;
  const adjustments = [];
  if (result.extraUsageMs) adjustments.push(`${duration(result.extraUsageMs)} to this daily allowance`);
  if (result.extraWindowMs) adjustments.push(`${duration(result.extraWindowMs)} to its closing time`);
  extra.textContent = `Add ${adjustments.join(" and ")} for this occurrence only.`;
}
function renderSchedule() {
  const now = Date.now();
  const status = getScheduleStatus(schedule, now);
  const restricted = renderStrip(schedule, now, status);
  if (dialog.open && pendingSpec) {
    if (conflictUntil !== void 0 && conflictUntil <= now) {
      summary.textContent = "The requested end time has passed.";
      extra.textContent = "";
      shorten.disabled = extend.disabled = true;
    } else {
      const result = status.kind === "open" && status.key === conflictKey ? resolveScheduledStart(schedule, pendingSpec, now) : { kind: "unavailable" };
      renderConflict(result);
    }
  }
  return restricted;
}
async function startScheduledSession(spec, choice) {
  if (pending) return;
  showError("");
  pending = true;
  shorten.disabled = extend.disabled = true;
  try {
    const result = await webext.runtime.sendMessage({
      type: "START_SCHEDULED_SESSION",
      spec,
      choice
    });
    if ("error" in result) throw new Error(result.error);
    if (result.kind === "conflict") {
      pendingSpec = spec;
      conflictKey = result.key;
      conflictUntil = result.untilAt;
      dialogError.textContent = "";
      renderConflict(result);
      if (!dialog.open) dialog.showModal();
    } else if (result.kind === "unavailable") {
      showError("This access window is no longer available.");
    } else if (dialog.open) {
      dialog.close();
    }
  } catch {
    showError("Could not start the session. Try again.");
  } finally {
    pending = false;
    if (dialog.open && pendingSpec) renderSchedule();
  }
}
async function initSchedulePopup(onChange) {
  let receivedChange = false;
  webext.storage.onChanged.addListener((changes, area) => {
    if (area !== "local" || !changes[SCHEDULE_KEY]) return;
    receivedChange = true;
    schedule = changes[SCHEDULE_KEY].newValue ?? EMPTY_SCHEDULE;
    onChange();
  });
  const stored = await webext.storage.local.get(SCHEDULE_KEY);
  if (!receivedChange) schedule = stored[SCHEDULE_KEY] ?? EMPTY_SCHEDULE;
  editButton.addEventListener("click", () => {
    webext.runtime.openOptionsPage().catch(() => showError("Could not open schedule settings."));
  });
  const confirm = (action) => {
    if (pendingSpec && conflictKey) void startScheduledSession(pendingSpec, { action, key: conflictKey, untilAt: conflictUntil });
  };
  shorten.addEventListener("click", () => confirm("shorten"));
  extend.addEventListener("click", () => confirm("extra"));
  dialog.addEventListener("close", () => {
    pendingSpec = conflictKey = null;
    conflictUntil = void 0;
  });
}

// src/core/duration.ts
function getDefaultEndTime(nowMs = Date.now()) {
  const d = new Date(nowMs);
  const totalMinutes = d.getHours() * 60 + d.getMinutes();
  const nextQuarter = (Math.floor(totalMinutes / 15) + 1) * 15 % (24 * 60);
  const hh = String(Math.floor(nextQuarter / 60)).padStart(2, "0");
  const mm = String(nextQuarter % 60).padStart(2, "0");
  return `${hh}:${mm}`;
}

// src/popup/index.ts
var STATE_KEY = "ytTimeFitSessionState";
var selectedMode = "countdown";
var currentState = null;
var statusPill = document.getElementById("status-pill");
var activeBanner = document.getElementById("active-banner");
var sessionSetup = document.getElementById("session-setup");
var remainingDisplay = document.getElementById("remaining-display");
var extendBtn = document.getElementById("extend-btn");
var stopBtn = document.getElementById("stop-btn");
var startBtn = document.getElementById("start-btn");
var countdownInput = document.getElementById("countdown-mins");
var untilInput = document.getElementById("until-time");
var maxLengthInput = document.getElementById("max-length-mins");
var disableShortsCheckbox = document.getElementById("disable-shorts");
var shortsCutoffSelect = document.getElementById("shorts-cutoff");
var cutoffRow = document.getElementById("cutoff-row");
var exceedActionSelect = document.getElementById("exceed-action");
var hideShortsNavCheckbox = document.getElementById("hide-shorts-nav");
var showShortDurationsCheckbox = document.getElementById("show-short-durations");
var disableHoverPreviewsCheckbox = document.getElementById("disable-hover-previews");
function setModeTab(mode) {
  selectedMode = mode;
  document.querySelectorAll(".tt-tab").forEach((btn) => {
    btn.classList.toggle("active", btn.dataset.mode === mode);
  });
  document.getElementById("panel-countdown")?.classList.toggle("hidden", mode !== "countdown");
  document.getElementById("panel-until")?.classList.toggle("hidden", mode !== "until");
  document.getElementById("panel-maxLength")?.classList.toggle("hidden", mode !== "maxLength");
}
function syncActivePresetChip() {
  const val = countdownInput.value.trim();
  document.querySelectorAll(".tt-chip").forEach((btn) => {
    btn.classList.toggle("active", btn.dataset.mins === val);
  });
}
function renderState(state) {
  currentState = state;
  const { status, remainingMs } = buildSessionSnapshot(state, Date.now());
  const sessionInProgress = status === "active" || status === "paused";
  const scheduleRestricted = renderSchedule();
  sessionSetup.classList.toggle("hidden", sessionInProgress || scheduleRestricted);
  if (sessionInProgress) {
    statusPill.textContent = status === "paused" ? "Paused" : state.spec?.mode === "maxLength" ? "Max length" : "Active";
    statusPill.className = status === "paused" ? "tt-status tt-status-paused" : "tt-status tt-status-active";
    activeBanner.classList.remove("hidden");
    if (state.spec?.mode === "maxLength") {
      remainingDisplay.textContent = `\u2264 ${state.spec.maxMinutes}m`;
      extendBtn.classList.add("hidden");
    } else {
      remainingDisplay.textContent = remainingMs !== null ? formatMs(remainingMs) : "--:--";
      extendBtn.classList.remove("hidden");
    }
  } else if (status === "expired") {
    statusPill.textContent = "Time up";
    statusPill.className = "tt-status tt-status-expired";
    activeBanner.classList.remove("hidden");
    remainingDisplay.textContent = "0:00";
    extendBtn.classList.remove("hidden");
  } else {
    statusPill.textContent = "Off";
    statusPill.className = "tt-status tt-status-idle";
    activeBanner.classList.add("hidden");
  }
  disableShortsCheckbox.checked = state.policy.shortsMode === "redirectToWatch";
  cutoffRow.classList.toggle("hidden", state.policy.shortsMode === "redirectToWatch");
  shortsCutoffSelect.value = String(state.policy.shortsLockCutoffMinutes);
  exceedActionSelect.value = state.policy.exceedAction;
  hideShortsNavCheckbox.checked = state.policy.hideShortsNavButton;
  showShortDurationsCheckbox.checked = state.policy.showShortDurationBadges;
  disableHoverPreviewsCheckbox.checked = state.policy.disableHoverPreviews;
}
async function syncPolicy() {
  await webext.runtime.sendMessage({
    type: "UPDATE_POLICY",
    patch: {
      shortsMode: disableShortsCheckbox.checked ? "redirectToWatch" : "escalatingNudge",
      shortsLockCutoffMinutes: Number(shortsCutoffSelect.value) === 10 ? 10 : 5,
      exceedAction: exceedActionSelect.value === "dim" ? "dim" : "hide",
      hideShortsNavButton: hideShortsNavCheckbox.checked,
      showShortDurationBadges: showShortDurationsCheckbox.checked,
      disableHoverPreviews: disableHoverPreviewsCheckbox.checked
    }
  });
}
async function initPopup() {
  webext.storage.onChanged.addListener((changes, area) => {
    if (area !== "local" || !changes[STATE_KEY]?.newValue) return;
    renderState(changes[STATE_KEY].newValue);
  });
  await initSchedulePopup(() => {
    if (currentState) renderState(currentState);
  });
  await webext.runtime.sendMessage({ type: "WAKE_FROM_POPUP" }).catch(() => void 0);
  const state = await webext.runtime.sendMessage({ type: "GET_STATE" });
  untilInput.value = getDefaultEndTime();
  renderState(currentState ?? state);
  document.querySelectorAll(".tt-tab").forEach((btn) => {
    btn.addEventListener("click", () => {
      const mode = btn.dataset.mode;
      if (mode) setModeTab(mode);
    });
  });
  document.querySelectorAll(".tt-chip").forEach((btn) => {
    btn.addEventListener("click", () => {
      if (btn.dataset.mins) {
        countdownInput.value = btn.dataset.mins;
        syncActivePresetChip();
      }
    });
  });
  countdownInput.addEventListener("input", syncActivePresetChip);
  startBtn.addEventListener("click", async () => {
    let spec;
    if (selectedMode === "countdown") {
      spec = { mode: "countdown", durationMinutes: Math.max(1, Number(countdownInput.value) || 25) };
    } else if (selectedMode === "until") {
      spec = { mode: "until", endTime: untilInput.value || getDefaultEndTime() };
    } else {
      spec = { mode: "maxLength", maxMinutes: Math.max(1, Number(maxLengthInput.value) || 15) };
    }
    await startScheduledSession(spec);
  });
  extendBtn.addEventListener("click", async () => {
    await webext.runtime.sendMessage({
      type: "EXTEND_SESSION",
      additionalMinutes: 5
    });
  });
  stopBtn.addEventListener("click", async () => {
    await webext.runtime.sendMessage({
      type: "STOP_SESSION"
    });
  });
  disableShortsCheckbox.addEventListener("change", syncPolicy);
  shortsCutoffSelect.addEventListener("change", syncPolicy);
  exceedActionSelect.addEventListener("change", syncPolicy);
  hideShortsNavCheckbox.addEventListener("change", syncPolicy);
  showShortDurationsCheckbox.addEventListener("change", syncPolicy);
  disableHoverPreviewsCheckbox.addEventListener("change", syncPolicy);
  window.setInterval(() => {
    if (currentState) renderState(currentState);
  }, 1e3);
}
initPopup();
//# sourceMappingURL=popup.js.map
