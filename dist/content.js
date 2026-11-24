"use strict";
(() => {
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
  function computePlaybackOverrun(videoCurrentSeconds, videoDurationSeconds, playbackRate, remainingMs) {
    const safeDuration = Math.max(0, videoDurationSeconds);
    const safeCurrent = Math.min(safeDuration, Math.max(0, videoCurrentSeconds));
    const safeRate = Math.max(0.25, playbackRate || 1);
    const videoRemainingSeconds = Math.max(0, safeDuration - safeCurrent);
    const breakRemainingSeconds = Math.max(0, remainingMs / 1e3);
    const effectiveVideoRemaining = videoRemainingSeconds / safeRate;
    const isOverrunning = safeDuration > 0 && effectiveVideoRemaining > breakRemainingSeconds + 2;
    const extraSecondsNeeded = isOverrunning ? Math.ceil(effectiveVideoRemaining - breakRemainingSeconds) : 0;
    let suggestedSpeed = null;
    if (isOverrunning && breakRemainingSeconds > 0) {
      const rawNeeded = videoRemainingSeconds / breakRemainingSeconds;
      const roundedUp = Math.ceil(rawNeeded * 100) / 100;
      if (roundedUp <= 2 && roundedUp > safeRate) {
        suggestedSpeed = roundedUp;
      }
    }
    const cutoffVideoSeconds = Math.min(
      safeDuration,
      safeCurrent + breakRemainingSeconds * safeRate
    );
    const cutoffPercent = safeDuration > 0 ? Math.min(100, Math.max(0, cutoffVideoSeconds / safeDuration * 100)) : 100;
    return {
      isOverrunning,
      videoRemainingSeconds,
      breakRemainingSeconds,
      extraSecondsNeeded,
      suggestedSpeed,
      cutoffVideoSeconds,
      cutoffPercent
    };
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
  function evaluateVideoCandidate(candidate, snapshot) {
    if (snapshot.status !== "active" && snapshot.status !== "paused" || snapshot.maxAllowedVideoSeconds === null) {
      return "allow";
    }
    const failAction = snapshot.policy.exceedAction;
    if (candidate.kind === "livestream") {
      return snapshot.policy.livestreams === "hide" ? failAction : "allow";
    }
    if (candidate.durationSeconds === null) {
      if (candidate.kind === "short") {
        return "allow";
      }
      return snapshot.policy.unknownDuration === "hide" ? failAction : "allow";
    }
    if (candidate.durationSeconds > snapshot.maxAllowedVideoSeconds) {
      return failAction;
    }
    return "allow";
  }
  function buildSessionSnapshot(state, nowMs, options = {}) {
    const snoozed = options.snoozed ?? false;
    const autoplayObserved2 = options.autoplayObserved ?? "unknown";
    const remainingMs = computeRemainingMs(state, nowMs);
    const isTimedExpired = state.status === "active" && state.spec !== null && state.spec.mode !== "maxLength" && remainingMs !== null && remainingMs <= 0;
    let derivedStatus;
    if (snoozed) {
      derivedStatus = "snoozed";
    } else if (autoplayObserved2 === "enabled") {
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
      autoplayObserved: autoplayObserved2,
      shortsStage: computeShortsStage(effectiveState, nowMs),
      shortsLockedForSession: effectiveState.shortsLockedForSession,
      acknowledgedPrompts: { ...effectiveState.acknowledgedPrompts },
      policy: { ...effectiveState.policy }
    };
  }
  function buildStandardWatchUrl(videoId, currentTimeSeconds, origin = "https://www.youtube.com") {
    const base = `${origin}/watch?v=${encodeURIComponent(videoId)}`;
    if (currentTimeSeconds && currentTimeSeconds >= 1) {
      return `${base}&t=${Math.floor(currentTimeSeconds)}s`;
    }
    return base;
  }

  // src/core/schedule.ts
  var SCHEDULE_KEY = "timeTubeSchedule";
  var MINUTE_MS = 6e4;
  var EMPTY_SCHEDULE = { enabled: false, rules: [], usage: {} };
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
    const open = windows.filter((window2) => window2.opensAt <= now && now < window2.closesAt);
    for (const window2 of open) {
      const remainingMs = window2.limitMs - (state.usage[window2.key]?.usedMs ?? 0);
      if (remainingMs > 0) return { kind: "open", ...window2, remainingMs };
    }
    if (!open.length && !windows.some((window2) => window2.key === today)) return { kind: "unassigned" };
    const candidates = windows.flatMap(({ opensAt, closesAt }) => [opensAt, closesAt]);
    const date = new Date(now);
    for (let offset = 1; offset <= 7; offset++) {
      candidates.push(new Date(date.getFullYear(), date.getMonth(), date.getDate() + offset).getTime());
    }
    const nextOpen = candidates.filter((time) => time > now).sort((a, b) => a - b).find((time) => {
      const current = windows.filter(({ opensAt, closesAt }) => opensAt <= time && time < closesAt);
      if (current.length) return current.some(({ key, limitMs }) => (state.usage[key]?.usedMs ?? 0) < limitMs);
      const day = dateKey(new Date(time));
      return !windows.some((window2) => window2.key === day);
    }) ?? null;
    return { kind: open.length ? "spent" : "closed", nextOpen };
  }

  // src/core/duration.ts
  function parseDurationText(raw) {
    if (!raw) return null;
    const cleaned = raw.trim();
    if (!cleaned) return null;
    const colonMatch = cleaned.match(/\b(\d{1,2}:)?(\d{1,2}):(\d{2})\b/);
    if (colonMatch) {
      const parts = colonMatch[0].split(":").map((p) => Number.parseInt(p, 10));
      if (parts.some((n) => Number.isNaN(n))) return null;
      if (parts.length === 2) {
        return (parts[0] ?? 0) * 60 + (parts[1] ?? 0);
      }
      if (parts.length === 3) {
        return (parts[0] ?? 0) * 3600 + (parts[1] ?? 0) * 60 + (parts[2] ?? 0);
      }
    }
    const hoursMatch = cleaned.match(/(\d+)\s+hours?\b(?!\s+ago\b)/i);
    const minsMatch = cleaned.match(/(\d+)\s+minutes?\b(?!\s+ago\b)/i);
    const secsMatch = cleaned.match(/(\d+)\s+seconds?\b(?!\s+ago\b)/i);
    if (hoursMatch || minsMatch || secsMatch) {
      const h = hoursMatch ? Number.parseInt(hoursMatch[1] ?? "0", 10) : 0;
      const m = minsMatch ? Number.parseInt(minsMatch[1] ?? "0", 10) : 0;
      const s = secsMatch ? Number.parseInt(secsMatch[1] ?? "0", 10) : 0;
      return h * 3600 + m * 60 + s;
    }
    return null;
  }
  function formatDurationBadge(totalSeconds) {
    const safe = Math.max(0, Math.round(totalSeconds));
    const hours = Math.floor(safe / 3600);
    const minutes = Math.floor(safe % 3600 / 60);
    const seconds = safe % 60;
    const pad = (n) => String(n).padStart(2, "0");
    if (hours > 0) {
      return `${hours}:${pad(minutes)}:${pad(seconds)}`;
    }
    return `${minutes}:${pad(seconds)}`;
  }
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
  function extractShortIdFromHref(href) {
    const match = href.match(/\/shorts\/([a-zA-Z0-9_-]{6,})/);
    return match?.[1] ?? null;
  }
  function getDefaultEndTime(nowMs = Date.now()) {
    const d = new Date(nowMs);
    const totalMinutes = d.getHours() * 60 + d.getMinutes();
    const nextQuarter = (Math.floor(totalMinutes / 15) + 1) * 15 % (24 * 60);
    const hh = String(Math.floor(nextQuarter / 60)).padStart(2, "0");
    const mm = String(nextQuarter % 60).padStart(2, "0");
    return `${hh}:${mm}`;
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

  // src/shared/webext.ts
  var rawApi = globalThis.browser ?? globalThis.chrome;
  var webext = rawApi;

  // src/content/topbar.ts
  var popoverOpen = false;
  var userEditedUntilTime = false;
  var selectedMode = "countdown";
  var lastState = null;
  var outsideClickBound = false;
  function formatClock(ms) {
    const totalSec = Math.max(0, Math.ceil(ms / 1e3));
    const mins = Math.floor(totalSec / 60);
    const secs = totalSec % 60;
    return `${mins}:${String(secs).padStart(2, "0")}`;
  }
  function isDarkTheme() {
    return document.documentElement.hasAttribute("dark");
  }
  function getHeaderButtonsContainer() {
    return document.querySelector("ytd-masthead #end #buttons") ?? document.querySelector("#masthead-container #end #buttons") ?? document.querySelector("#end #buttons");
  }
  function findCreateButtonSlot(container) {
    const candidates = Array.from(container.children);
    for (const child of candidates) {
      if (child.id === "yt-timetube-topbar-wrap") continue;
      const text = child.textContent?.trim().toLowerCase() ?? "";
      const aria = child.querySelector("[aria-label]")?.getAttribute("aria-label")?.toLowerCase() ?? "";
      if (text.includes("create") || aria.includes("create")) {
        return child;
      }
    }
    return candidates[0] ?? null;
  }
  function closeTopbarPopover() {
    popoverOpen = false;
    const pop = document.getElementById("yt-timetube-popover");
    if (pop) pop.classList.add("yt-tt-hidden");
  }
  function buildPopover(onStateChange) {
    const pop = document.createElement("div");
    pop.id = "yt-timetube-popover";
    pop.className = "yt-tt-popover yt-tt-hidden";
    pop.setAttribute("role", "dialog");
    pop.setAttribute("aria-label", "TimeTube Controls");
    pop.innerHTML = `
    <div class="yt-tt-pop-header">
      <div class="yt-tt-pop-brand">
        <img class="yt-tt-pop-logo" alt="" width="20" height="20" />
        <strong>TimeTube</strong>
      </div>
      <span id="yt-tt-status-pill" class="yt-tt-status yt-tt-status-idle">Off</span>
    </div>

    <div id="yt-tt-active-banner" class="yt-tt-active-strip yt-tt-hidden">
      <div class="yt-tt-active-meta">
        <span class="yt-tt-caption">Time remaining</span>
        <strong id="yt-tt-remaining" class="yt-tt-clock">--:--</strong>
      </div>
      <div class="yt-tt-active-actions">
        <button id="yt-tt-extend" type="button" class="yt-tt-pill-btn yt-tt-pill-tonal">+5 min</button>
        <button id="yt-tt-stop" type="button" class="yt-tt-pill-btn yt-tt-pill-danger">Stop</button>
      </div>
    </div>

    <div class="yt-tt-section">
      <div class="yt-tt-tabs" role="tablist">
        <button type="button" class="yt-tt-tab active" data-mode="countdown">Timer</button>
        <button type="button" class="yt-tt-tab" data-mode="until">End time</button>
        <button type="button" class="yt-tt-tab" data-mode="maxLength">Max length</button>
      </div>

      <div id="yt-tt-panel-countdown" class="yt-tt-mode-panel">
        <div class="yt-tt-chips">
          <button type="button" class="yt-tt-chip" data-mins="15">15 min</button>
          <button type="button" class="yt-tt-chip active" data-mins="25">25 min</button>
          <button type="button" class="yt-tt-chip" data-mins="45">45 min</button>
        </div>
        <label class="yt-tt-field-row">
          <span>Custom minutes</span>
          <input id="yt-tt-countdown-mins" type="number" min="1" max="360" value="25" class="yt-tt-input" />
        </label>
      </div>

      <div id="yt-tt-panel-until" class="yt-tt-mode-panel yt-tt-hidden">
        <label class="yt-tt-field-row">
          <span>Stop watching at</span>
          <input id="yt-tt-until-time" type="time" value="17:00" class="yt-tt-input" />
        </label>
      </div>

      <div id="yt-tt-panel-maxLength" class="yt-tt-mode-panel yt-tt-hidden">
        <label class="yt-tt-field-row">
          <span>Max video length (min)</span>
          <input id="yt-tt-max-mins" type="number" min="1" max="240" value="15" class="yt-tt-input" />
        </label>
      </div>

      <button id="yt-tt-start" aria-describedby="yt-tt-start-message" type="button" class="yt-tt-pill-btn yt-tt-pill-primary yt-tt-full">Start session</button>
      <p id="yt-tt-start-message" role="status" hidden></p>
    </div>

    <div class="yt-tt-divider" role="separator"></div>

    <div class="yt-tt-section yt-tt-settings">
      <span class="yt-tt-section-label">Playback &amp; Shorts</span>

      <label class="yt-tt-setting-row">
        <span>Open Shorts in standard player</span>
        <span class="yt-tt-switch">
          <input id="yt-tt-disable-shorts" type="checkbox" />
          <span class="yt-tt-switch-track"><span class="yt-tt-switch-knob"></span></span>
        </span>
      </label>

      <label id="yt-tt-cutoff-row" class="yt-tt-setting-row">
        <span>Leave Shorts before end</span>
        <select id="yt-tt-shorts-cutoff" class="yt-tt-select">
          <option value="5">5 min left</option>
          <option value="10">10 min left</option>
        </select>
      </label>

      <label class="yt-tt-setting-row">
        <span>Videos over limit</span>
        <select id="yt-tt-exceed-action" class="yt-tt-select">
          <option value="hide">Hide</option>
          <option value="dim">Dim</option>
        </select>
      </label>

      <label class="yt-tt-setting-row">
        <span>Hide Shorts sidebar tab</span>
        <span class="yt-tt-switch">
          <input id="yt-tt-hide-nav" type="checkbox" checked />
          <span class="yt-tt-switch-track"><span class="yt-tt-switch-knob"></span></span>
        </span>
      </label>

      <label class="yt-tt-setting-row">
        <span>Show duration on Shorts</span>
        <span class="yt-tt-switch">
          <input id="yt-tt-show-durations" type="checkbox" checked />
          <span class="yt-tt-switch-track"><span class="yt-tt-switch-knob"></span></span>
        </span>
      </label>
    </div>
  `;
    const logoImg = pop.querySelector(".yt-tt-pop-logo");
    if (logoImg) {
      logoImg.src = webext.runtime.getURL("assets/logo-main.svg");
    }
    pop.addEventListener("keydown", (e) => {
      if (e.key === "Escape") {
        closeTopbarPopover();
      }
      e.stopPropagation();
    });
    pop.querySelectorAll(".yt-tt-tab").forEach((tab) => {
      tab.addEventListener("click", () => {
        const mode = tab.dataset.mode;
        if (!mode) return;
        selectedMode = mode;
        pop.querySelectorAll(".yt-tt-tab").forEach((t) => {
          t.classList.toggle("active", t.dataset.mode === mode);
        });
        pop.querySelector("#yt-tt-panel-countdown")?.classList.toggle("yt-tt-hidden", mode !== "countdown");
        pop.querySelector("#yt-tt-panel-until")?.classList.toggle("yt-tt-hidden", mode !== "until");
        pop.querySelector("#yt-tt-panel-maxLength")?.classList.toggle("yt-tt-hidden", mode !== "maxLength");
      });
    });
    const countdownInput = pop.querySelector("#yt-tt-countdown-mins");
    const syncChips = () => {
      const val = countdownInput?.value.trim() ?? "";
      pop.querySelectorAll(".yt-tt-chip").forEach((c) => {
        c.classList.toggle("active", c.dataset.mins === val);
      });
    };
    pop.querySelectorAll(".yt-tt-chip").forEach((btn) => {
      btn.addEventListener("click", () => {
        if (countdownInput && btn.dataset.mins) {
          countdownInput.value = btn.dataset.mins;
          syncChips();
        }
      });
    });
    countdownInput?.addEventListener("input", syncChips);
    const untilInputEl = pop.querySelector("#yt-tt-until-time");
    if (untilInputEl) {
      untilInputEl.value = getDefaultEndTime();
      untilInputEl.addEventListener("input", () => {
        userEditedUntilTime = true;
      });
    }
    pop.querySelector("#yt-tt-start")?.addEventListener("click", async () => {
      const countdownVal = Number(countdownInput?.value || 25);
      const untilVal = pop.querySelector("#yt-tt-until-time")?.value || getDefaultEndTime();
      const maxVal = Number(pop.querySelector("#yt-tt-max-mins")?.value || 15);
      let spec;
      if (selectedMode === "countdown") {
        spec = { mode: "countdown", durationMinutes: Math.max(1, countdownVal) };
      } else if (selectedMode === "until") {
        spec = { mode: "until", endTime: untilVal };
      } else {
        spec = { mode: "maxLength", maxMinutes: Math.max(1, maxVal) };
      }
      const status = pop.querySelector("#yt-tt-start-message");
      status.hidden = true;
      try {
        const result = await webext.runtime.sendMessage({
          type: "START_SCHEDULED_SESSION",
          spec
        });
        if ("error" in result) throw new Error(result.error);
        if (result.kind === "start") {
          onStateChange(result.state);
          return;
        }
        status.textContent = result.kind === "conflict" ? "This session exceeds your schedule. Open the TimeTube toolbar popup to shorten it or add extra time." : "Your schedule is restricting access.";
      } catch {
        status.textContent = "Could not start the session. Try again.";
      }
      status.hidden = false;
    });
    pop.querySelector("#yt-tt-extend")?.addEventListener("click", async () => {
      const next = await webext.runtime.sendMessage({
        type: "EXTEND_SESSION",
        additionalMinutes: 5
      });
      onStateChange(next);
    });
    pop.querySelector("#yt-tt-stop")?.addEventListener("click", async () => {
      const next = await webext.runtime.sendMessage({
        type: "STOP_SESSION"
      });
      onStateChange(next);
    });
    const syncPolicy = async () => {
      const disableShorts = Boolean(pop.querySelector("#yt-tt-disable-shorts")?.checked);
      const cutoff = Number(pop.querySelector("#yt-tt-shorts-cutoff")?.value) === 10 ? 10 : 5;
      const exceed = pop.querySelector("#yt-tt-exceed-action")?.value === "dim" ? "dim" : "hide";
      const hideNav = Boolean(pop.querySelector("#yt-tt-hide-nav")?.checked);
      const showDur = Boolean(pop.querySelector("#yt-tt-show-durations")?.checked);
      const next = await webext.runtime.sendMessage({
        type: "UPDATE_POLICY",
        patch: {
          shortsMode: disableShorts ? "redirectToWatch" : "escalatingNudge",
          shortsLockCutoffMinutes: cutoff,
          exceedAction: exceed,
          hideShortsNavButton: hideNav,
          showShortDurationBadges: showDur
        }
      });
      onStateChange(next);
    };
    pop.querySelector("#yt-tt-disable-shorts")?.addEventListener("change", syncPolicy);
    pop.querySelector("#yt-tt-shorts-cutoff")?.addEventListener("change", syncPolicy);
    pop.querySelector("#yt-tt-exceed-action")?.addEventListener("change", syncPolicy);
    pop.querySelector("#yt-tt-hide-nav")?.addEventListener("change", syncPolicy);
    pop.querySelector("#yt-tt-show-durations")?.addEventListener("change", syncPolicy);
    return pop;
  }
  function syncTopbarControl(state, onStateChange, onWake) {
    lastState = state;
    const container = getHeaderButtonsContainer();
    if (!container) return;
    let wrap = document.getElementById("yt-timetube-topbar-wrap");
    if (!wrap) {
      wrap = document.createElement("div");
      wrap.id = "yt-timetube-topbar-wrap";
      wrap.className = "yt-tt-topbar-wrap";
      const btn = document.createElement("button");
      btn.id = "yt-timetube-topbar-btn";
      btn.type = "button";
      btn.className = "yt-tt-topbar-btn";
      btn.setAttribute("aria-label", "Open TimeTube menu");
      btn.title = "TimeTube";
      const icon = document.createElement("img");
      icon.id = "yt-timetube-topbar-icon";
      icon.className = "yt-tt-topbar-icon";
      icon.alt = "TimeTube";
      const badge = document.createElement("span");
      badge.id = "yt-timetube-topbar-badge";
      badge.className = "yt-tt-topbar-badge yt-tt-hidden";
      btn.appendChild(icon);
      btn.appendChild(badge);
      wrap.appendChild(btn);
      const popover = buildPopover(onStateChange);
      wrap.appendChild(popover);
      btn.addEventListener("click", (e) => {
        e.stopPropagation();
        onWake();
        popoverOpen = !popoverOpen;
        popover.classList.toggle("yt-tt-hidden", !popoverOpen);
        if (popoverOpen && lastState) {
          if (!userEditedUntilTime) {
            const u = popover.querySelector("#yt-tt-until-time");
            if (u) u.value = getDefaultEndTime();
          }
          updatePopoverUI(popover, lastState);
        }
      });
      const createSlot = findCreateButtonSlot(container);
      if (createSlot) {
        container.insertBefore(wrap, createSlot);
      } else {
        container.prepend(wrap);
      }
      if (!outsideClickBound) {
        outsideClickBound = true;
        document.addEventListener("click", (event) => {
          if (!popoverOpen) return;
          const wrapEl = document.getElementById("yt-timetube-topbar-wrap");
          if (wrapEl && !wrapEl.contains(event.target)) {
            closeTopbarPopover();
          }
        });
      }
    }
    updateTopbarBadge(state);
    const pop = document.getElementById("yt-timetube-popover");
    if (pop && popoverOpen) {
      updatePopoverUI(pop, state);
    }
  }
  function updateTopbarBadge(state) {
    const icon = document.getElementById("yt-timetube-topbar-icon");
    const badge = document.getElementById("yt-timetube-topbar-badge");
    if (!icon || !badge) return;
    const remainingMs = computeRemainingMs(state, Date.now());
    const hasActiveBadge = state.status === "active" || state.status === "paused" || state.status === "expired";
    const lightMode = !isDarkTheme();
    icon.classList.toggle("yt-tt-icon-light", lightMode);
    if (!hasActiveBadge) {
      icon.src = webext.runtime.getURL("assets/topbar-empty.svg");
      badge.classList.add("yt-tt-hidden");
      badge.textContent = "";
      return;
    }
    icon.src = webext.runtime.getURL("assets/topbar-empty.svg");
    let label = "";
    if (state.status === "expired") {
      label = "0s";
    } else if (state.spec?.mode === "maxLength") {
      label = formatApproxRemaining(state.spec.maxMinutes * 6e4);
    } else if (remainingMs !== null) {
      label = formatApproxRemaining(remainingMs);
    }
    if (label) {
      badge.textContent = label;
      badge.classList.remove("yt-tt-hidden");
      badge.classList.toggle("yt-tt-badge-paused", state.status === "paused");
    } else {
      badge.classList.add("yt-tt-hidden");
    }
  }
  function updatePopoverUI(pop, state) {
    const pill = pop.querySelector("#yt-tt-status-pill");
    const activeBanner = pop.querySelector("#yt-tt-active-banner");
    const remainingEl = pop.querySelector("#yt-tt-remaining");
    const extendBtn = pop.querySelector("#yt-tt-extend");
    const remainingMs = computeRemainingMs(state, Date.now());
    if (pill && activeBanner && remainingEl && extendBtn) {
      if (state.status === "active" || state.status === "paused") {
        pill.textContent = state.status === "paused" ? "Paused" : state.spec?.mode === "maxLength" ? "Max length" : "Active";
        pill.className = state.status === "paused" ? "yt-tt-status yt-tt-status-paused" : "yt-tt-status yt-tt-status-active";
        activeBanner.classList.remove("yt-tt-hidden");
        if (state.spec?.mode === "maxLength") {
          remainingEl.textContent = `\u2264 ${state.spec.maxMinutes}m`;
          extendBtn.classList.add("yt-tt-hidden");
        } else {
          remainingEl.textContent = remainingMs !== null ? formatClock(remainingMs) : "--:--";
          extendBtn.classList.remove("yt-tt-hidden");
        }
      } else if (state.status === "expired") {
        pill.textContent = "Time up";
        pill.className = "yt-tt-status yt-tt-status-expired";
        activeBanner.classList.remove("yt-tt-hidden");
        remainingEl.textContent = "0:00";
        extendBtn.classList.remove("yt-tt-hidden");
      } else {
        pill.textContent = "Off";
        pill.className = "yt-tt-status yt-tt-status-idle";
        activeBanner.classList.add("yt-tt-hidden");
      }
    }
    const disableShorts = pop.querySelector("#yt-tt-disable-shorts");
    const cutoffRow = pop.querySelector("#yt-tt-cutoff-row");
    const cutoffSelect = pop.querySelector("#yt-tt-shorts-cutoff");
    const exceedSelect = pop.querySelector("#yt-tt-exceed-action");
    const hideNav = pop.querySelector("#yt-tt-hide-nav");
    const showDur = pop.querySelector("#yt-tt-show-durations");
    if (disableShorts) disableShorts.checked = state.policy.shortsMode === "redirectToWatch";
    if (cutoffRow) cutoffRow.classList.toggle("yt-tt-hidden", state.policy.shortsMode === "redirectToWatch");
    if (cutoffSelect) cutoffSelect.value = String(state.policy.shortsLockCutoffMinutes);
    if (exceedSelect) exceedSelect.value = state.policy.exceedAction;
    if (hideNav) hideNav.checked = state.policy.hideShortsNavButton;
    if (showDur) showDur.checked = state.policy.showShortDurationBadges;
  }
  function tickTopbarUI(state) {
    updateTopbarBadge(state);
    const pop = document.getElementById("yt-timetube-popover");
    if (pop && popoverOpen) {
      updatePopoverUI(pop, state);
    }
  }
  function openTopbarPopover() {
    const pop = document.getElementById("yt-timetube-popover");
    if (!pop) return;
    popoverOpen = true;
    pop.classList.remove("yt-tt-hidden");
    if (!userEditedUntilTime) {
      const u = pop.querySelector("#yt-tt-until-time");
      if (u) u.value = getDefaultEndTime();
    }
    if (lastState) {
      updatePopoverUI(pop, lastState);
    }
  }

  // src/content/index.ts
  var STATE_KEY = "ytTimeFitSessionState";
  var AUTOPLAY_HELP_URL = "https://support.google.com/youtube/answer/6327615";
  var SWEEP_INTERVAL_MS = 4e3;
  var VIDEO_CARD_SELECTORS = [
    "ytd-rich-item-renderer",
    "ytd-video-renderer",
    "ytd-compact-video-renderer",
    "ytd-grid-video-renderer",
    "yt-lockup-view-model",
    "ytm-shorts-lockup-view-model",
    "ytm-shorts-lockup-view-model-v2",
    "ytd-reel-item-renderer",
    "ytm-video-with-context-renderer",
    "ytm-compact-video-renderer"
  ].join(", ");
  var DURATION_BADGE_SELECTORS = [
    "ytd-thumbnail-overlay-time-status-renderer #text",
    "ytd-thumbnail-overlay-time-status-renderer .badge-shape-wiz__text",
    "ytd-thumbnail-overlay-time-status-renderer",
    "yt-thumbnail-overlay-badge-view-model .yt-badge-shape__text",
    "yt-thumbnail-overlay-badge-view-model .badge-shape-wiz__text",
    "yt-thumbnail-badge-view-model .yt-badge-shape__text",
    "yt-thumbnail-badge-view-model .badge-shape-wiz__text",
    "yt-thumbnail-badge-view-model",
    "badge-shape .yt-badge-shape__text",
    "badge-shape .badge-shape-wiz__text",
    "badge-shape",
    ".yt-badge-shape__text",
    ".badge-shape-wiz__text"
  ].join(", ");
  var SHORTS_NAV_SELECTORS = [
    'ytd-guide-entry-renderer a[title="Shorts"]',
    'ytd-mini-guide-entry-renderer a[title="Shorts"]',
    "ytm-pivot-bar-item-renderer .pivot-shorts"
  ];
  var persistedState = { ...INITIAL_PERSISTED_STATE };
  var snoozedUntilReloadOrPopup = false;
  var autoplayObserved = "unknown";
  var autoplayGuideActive = false;
  var activeModalId = null;
  var modalTimerInterval = null;
  var topbarTickInterval = null;
  var expiredScreenRendered = false;
  var mediaListenersAttached = false;
  var inputBlockerAttached = false;
  var ignorePauseUntilMs = 0;
  var ignoreOverrunUntilMs = 0;
  var timerPausedByVideo = false;
  var pausePromptTimer = null;
  var seekOverrunTimer = null;
  var lastDirectCheckedVideoId = null;
  var acceptedEarlyCutoffVideoId = null;
  var resolvedShortDurations = /* @__PURE__ */ new Map();
  var pendingShortIds = /* @__PURE__ */ new Set();
  var shortObserver = null;
  var mutationObserver = null;
  var sweepTimer = null;
  var exactExpiryTimer = null;
  var mutationDebounceTimer = null;
  var lastScrollNudgeMs = 0;
  var consecutiveScrollNudges = 0;
  var schedule = EMPTY_SCHEDULE;
  var scheduleDocumentId = crypto.randomUUID();
  var scheduleBlocked = false;
  var scheduleHeartbeat = null;
  var lastScheduleSampleAt = 0;
  function scheduleRestrictsAccess() {
    const { kind } = getScheduleStatus(schedule, Date.now());
    return kind === "closed" || kind === "spent";
  }
  function publishScheduleSample() {
    if (!schedule.enabled) return;
    lastScheduleSampleAt = Date.now();
    const video = getActivePlayerVideo();
    webext.runtime.sendMessage({
      type: "SCHEDULE_SAMPLE",
      documentId: scheduleDocumentId,
      visible: !document.hidden && !expiredScreenRendered,
      playing: Boolean(video && !video.paused && !video.ended && !video.seeking && video.readyState >= 3)
    }).catch(() => void 0);
  }
  function getCurrentSnapshot() {
    const snapshot = buildSessionSnapshot(persistedState, Date.now(), {
      snoozed: snoozedUntilReloadOrPopup,
      autoplayObserved
    });
    return scheduleRestrictsAccess() ? { ...snapshot, status: "expired", remainingMs: 0, maxAllowedVideoSeconds: null } : snapshot;
  }
  function isWatchPage() {
    return window.location.pathname === "/watch";
  }
  function isShortsPage() {
    return window.location.pathname.startsWith("/shorts/");
  }
  function getActiveMediaId() {
    if (isWatchPage()) {
      return new URLSearchParams(window.location.search).get("v");
    }
    if (isShortsPage()) {
      return extractShortIdFromHref(window.location.pathname);
    }
    return null;
  }
  function isMainPlayerVideo(el) {
    if (!el || typeof el.tagName !== "string") return false;
    if (el.tagName.toUpperCase() !== "VIDEO") return false;
    if (!isWatchPage() && !isShortsPage()) return false;
    const video = el;
    if (!Number.isFinite(video.duration) || video.duration <= 0) return false;
    if (isWatchPage()) {
      return Boolean(
        video.classList.contains("html5-main-video") || video.closest("#movie_player, .html5-video-player, ytd-player")
      );
    }
    return Boolean(
      video.closest("#shorts-player, ytd-reel-video-renderer, .html5-video-player") || video.classList.contains("html5-main-video")
    );
  }
  function isVideoActivelyPlaying() {
    const video = document.querySelector("video.html5-main-video");
    return Boolean(video && !video.paused && !video.ended && video.readyState >= 2);
  }
  function getActivePlayerVideo() {
    if (isShortsPage()) {
      return document.querySelector("ytd-reel-video-renderer[is-active] video") ?? document.querySelector("#shorts-player video") ?? document.querySelector("video.html5-main-video, video");
    }
    return document.querySelector("#movie_player video.html5-main-video") ?? document.querySelector("video.html5-main-video, video");
  }
  function formatHumanDuration(totalSeconds) {
    const safe = Math.max(1, Math.round(totalSeconds));
    const mins = Math.floor(safe / 60);
    const secs = safe % 60;
    if (mins === 0) return `${secs}s`;
    if (secs === 0) return `${mins}m`;
    return `${mins}m ${secs}s`;
  }
  function formatCountdownClock(ms) {
    const totalSec = Math.max(0, Math.ceil(ms / 1e3));
    const hours = Math.floor(totalSec / 3600);
    const mins = Math.floor(totalSec % 3600 / 60);
    const secs = totalSec % 60;
    const pad = (n) => String(n).padStart(2, "0");
    if (hours > 0) return `${hours}:${pad(mins)}:${pad(secs)}`;
    return `${mins}:${pad(secs)}`;
  }
  function formatSpeed(speed) {
    return `${Number(speed.toFixed(2))}\xD7`;
  }
  function readAutoplayToggleState() {
    const toggleBtn = document.querySelector(
      'button[data-tooltip-target-id="ytp-autonav-toggle-button"], .ytp-autonav-toggle-button'
    );
    if (!toggleBtn) return "unknown";
    const innerSwitch = toggleBtn.querySelector(".ytp-autonav-toggle-button[aria-checked], [aria-checked]");
    const checked = innerSwitch?.getAttribute("aria-checked") ?? toggleBtn.getAttribute("aria-checked");
    if (checked === "true") return "enabled";
    if (checked === "false") return "disabled";
    const label = (toggleBtn.getAttribute("title") ?? toggleBtn.getAttribute("aria-label") ?? toggleBtn.getAttribute("data-title-no-tooltip") ?? "").toLowerCase();
    if (label.includes("autoplay is on")) return "enabled";
    if (label.includes("autoplay is off")) return "disabled";
    return "unknown";
  }
  function pauseActiveVideo(byExtension = true) {
    if (byExtension) {
      ignorePauseUntilMs = Date.now() + 500;
    }
    const videos = document.querySelectorAll("video");
    for (const video of videos) {
      if (!video.paused) {
        video.pause();
      }
    }
  }
  function resumeVideo(video) {
    if (!video) return;
    video.play().catch(() => void 0);
  }
  function attachModalInputBlocker() {
    if (inputBlockerAttached) return;
    inputBlockerAttached = true;
    const blockKeyboard = (event) => {
      if (activeModalId === null) return;
      const modalRoot = document.getElementById("yt-timefit-modal-root");
      if (!modalRoot) return;
      const target = event.target;
      const insideModalBtn = Boolean(target && modalRoot.contains(target) && target.tagName === "BUTTON");
      if (insideModalBtn && (event.key === "Tab" || event.key === "Enter")) {
        return;
      }
      event.preventDefault();
      event.stopPropagation();
      event.stopImmediatePropagation();
    };
    window.addEventListener("keydown", blockKeyboard, true);
    window.addEventListener("keyup", blockKeyboard, true);
    window.addEventListener("keypress", blockKeyboard, true);
    const blockOutsidePointer = (event) => {
      if (activeModalId === null) return;
      const modalRoot = document.getElementById("yt-timefit-modal-root");
      if (!modalRoot) return;
      const target = event.target;
      if (target && modalRoot.contains(target)) return;
      event.preventDefault();
      event.stopPropagation();
      event.stopImmediatePropagation();
    };
    window.addEventListener("mousedown", blockOutsidePointer, true);
    window.addEventListener("click", blockOutsidePointer, true);
    window.addEventListener("wheel", blockOutsidePointer, { capture: true, passive: false });
  }
  function removeModal() {
    if (modalTimerInterval !== null) {
      window.clearInterval(modalTimerInterval);
      modalTimerInterval = null;
    }
    const existing = document.getElementById("yt-timefit-modal-root");
    if (existing) existing.remove();
    document.documentElement.classList.remove("yt-timefit-modal-open");
    activeModalId = null;
  }
  function showModal(id, title, body, actions, onTick) {
    if (activeModalId === id && document.getElementById("yt-timefit-modal-root")) {
      return;
    }
    closeTopbarPopover();
    removeModal();
    activeModalId = id;
    document.documentElement.classList.add("yt-timefit-modal-open");
    const root = document.createElement("div");
    root.id = "yt-timefit-modal-root";
    root.className = "yt-timefit-backdrop";
    root.setAttribute("role", "dialog");
    root.setAttribute("aria-modal", "true");
    const card = document.createElement("div");
    card.className = "yt-timefit-modal";
    const headerRow = document.createElement("div");
    headerRow.className = "yt-timefit-modal-header";
    const heading = document.createElement("h2");
    heading.textContent = title;
    headerRow.appendChild(heading);
    const timerPill = document.createElement("span");
    timerPill.className = "yt-timefit-modal-timer";
    headerRow.appendChild(timerPill);
    const text = document.createElement("p");
    text.textContent = body;
    const btnRow = document.createElement("div");
    btnRow.className = "yt-timefit-actions";
    let firstButton = null;
    const buttonMap = /* @__PURE__ */ new Map();
    for (const act of actions) {
      const btn = document.createElement("button");
      btn.type = "button";
      btn.textContent = act.label;
      btn.className = `yt-timefit-btn yt-timefit-btn-${act.variant}`;
      btn.addEventListener("click", act.onClick);
      if (act.id) buttonMap.set(act.id, btn);
      if (!firstButton) firstButton = btn;
      btnRow.appendChild(btn);
    }
    const refreshModalTimer = () => {
      const snap = getCurrentSnapshot();
      if (snap.status === "expired") {
        runFullSweep();
        return;
      }
      if (snap.remainingMs !== null) {
        timerPill.style.display = "";
        timerPill.textContent = snap.status === "paused" ? `Paused \xB7 ${formatCountdownClock(snap.remainingMs)}` : `Time left \xB7 ${formatCountdownClock(snap.remainingMs)}`;
      } else {
        timerPill.style.display = "none";
      }
      onTick?.({ bodyEl: text, buttons: buttonMap });
    };
    refreshModalTimer();
    modalTimerInterval = window.setInterval(refreshModalTimer, 500);
    card.appendChild(headerRow);
    card.appendChild(text);
    card.appendChild(btnRow);
    root.appendChild(card);
    document.documentElement.appendChild(root);
    firstButton?.focus();
  }
  function clearEarlyCutoffBar() {
    const existing = document.getElementById("yt-timefit-cutoff-bar");
    if (existing) existing.remove();
  }
  function updateEarlyCutoffBar(video, snapshot) {
    const currentId = getActiveMediaId();
    if (!video || !currentId || acceptedEarlyCutoffVideoId !== currentId || snapshot.status !== "active" || snapshot.remainingMs === null || !Number.isFinite(video.duration) || video.duration <= 0) {
      clearEarlyCutoffBar();
      return;
    }
    const analysis = computePlaybackOverrun(
      video.currentTime,
      video.duration,
      video.playbackRate,
      snapshot.remainingMs
    );
    if (!analysis.isOverrunning) {
      clearEarlyCutoffBar();
      return;
    }
    const progressBar = document.querySelector(
      ".ytp-progress-bar, #progress-bar-line, .player-controls-content .progress-bar-line"
    );
    if (!progressBar) return;
    let bar = document.getElementById("yt-timefit-cutoff-bar");
    if (!bar) {
      bar = document.createElement("div");
      bar.id = "yt-timefit-cutoff-bar";
      bar.className = "yt-timefit-cutoff-bar";
      progressBar.appendChild(bar);
    }
    const leftPct = Math.min(99.5, Math.max(0, analysis.cutoffPercent));
    bar.style.left = `${leftPct}%`;
    bar.style.width = `${Math.max(0, 100 - leftPct)}%`;
    bar.title = `Break timer ends at ${formatDurationBadge(analysis.cutoffVideoSeconds)}`;
  }
  function evaluateMediaOverrun(video, trigger) {
    if (snoozedUntilReloadOrPopup || expiredScreenRendered) return;
    if (activeModalId !== null) return;
    if (Date.now() < ignoreOverrunUntilMs) return;
    const videoId = getActiveMediaId();
    if (!videoId) return;
    const snapshot = getCurrentSnapshot();
    if (snapshot.status !== "active" || snapshot.remainingMs === null) return;
    if (!Number.isFinite(video.duration) || video.duration <= 0) return;
    const analysis = computePlaybackOverrun(
      video.currentTime,
      video.duration,
      video.playbackRate,
      snapshot.remainingMs
    );
    if (!analysis.isOverrunning) {
      if (acceptedEarlyCutoffVideoId === videoId) {
        acceptedEarlyCutoffVideoId = null;
        clearEarlyCutoffBar();
      }
      return;
    }
    if (acceptedEarlyCutoffVideoId === videoId) {
      updateEarlyCutoffBar(video, snapshot);
      return;
    }
    pauseActiveVideo(true);
    const computeLatest = () => {
      const snap = getCurrentSnapshot();
      const rem = snap.remainingMs ?? 0;
      return computePlaybackOverrun(video.currentTime, video.duration, video.playbackRate, rem);
    };
    const formatOverrunBody = (a) => `There is ${formatHumanDuration(a.videoRemainingSeconds)} left in this video, but only ${formatHumanDuration(a.breakRemainingSeconds)} left on your timer.` + (a.suggestedSpeed === null ? " Even at 2\xD7 speed, it will run past your break." : "");
    const actions = [
      {
        id: "add_time",
        label: `Add +${formatHumanDuration(analysis.extraSecondsNeeded)} to timer`,
        variant: "primary",
        onClick: async () => {
          const fresh = computeLatest();
          ignoreOverrunUntilMs = Date.now() + 2e3;
          removeModal();
          acceptedEarlyCutoffVideoId = null;
          clearEarlyCutoffBar();
          persistedState = await webext.runtime.sendMessage({
            type: "EXTEND_SESSION_SECONDS",
            additionalSeconds: Math.max(1, fresh.extraSecondsNeeded) + 5
          });
          runFullSweep();
          resumeVideo(video);
        }
      },
      {
        id: "speed_up",
        label: analysis.suggestedSpeed !== null ? `Speed up to ${formatSpeed(analysis.suggestedSpeed)}` : "",
        variant: "secondary",
        onClick: () => {
          const fresh = computeLatest();
          if (fresh.suggestedSpeed === null) return;
          ignoreOverrunUntilMs = Date.now() + 2e3;
          removeModal();
          acceptedEarlyCutoffVideoId = null;
          clearEarlyCutoffBar();
          video.playbackRate = fresh.suggestedSpeed;
          resumeVideo(video);
        }
      },
      {
        id: "accept_cutoff",
        label: "Accept early cutoff",
        variant: "ghost",
        onClick: () => {
          removeModal();
          acceptedEarlyCutoffVideoId = videoId;
          updateEarlyCutoffBar(video, getCurrentSnapshot());
          resumeVideo(video);
        }
      }
    ];
    showModal(
      `overrun_${videoId}_${trigger}`,
      "This video won't finish before time is up",
      formatOverrunBody(analysis),
      actions,
      ({ bodyEl, buttons }) => {
        const fresh = computeLatest();
        bodyEl.textContent = formatOverrunBody(fresh);
        const addBtn = buttons.get("add_time");
        if (addBtn) {
          addBtn.textContent = `Add +${formatHumanDuration(fresh.extraSecondsNeeded)} to timer`;
        }
        const speedBtn = buttons.get("speed_up");
        if (speedBtn) {
          if (fresh.suggestedSpeed !== null) {
            speedBtn.style.display = "";
            speedBtn.textContent = `Speed up to ${formatSpeed(fresh.suggestedSpeed)}`;
          } else {
            speedBtn.style.display = "none";
          }
        }
      }
    );
  }
  function attachDocumentMediaListeners() {
    if (mediaListenersAttached) return;
    mediaListenersAttached = true;
    window.addEventListener(
      "pause",
      (event) => {
        if (Date.now() < ignorePauseUntilMs) return;
        if (snoozedUntilReloadOrPopup || expiredScreenRendered) return;
        if (!isMainPlayerVideo(event.target)) return;
        const video = event.target;
        if (pausePromptTimer !== null) window.clearTimeout(pausePromptTimer);
        pausePromptTimer = window.setTimeout(() => {
          pausePromptTimer = null;
          if (!video.paused || video.ended || video.seeking) return;
          if (activeModalId !== null) return;
          const snapshot = getCurrentSnapshot();
          if (snapshot.status !== "active" || snapshot.remainingMs === null) {
            return;
          }
          if (!snapshot.spec || snapshot.spec.mode === "maxLength") {
            return;
          }
          const isUntilMode = snapshot.spec.mode === "until";
          const vidRem = Math.max(0, video.duration - video.currentTime);
          const body = vidRem > 0 ? `Choose whether to pause your break timer while this video (${formatHumanDuration(vidRem)} left) is paused, or keep the timer running.` : "Choose whether to pause your break timer while the video is paused, or keep it running.";
          showModal("pause_timer_choice", "Video paused \u2014 pause your timer too?", body, [
            {
              label: isUntilMode ? "Pause timer (shifts end time)" : "Pause timer",
              variant: "primary",
              onClick: async () => {
                removeModal();
                timerPausedByVideo = true;
                persistedState = await webext.runtime.sendMessage({
                  type: "PAUSE_TIMER"
                });
                runFullSweep();
              }
            },
            {
              label: isUntilMode ? "Keep end time" : "Keep timer going",
              variant: "secondary",
              onClick: () => {
                removeModal();
                timerPausedByVideo = false;
              }
            }
          ]);
        }, 250);
      },
      true
    );
    document.addEventListener(
      "play",
      async (event) => {
        if (!isMainPlayerVideo(event.target)) return;
        const video = event.target;
        if (activeModalId !== null) {
          ignorePauseUntilMs = Date.now() + 500;
          video.pause();
          return;
        }
        if (pausePromptTimer !== null) {
          window.clearTimeout(pausePromptTimer);
          pausePromptTimer = null;
        }
        if (snoozedUntilReloadOrPopup || expiredScreenRendered) return;
        checkAutoplayWhilePlaying();
        if (activeModalId !== null) return;
        if (timerPausedByVideo || persistedState.status === "paused") {
          timerPausedByVideo = false;
          persistedState = await webext.runtime.sendMessage({
            type: "RESUME_TIMER"
          });
          runFullSweep();
        }
        const mediaId = getActiveMediaId();
        if (mediaId) {
          lastDirectCheckedVideoId = mediaId;
        }
        evaluateMediaOverrun(video, "resume");
      },
      true
    );
    document.addEventListener(
      "loadedmetadata",
      (event) => {
        if (!isMainPlayerVideo(event.target)) return;
        const video = event.target;
        const mediaId = getActiveMediaId();
        if (!mediaId || mediaId === lastDirectCheckedVideoId) return;
        lastDirectCheckedVideoId = mediaId;
        evaluateMediaOverrun(video, "direct_link");
      },
      true
    );
    document.addEventListener(
      "seeked",
      (event) => {
        if (!isMainPlayerVideo(event.target)) return;
        const video = event.target;
        updateEarlyCutoffBar(video, getCurrentSnapshot());
        if (seekOverrunTimer !== null) window.clearTimeout(seekOverrunTimer);
        seekOverrunTimer = window.setTimeout(() => {
          seekOverrunTimer = null;
          if (video.seeking || video.ended) return;
          evaluateMediaOverrun(video, "seek_back");
        }, 300);
      },
      true
    );
    document.addEventListener(
      "ratechange",
      (event) => {
        if (!isMainPlayerVideo(event.target)) return;
        const video = event.target;
        updateEarlyCutoffBar(video, getCurrentSnapshot());
        evaluateMediaOverrun(video, "rate_change");
      },
      true
    );
  }
  function renderExpiredTakeover() {
    pauseActiveVideo(true);
    removeModal();
    clearEarlyCutoffBar();
    mutationObserver?.disconnect();
    shortObserver?.disconnect();
    if (window.location.pathname !== "/" || window.location.search || window.location.hash) {
      try {
        window.history.replaceState(null, "", "/");
      } catch {
      }
    }
    document.title = "Time's up \u2014 TimeTube";
    if (expiredScreenRendered && document.getElementById("yt-timefit-expired-screen")) {
      return;
    }
    expiredScreenRendered = true;
    const mediaEls = document.querySelectorAll("video, audio");
    for (const media of mediaEls) {
      media.pause();
      media.muted = true;
      media.removeAttribute("src");
    }
    if (document.body) {
      document.body.replaceChildren();
      document.body.className = "yt-timefit-expired-body";
    }
    const screen = document.createElement("main");
    screen.id = "yt-timefit-expired-screen";
    screen.className = "yt-timefit-expired-screen";
    const card = document.createElement("div");
    card.className = "yt-timefit-expired-card";
    const title = document.createElement("h1");
    title.textContent = "Time's up :)";
    const message = document.createElement("p");
    message.textContent = scheduleBlocked ? "Your YouTube schedule is restricting access. Open TimeTube to see when you can watch again." : "Your YouTube break has ended. You can start a new session or stop the timer from the TimeTube extension menu whenever you are ready.";
    card.appendChild(title);
    card.appendChild(message);
    screen.appendChild(card);
    document.body?.appendChild(screen);
  }
  function scheduleExactExpiryTrigger(snapshot) {
    if (exactExpiryTimer !== null) {
      window.clearTimeout(exactExpiryTimer);
      exactExpiryTimer = null;
    }
    if (snapshot.status === "active" && snapshot.remainingMs !== null && snapshot.remainingMs > 0) {
      const delay = Math.min(snapshot.remainingMs + 50, 24 * 60 * 6e4);
      exactExpiryTimer = window.setTimeout(() => {
        exactExpiryTimer = null;
        runFullSweep();
      }, delay);
    }
  }
  function showAutoplayDetectedPrompt() {
    showModal(
      "autoplay_detected_enabled",
      "YouTube Autoplay is turned on",
      "TimeTube paused this video because YouTube Autoplay is currently enabled. Turn Autoplay off on the video player bar so YouTube does not roll into another video past your break.",
      [
        {
          label: isWatchPage() ? "Highlight Autoplay toggle" : "How to disable Autoplay",
          variant: "primary",
          onClick: () => {
            removeModal();
            if (isWatchPage()) {
              autoplayGuideActive = true;
              highlightAutoplayToggle();
            } else {
              window.open(AUTOPLAY_HELP_URL, "_blank", "noopener");
            }
          }
        },
        {
          label: "I've turned it off",
          variant: "secondary",
          onClick: () => {
            removeModal();
            autoplayGuideActive = false;
            const recheck = readAutoplayToggleState();
            if (recheck === "enabled") {
              pauseActiveVideo(true);
              showAutoplayDetectedPrompt();
            } else {
              autoplayObserved = recheck;
              const video = document.querySelector("video.html5-main-video");
              resumeVideo(video);
            }
          }
        },
        {
          label: "Not now",
          variant: "ghost",
          onClick: () => {
            removeModal();
            snoozedUntilReloadOrPopup = true;
            restoreAllCards();
            syncShortsNavVisibility();
          }
        }
      ]
    );
  }
  function highlightAutoplayToggle() {
    const toggleBtn = document.querySelector(
      'button[data-tooltip-target-id="ytp-autonav-toggle-button"], .ytp-autonav-toggle-button'
    );
    if (!toggleBtn) return;
    toggleBtn.scrollIntoView({ behavior: "smooth", block: "center" });
    toggleBtn.classList.add("yt-timefit-autoplay-highlight");
    window.setTimeout(() => {
      toggleBtn.classList.remove("yt-timefit-autoplay-highlight");
    }, 6e3);
  }
  function checkAutoplayWhilePlaying() {
    if (snoozedUntilReloadOrPopup || expiredScreenRendered) return;
    if (!isWatchPage()) {
      autoplayObserved = "unknown";
      return;
    }
    const observed = readAutoplayToggleState();
    autoplayObserved = observed;
    if (observed === "disabled") {
      autoplayGuideActive = false;
      if (persistedState.autoplayOnboarding !== "verified_disabled") {
        webext.runtime.sendMessage({
          type: "SET_AUTOPLAY_ONBOARDING",
          state: "verified_disabled"
        }).then((next) => {
          persistedState = next;
        }).catch(() => void 0);
      }
      if (activeModalId === "autoplay_detected_enabled") {
        removeModal();
      }
      return;
    }
    if (observed === "enabled" && !autoplayGuideActive && isVideoActivelyPlaying()) {
      pauseActiveVideo(true);
      showAutoplayDetectedPrompt();
    }
  }
  function syncShortsNavVisibility() {
    if (expiredScreenRendered) return;
    const shouldHideNav = !snoozedUntilReloadOrPopup && persistedState.policy.hideShortsNavButton;
    for (const selector of SHORTS_NAV_SELECTORS) {
      const matches = document.querySelectorAll(selector);
      for (const el of matches) {
        const container = el.closest("ytd-guide-entry-renderer, ytd-mini-guide-entry-renderer, ytm-pivot-bar-item-renderer") ?? el;
        if (shouldHideNav) {
          container.setAttribute("data-ytb-nav-hidden", "true");
        } else {
          container.removeAttribute("data-ytb-nav-hidden");
        }
      }
    }
  }
  function findVideoDurationSeconds(card) {
    const explicitLive = card.querySelector(
      '.badge-style-type-live-now-alternate, [overlay-style="LIVE"], ytd-badge-supported-renderer[aria-label*="LIVE"]'
    );
    if (explicitLive) {
      return { seconds: null, isLive: true };
    }
    const badges = card.querySelectorAll(DURATION_BADGE_SELECTORS);
    let sawLiveText = false;
    for (const el of badges) {
      if (el.classList.contains("yt-timefit-short-duration")) continue;
      const text = el.textContent?.trim() ?? "";
      const aria = el.getAttribute("aria-label")?.trim() ?? "";
      if (/^\s*live\s*$/i.test(text) || /\blive now\b/i.test(aria)) {
        sawLiveText = true;
        continue;
      }
      const fromText = parseDurationText(text);
      if (fromText !== null) return { seconds: fromText, isLive: false };
      const fromAria = parseDurationText(aria);
      if (fromAria !== null) return { seconds: fromAria, isLive: false };
    }
    if (sawLiveText) {
      return { seconds: null, isLive: true };
    }
    const ariaLinks = card.querySelectorAll('a[aria-label], [id="video-title"][aria-label]');
    for (const link of ariaLinks) {
      const aria = link.getAttribute("aria-label");
      const parsed = parseDurationText(aria);
      if (parsed !== null) {
        return { seconds: parsed, isLive: false };
      }
    }
    return { seconds: null, isLive: false };
  }
  function extractCandidateFromCard(card) {
    const shortLink = card.querySelector('a[href*="/shorts/"]');
    const shortId = shortLink ? extractShortIdFromHref(shortLink.getAttribute("href") ?? "") : null;
    if (shortId) {
      const cachedDuration = resolvedShortDurations.get(shortId) ?? null;
      return {
        shortId,
        candidate: {
          id: shortId,
          kind: "short",
          durationSeconds: cachedDuration
        }
      };
    }
    const videoLink = card.querySelector('a[href*="/watch?v="]');
    const href = videoLink?.getAttribute("href") ?? "";
    const idMatch = href.match(/[?&]v=([a-zA-Z0-9_-]{6,})/);
    const videoId = idMatch?.[1] ?? card.getAttribute("data-ytb-id") ?? "unknown";
    const { seconds, isLive } = findVideoDurationSeconds(card);
    if (isLive) {
      return {
        shortId: null,
        candidate: { id: videoId, kind: "livestream", durationSeconds: null }
      };
    }
    return {
      shortId: null,
      candidate: {
        id: videoId,
        kind: "video",
        durationSeconds: seconds
      }
    };
  }
  function renderShortDurationBadge(card, durationSeconds) {
    if (!persistedState.policy.showShortDurationBadges) return;
    const thumb = card.querySelector(
      'a[href*="/shorts/"], ytd-thumbnail, .shortsLockupViewModelHostThumbnailContainer'
    ) ?? card;
    let badge = thumb.querySelector(".yt-timefit-short-duration");
    if (!badge) {
      if (getComputedStyle(thumb).position === "static") {
        thumb.style.position = "relative";
      }
      badge = document.createElement("span");
      badge.className = "yt-timefit-short-duration";
      thumb.appendChild(badge);
    }
    badge.textContent = formatDurationBadge(durationSeconds);
  }
  function ensureShortObserver() {
    if (shortObserver) return shortObserver;
    shortObserver = new IntersectionObserver(
      (entries) => {
        for (const entry of entries) {
          if (!entry.isIntersecting) continue;
          const card = entry.target;
          const shortId = card.getAttribute("data-ytb-short-id");
          if (!shortId) continue;
          shortObserver?.unobserve(card);
          if (resolvedShortDurations.has(shortId)) {
            renderShortDurationBadge(card, resolvedShortDurations.get(shortId));
            continue;
          }
          if (pendingShortIds.has(shortId)) continue;
          pendingShortIds.add(shortId);
          webext.runtime.sendMessage({
            type: "FETCH_SHORT_DURATION",
            videoId: shortId
          }).then((res) => {
            pendingShortIds.delete(shortId);
            if (res && typeof res.durationSeconds === "number") {
              resolvedShortDurations.set(shortId, res.durationSeconds);
              renderShortDurationBadge(card, res.durationSeconds);
              runFullSweep();
            }
          }).catch(() => {
            pendingShortIds.delete(shortId);
          });
        }
      },
      { rootMargin: "200px" }
    );
    return shortObserver;
  }
  function restoreAllCards() {
    const cards = document.querySelectorAll("[data-ytb-filtered]");
    for (const card of cards) {
      card.removeAttribute("data-ytb-filtered");
    }
    const banner = document.getElementById("yt-timefit-finish-banner");
    if (banner) banner.remove();
  }
  function nudgeInfiniteScrollIfSparse(visibleRegularVideos) {
    if (isWatchPage() || isShortsPage()) return;
    if (visibleRegularVideos >= 6) {
      consecutiveScrollNudges = 0;
      return;
    }
    const now = Date.now();
    if (consecutiveScrollNudges >= 5 || now - lastScrollNudgeMs < 2500) {
      return;
    }
    const continuation = document.querySelector("ytd-continuation-item-renderer");
    if (!continuation) return;
    lastScrollNudgeMs = now;
    consecutiveScrollNudges += 1;
    window.dispatchEvent(new Event("scroll"));
  }
  function updateFinishLineBanner(snapshot, visibleSidebarCount) {
    const existing = document.getElementById("yt-timefit-finish-banner");
    const isUnder30s = isWatchPage() && snapshot.status === "active" && snapshot.remainingMs !== null && snapshot.remainingMs > 0 && snapshot.remainingMs <= 3e4;
    const isEmptyFinishLine = isWatchPage() && snapshot.status === "active" && snapshot.remainingMs !== null && snapshot.remainingMs > 3e4 && snapshot.remainingMs <= 12e4 && visibleSidebarCount === 0;
    if (!isUnder30s && !isEmptyFinishLine) {
      if (existing) existing.remove();
      return;
    }
    const sidebar = document.querySelector("#secondary-inner, #related #items");
    if (!sidebar) return;
    const banner = existing ?? document.createElement("div");
    banner.id = "yt-timefit-finish-banner";
    banner.className = "yt-timefit-finish-banner";
    if (isUnder30s) {
      banner.innerHTML = "<strong>Recommendations paused</strong><span>Less than 30 seconds left on your TimeTube timer, so new videos are hidden while you wrap up.</span>";
    } else {
      const endLabel = snapshot.endsAtMs ? new Date(snapshot.endsAtMs).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" }) : "soon";
      banner.innerHTML = `<strong>Time's almost up</strong><span>No sidebar videos fit your remaining break. Your timer ends at ${endLabel}.</span>`;
    }
    if (!existing) {
      sidebar.prepend(banner);
    }
  }
  function convertCurrentShortToStandardPlayer(preserveTime = true) {
    const shortId = extractShortIdFromHref(window.location.pathname);
    if (!shortId) return;
    const video = preserveTime ? getActivePlayerVideo() : null;
    const currentTime = video && Number.isFinite(video.currentTime) ? video.currentTime : 0;
    const targetUrl = buildStandardWatchUrl(shortId, currentTime, window.location.origin);
    if (window.location.href !== targetUrl) {
      window.location.replace(targetUrl);
    }
  }
  function evaluateShortsPageEscalation(snapshot) {
    if (snoozedUntilReloadOrPopup || !isShortsPage()) return;
    const shortId = extractShortIdFromHref(window.location.pathname);
    if (!shortId) return;
    if (snapshot.policy.shortsMode === "redirectToWatch" || snapshot.shortsLockedForSession) {
      convertCurrentShortToStandardPlayer();
      return;
    }
    if (snapshot.status !== "active") return;
    if (snapshot.shortsStage === "locked_to_watch") {
      persistedState = { ...persistedState, shortsLockedForSession: true };
      webext.runtime.sendMessage({ type: "LOCK_SHORTS_FOR_SESSION" }).catch(() => void 0);
      convertCurrentShortToStandardPlayer();
      return;
    }
    if (snapshot.shortsStage === "nudge_25" && !snapshot.acknowledgedPrompts.nudge_25) {
      pauseActiveVideo(true);
      showModal(
        "shorts_nudge_25",
        "Only a quarter of your break is left",
        "You are still in Shorts with 25% of your time remaining. Switch to the standard player now so you do not lose track of time?",
        [
          {
            label: "Switch to Standard Player",
            variant: "primary",
            onClick: () => {
              removeModal();
              convertCurrentShortToStandardPlayer();
            }
          },
          {
            label: "Keep Watching Shorts",
            variant: "secondary",
            onClick: async () => {
              removeModal();
              persistedState = await webext.runtime.sendMessage({
                type: "ACK_SHORTS_PROMPT",
                stage: "nudge_25"
              });
              resumeVideo(getActivePlayerVideo());
            }
          }
        ]
      );
      return;
    }
    if (snapshot.shortsStage === "nudge_50" && !snapshot.acknowledgedPrompts.nudge_50) {
      pauseActiveVideo(true);
      showModal(
        "shorts_nudge_50",
        "Half of your break is gone",
        "You have spent half your break time. Want to switch this Short into the standard player so you can pick a video that fits your remaining time?",
        [
          {
            label: "Switch to Standard Player",
            variant: "primary",
            onClick: () => {
              removeModal();
              convertCurrentShortToStandardPlayer();
            }
          },
          {
            label: "Keep Watching Shorts",
            variant: "secondary",
            onClick: async () => {
              removeModal();
              persistedState = await webext.runtime.sendMessage({
                type: "ACK_SHORTS_PROMPT",
                stage: "nudge_50"
              });
              resumeVideo(getActivePlayerVideo());
            }
          }
        ]
      );
    }
  }
  function maybeShowLastExpiredNotice() {
    if (snoozedUntilReloadOrPopup || expiredScreenRendered) return;
    if (activeModalId !== null) return;
    if (persistedState.status !== "idle" || !persistedState.lastExpiredNotice) return;
    const { endedAtMs, lastSpec } = persistedState.lastExpiredNotice;
    const endedLabel = new Date(endedAtMs).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });
    const summary = lastSpec.mode === "countdown" ? `Your ${lastSpec.durationMinutes} min timer ended at ${endedLabel}.` : `Your last YouTube break ended at ${endedLabel}.`;
    const actions = [];
    if (lastSpec.mode === "countdown") {
      actions.push({
        label: `Start ${lastSpec.durationMinutes} min again`,
        variant: "primary",
        onClick: async () => {
          removeModal();
          const result = await webext.runtime.sendMessage({
            type: "START_SCHEDULED_SESSION",
            spec: lastSpec
          }).catch(() => null);
          if (result?.kind === "start") {
            persistedState = result.state;
            runFullSweep();
          } else {
            showModal(
              "repeat_schedule_conflict",
              "Session could not start",
              result?.kind === "conflict" ? "Open the TimeTube toolbar popup to shorten the session or add extra time." : "Open the TimeTube toolbar popup to check your schedule and try again.",
              [{ label: "Close", variant: "secondary", onClick: removeModal }]
            );
          }
        }
      });
    }
    actions.push({
      label: "Set a new timer",
      variant: lastSpec.mode === "countdown" ? "secondary" : "primary",
      onClick: async () => {
        removeModal();
        persistedState = await webext.runtime.sendMessage({
          type: "DISMISS_EXPIRED_NOTICE"
        });
        openTopbarPopover();
      }
    });
    actions.push({
      label: "Browse without timer",
      variant: "ghost",
      onClick: async () => {
        removeModal();
        persistedState = await webext.runtime.sendMessage({
          type: "DISMISS_EXPIRED_NOTICE"
        });
      }
    });
    showModal("last_expired_notice", "Your last break ended", summary, actions);
  }
  function runFullSweep() {
    scheduleBlocked = scheduleRestrictsAccess();
    const snapshot = getCurrentSnapshot();
    if (expiredScreenRendered && snapshot.status !== "expired") {
      window.location.reload();
      return;
    }
    if (snapshot.status === "expired" && (scheduleBlocked || !snoozedUntilReloadOrPopup)) {
      renderExpiredTakeover();
      return;
    }
    scheduleExactExpiryTrigger(snapshot);
    syncShortsNavVisibility();
    syncTopbarControl(
      persistedState,
      (next) => {
        persistedState = next;
        snoozedUntilReloadOrPopup = false;
        runFullSweep();
      },
      () => {
        snoozedUntilReloadOrPopup = false;
      }
    );
    if (snoozedUntilReloadOrPopup) {
      restoreAllCards();
      clearEarlyCutoffBar();
      return;
    }
    if (!persistedState.policy.showShortDurationBadges) {
      document.querySelectorAll(".yt-timefit-short-duration").forEach((el) => el.remove());
    }
    const hideEndscreen = snapshot.status === "active" && snapshot.remainingMs !== null && snapshot.remainingMs > 0 && snapshot.remainingMs <= 3e4;
    if (hideEndscreen) {
      document.documentElement.setAttribute("data-ytb-hide-endscreen", "true");
    } else {
      document.documentElement.removeAttribute("data-ytb-hide-endscreen");
    }
    evaluateShortsPageEscalation(snapshot);
    if (snapshot.status !== "active" && snapshot.status !== "paused") {
      restoreAllCards();
      clearEarlyCutoffBar();
      maybeShowLastExpiredNotice();
      return;
    }
    if (isWatchPage() || isShortsPage()) {
      const video = getActivePlayerVideo();
      updateEarlyCutoffBar(video, snapshot);
    } else {
      clearEarlyCutoffBar();
    }
    const cards = document.querySelectorAll(VIDEO_CARD_SELECTORS);
    const observer = ensureShortObserver();
    let visibleSidebarCount = 0;
    let visibleRegularCount = 0;
    for (const card of cards) {
      if (card.parentElement?.closest(VIDEO_CARD_SELECTORS)) {
        continue;
      }
      const { candidate, shortId } = extractCandidateFromCard(card);
      if (shortId) {
        card.setAttribute("data-ytb-short-id", shortId);
        const cached = resolvedShortDurations.get(shortId);
        if (cached !== void 0) {
          renderShortDurationBadge(card, cached);
        } else {
          observer.observe(card);
        }
      }
      const verdict = evaluateVideoCandidate(candidate, snapshot);
      if (verdict === "allow") {
        card.removeAttribute("data-ytb-filtered");
        if (candidate.kind === "video") {
          visibleRegularCount += 1;
        }
        if (card.closest("#related, #secondary")) {
          visibleSidebarCount += 1;
        }
      } else {
        card.setAttribute("data-ytb-filtered", verdict);
      }
    }
    updateFinishLineBanner(snapshot, visibleSidebarCount);
    nudgeInfiniteScrollIfSparse(visibleRegularCount);
  }
  function attachShortClickInterceptor() {
    document.addEventListener(
      "click",
      (event) => {
        if (snoozedUntilReloadOrPopup || expiredScreenRendered) return;
        const snapshot = getCurrentSnapshot();
        const shouldForceStandard = snapshot.policy.shortsMode === "redirectToWatch" || snapshot.shortsLockedForSession;
        if (!shouldForceStandard) return;
        const target = event.target;
        const anchor = target?.closest('a[href*="/shorts/"]');
        if (!anchor) return;
        const shortId = extractShortIdFromHref(anchor.getAttribute("href") ?? "");
        if (!shortId) return;
        event.preventDefault();
        event.stopPropagation();
        event.stopImmediatePropagation();
        window.location.assign(buildStandardWatchUrl(shortId, 0, window.location.origin));
      },
      true
    );
  }
  function scheduleDebouncedSweep() {
    if (expiredScreenRendered) return;
    if (mutationDebounceTimer !== null) return;
    mutationDebounceTimer = window.setTimeout(() => {
      mutationDebounceTimer = null;
      runFullSweep();
    }, 250);
  }
  async function mountYouTubeFilterHost() {
    try {
      persistedState = await webext.runtime.sendMessage({ type: "GET_STATE" });
    } catch {
      persistedState = { ...INITIAL_PERSISTED_STATE };
    }
    const storedSchedule = await webext.storage.local.get(SCHEDULE_KEY).catch(() => ({}));
    schedule = storedSchedule[SCHEDULE_KEY] ?? EMPTY_SCHEDULE;
    attachModalInputBlocker();
    attachShortClickInterceptor();
    attachDocumentMediaListeners();
    runFullSweep();
    const maybeRedirectShortImmediately = () => {
      if (snoozedUntilReloadOrPopup || expiredScreenRendered || !isShortsPage()) return;
      const snap = getCurrentSnapshot();
      if (snap.policy.shortsMode === "redirectToWatch" || snap.shortsLockedForSession) {
        convertCurrentShortToStandardPlayer(false);
      }
    };
    window.addEventListener("yt-navigate-start", () => {
      window.setTimeout(maybeRedirectShortImmediately, 0);
    });
    window.addEventListener("popstate", () => {
      window.setTimeout(maybeRedirectShortImmediately, 0);
    });
    window.addEventListener("yt-navigate-finish", async () => {
      consecutiveScrollNudges = 0;
      lastDirectCheckedVideoId = null;
      maybeRedirectShortImmediately();
      if (timerPausedByVideo || persistedState.status === "paused") {
        timerPausedByVideo = false;
        persistedState = await webext.runtime.sendMessage({ type: "RESUME_TIMER" }).catch(() => persistedState);
      }
      window.setTimeout(() => {
        checkAutoplayWhilePlaying();
        runFullSweep();
      }, 350);
    });
    mutationObserver = new MutationObserver(() => {
      scheduleDebouncedSweep();
    });
    mutationObserver.observe(document.documentElement, {
      childList: true,
      subtree: true
    });
    sweepTimer = window.setInterval(() => {
      if (document.hidden && !expiredScreenRendered) return;
      checkAutoplayWhilePlaying();
      runFullSweep();
    }, SWEEP_INTERVAL_MS);
    topbarTickInterval = window.setInterval(() => {
      if (document.hidden || expiredScreenRendered) return;
      tickTopbarUI(persistedState);
      const snap = getCurrentSnapshot();
      if (snap.status === "active" && snap.remainingMs !== null && snap.remainingMs > 0) {
        if (snap.remainingMs <= 3e4) {
          document.documentElement.setAttribute("data-ytb-hide-endscreen", "true");
          updateFinishLineBanner(snap, 0);
        }
        if (snap.remainingMs <= 6e4) {
          webext.runtime.sendMessage({ type: "SYNC_BADGE" }).catch(() => void 0);
        }
      }
    }, 1e3);
    webext.storage.onChanged.addListener((changes, area) => {
      if (area !== "local") return;
      if (changes[SCHEDULE_KEY]) {
        const wasEnabled = schedule.enabled;
        schedule = changes[SCHEDULE_KEY].newValue ?? EMPTY_SCHEDULE;
        if (schedule.enabled && !wasEnabled) publishScheduleSample();
        if (scheduleRestrictsAccess() !== scheduleBlocked) runFullSweep();
      }
      if (changes[STATE_KEY]?.newValue) {
        persistedState = changes[STATE_KEY].newValue;
        runFullSweep();
      }
    });
    const refreshSchedule = () => {
      if (scheduleRestrictsAccess() !== scheduleBlocked) runFullSweep();
      publishScheduleSample();
    };
    refreshSchedule();
    scheduleHeartbeat = window.setInterval(refreshSchedule, 1e3);
    document.addEventListener("visibilitychange", refreshSchedule);
    document.addEventListener("timeupdate", (event) => {
      if (event.target === getActivePlayerVideo() && Date.now() - lastScheduleSampleAt >= 1e3) {
        refreshSchedule();
      }
    }, true);
    for (const event of ["playing", "pause", "waiting", "seeking", "seeked", "ended"]) {
      document.addEventListener(event, (event2) => {
        if (event2.target instanceof HTMLVideoElement) publishScheduleSample();
      }, true);
    }
    webext.runtime.onMessage.addListener((msg) => {
      if (msg && typeof msg === "object" && msg.type === "WAKE_FROM_POPUP") {
        snoozedUntilReloadOrPopup = false;
        checkAutoplayWhilePlaying();
        runFullSweep();
      }
    });
    window.addEventListener("pageshow", (event) => {
      if (event.persisted) refreshSchedule();
    });
    window.addEventListener("pagehide", (event) => {
      publishScheduleSample();
      if (event.persisted) return;
      if (scheduleHeartbeat !== null) window.clearInterval(scheduleHeartbeat);
      if (sweepTimer !== null) window.clearInterval(sweepTimer);
      if (topbarTickInterval !== null) window.clearInterval(topbarTickInterval);
      if (exactExpiryTimer !== null) window.clearTimeout(exactExpiryTimer);
      if (pausePromptTimer !== null) window.clearTimeout(pausePromptTimer);
      if (seekOverrunTimer !== null) window.clearTimeout(seekOverrunTimer);
      if (modalTimerInterval !== null) window.clearInterval(modalTimerInterval);
      mutationObserver?.disconnect();
      shortObserver?.disconnect();
    });
  }
  mountYouTubeFilterHost();
})();
//# sourceMappingURL=content.js.map
