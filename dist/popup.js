// src/core/duration.ts
function getDefaultEndTime(nowMs = Date.now()) {
  const d = new Date(nowMs);
  const totalMinutes = d.getHours() * 60 + d.getMinutes();
  const nextQuarter = (Math.floor(totalMinutes / 15) + 1) * 15 % (24 * 60);
  const hh = String(Math.floor(nextQuarter / 60)).padStart(2, "0");
  const mm = String(nextQuarter % 60).padStart(2, "0");
  return `${hh}:${mm}`;
}

// src/core/policy.ts
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

// src/shared/webext.ts
var rawApi = globalThis.browser ?? globalThis.chrome;
var webext = rawApi;

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
function formatMs(ms) {
  const totalSec = Math.max(0, Math.ceil(ms / 1e3));
  const mins = Math.floor(totalSec / 60);
  const secs = totalSec % 60;
  return `${mins}:${String(secs).padStart(2, "0")}`;
}
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
  sessionSetup.classList.toggle("hidden", sessionInProgress);
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
}
async function syncPolicy() {
  await webext.runtime.sendMessage({
    type: "UPDATE_POLICY",
    patch: {
      shortsMode: disableShortsCheckbox.checked ? "redirectToWatch" : "escalatingNudge",
      shortsLockCutoffMinutes: Number(shortsCutoffSelect.value) === 10 ? 10 : 5,
      exceedAction: exceedActionSelect.value === "dim" ? "dim" : "hide",
      hideShortsNavButton: hideShortsNavCheckbox.checked,
      showShortDurationBadges: showShortDurationsCheckbox.checked
    }
  });
}
async function initPopup() {
  webext.storage.onChanged.addListener((changes, area) => {
    if (area !== "local" || !changes[STATE_KEY]?.newValue) return;
    renderState(changes[STATE_KEY].newValue);
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
    await webext.runtime.sendMessage({
      type: "START_SESSION",
      spec
    });
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
  window.setInterval(() => {
    if (currentState) renderState(currentState);
  }, 1e3);
}
initPopup();
//# sourceMappingURL=popup.js.map
