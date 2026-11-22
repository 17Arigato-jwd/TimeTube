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

// src/shared/webext.ts
var rawApi = globalThis.browser ?? globalThis.chrome;
var webext = rawApi;

// src/popup/index.ts
var selectedMode = "countdown";
var currentState = null;
var statusPill = document.getElementById("status-pill");
var activeBanner = document.getElementById("active-banner");
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
  const remainingMs = computeRemainingMs(state, Date.now());
  if (state.status === "active" || state.status === "paused") {
    statusPill.textContent = state.status === "paused" ? "Paused" : state.spec?.mode === "maxLength" ? "Max length" : "Active";
    statusPill.className = state.status === "paused" ? "tt-status tt-status-paused" : "tt-status tt-status-active";
    activeBanner.classList.remove("hidden");
    if (state.spec?.mode === "maxLength") {
      remainingDisplay.textContent = `\u2264 ${state.spec.maxMinutes}m`;
      extendBtn.classList.add("hidden");
    } else {
      remainingDisplay.textContent = remainingMs !== null ? formatMs(remainingMs) : "--:--";
      extendBtn.classList.remove("hidden");
    }
  } else if (state.status === "expired") {
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
  const next = await webext.runtime.sendMessage({
    type: "UPDATE_POLICY",
    patch: {
      shortsMode: disableShortsCheckbox.checked ? "redirectToWatch" : "escalatingNudge",
      shortsLockCutoffMinutes: Number(shortsCutoffSelect.value) === 10 ? 10 : 5,
      exceedAction: exceedActionSelect.value === "dim" ? "dim" : "hide",
      hideShortsNavButton: hideShortsNavCheckbox.checked,
      showShortDurationBadges: showShortDurationsCheckbox.checked
    }
  });
  renderState(next);
}
async function initPopup() {
  await webext.runtime.sendMessage({ type: "WAKE_FROM_POPUP" }).catch(() => void 0);
  const state = await webext.runtime.sendMessage({ type: "GET_STATE" });
  untilInput.value = getDefaultEndTime();
  renderState(state);
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
    const next = await webext.runtime.sendMessage({
      type: "START_SESSION",
      spec
    });
    renderState(next);
  });
  extendBtn.addEventListener("click", async () => {
    const next = await webext.runtime.sendMessage({
      type: "EXTEND_SESSION",
      additionalMinutes: 5
    });
    renderState(next);
  });
  stopBtn.addEventListener("click", async () => {
    const next = await webext.runtime.sendMessage({
      type: "STOP_SESSION"
    });
    renderState(next);
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
