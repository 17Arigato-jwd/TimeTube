"use strict";
(() => {
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
    const hoursMatch = cleaned.match(/(\d+)\s+hours?(?!\s+ago\b)/i);
    const minsMatch = cleaned.match(/(\d+)\s+minutes?(?!\s+ago\b)/i);
    const secsMatch = cleaned.match(/(\d+)\s+seconds?(?!\s+ago\b)/i);
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
  function extractShortIdFromHref(href) {
    const match = href.match(/\/shorts\/([a-zA-Z0-9_-]{6,})/);
    return match?.[1] ?? null;
  }

  // src/core/policy.ts
  function computeRemainingMs(state, nowMs) {
    if (state.status !== "active" || !state.spec || state.spec.mode === "maxLength") {
      return null;
    }
    if (state.endsAtMs === null) return null;
    return Math.max(0, state.endsAtMs - nowMs);
  }
  function computeMaxAllowedSeconds(state, nowMs) {
    if (state.status !== "active" || !state.spec) return null;
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
  function evaluateVideoCandidate(candidate, snapshot) {
    if (snapshot.status !== "active" || snapshot.maxAllowedVideoSeconds === null) {
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
    } else if (state.autoplayOnboarding === "unseen") {
      derivedStatus = "needs_autoplay_setup";
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
      maxAllowedVideoSeconds: derivedStatus === "active" ? computeMaxAllowedSeconds(effectiveState, nowMs) : null,
      autoplayOnboarding: effectiveState.autoplayOnboarding,
      autoplayObserved: autoplayObserved2,
      shortsStage: computeShortsStage(effectiveState, nowMs),
      shortsLockedForSession: effectiveState.shortsLockedForSession,
      acknowledgedPrompts: { ...effectiveState.acknowledgedPrompts },
      policy: { ...effectiveState.policy }
    };
  }
  function buildStandardWatchUrl(videoId, currentTimeSeconds) {
    const base = `https://www.youtube.com/watch?v=${encodeURIComponent(videoId)}`;
    if (currentTimeSeconds && currentTimeSeconds >= 1) {
      return `${base}&t=${Math.floor(currentTimeSeconds)}s`;
    }
    return base;
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
  var expiredScreenRendered = false;
  var resolvedShortDurations = /* @__PURE__ */ new Map();
  var pendingShortIds = /* @__PURE__ */ new Set();
  var shortObserver = null;
  var mutationObserver = null;
  var sweepTimer = null;
  var exactExpiryTimer = null;
  var mutationDebounceTimer = null;
  var lastScrollNudgeMs = 0;
  var consecutiveScrollNudges = 0;
  function getCurrentSnapshot() {
    return buildSessionSnapshot(persistedState, Date.now(), {
      snoozed: snoozedUntilReloadOrPopup,
      autoplayObserved
    });
  }
  function isWatchPage() {
    return window.location.pathname === "/watch";
  }
  function isShortsPage() {
    return window.location.pathname.startsWith("/shorts/");
  }
  function readAutoplayToggleState() {
    const toggleBtn = document.querySelector(
      'button[data-tooltip-target-id="ytp-autonav-toggle-button"], .ytp-autonav-toggle-button'
    );
    if (!toggleBtn) return "unknown";
    const checked = toggleBtn.getAttribute("aria-checked") ?? toggleBtn.querySelector("[aria-checked]")?.getAttribute("aria-checked");
    if (checked === "true") return "enabled";
    if (checked === "false") return "disabled";
    return "unknown";
  }
  function pauseActiveVideo() {
    const videos = document.querySelectorAll("video");
    for (const video of videos) {
      if (!video.paused) {
        video.pause();
      }
    }
  }
  function removeModal() {
    const existing = document.getElementById("yt-timefit-modal-root");
    if (existing) existing.remove();
    activeModalId = null;
  }
  function showModal(id, title, body, actions) {
    if (activeModalId === id && document.getElementById("yt-timefit-modal-root")) {
      return;
    }
    removeModal();
    activeModalId = id;
    const root = document.createElement("div");
    root.id = "yt-timefit-modal-root";
    root.className = "yt-timefit-backdrop";
    const card = document.createElement("div");
    card.className = "yt-timefit-modal";
    const heading = document.createElement("h2");
    heading.textContent = title;
    const text = document.createElement("p");
    text.textContent = body;
    const btnRow = document.createElement("div");
    btnRow.className = "yt-timefit-actions";
    for (const act of actions) {
      const btn = document.createElement("button");
      btn.type = "button";
      btn.textContent = act.label;
      btn.className = `yt-timefit-btn yt-timefit-btn-${act.variant}`;
      btn.addEventListener("click", act.onClick);
      btnRow.appendChild(btn);
    }
    card.appendChild(heading);
    card.appendChild(text);
    card.appendChild(btnRow);
    root.appendChild(card);
    document.documentElement.appendChild(root);
  }
  function renderExpiredTakeover() {
    pauseActiveVideo();
    removeModal();
    mutationObserver?.disconnect();
    shortObserver?.disconnect();
    if (window.location.pathname !== "/" || window.location.search || window.location.hash) {
      try {
        window.history.replaceState(null, "", "/");
      } catch {
      }
    }
    document.title = "Time's up \u2014 TimeFit";
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
    message.textContent = "Your YouTube break has ended. You can start a new session or stop the timer from the TimeFit extension menu whenever you are ready.";
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
  function showAutoplaySetupPrompt(reason) {
    const title = reason === "detected_enabled" ? "Autoplay is still turned on" : "Disable YouTube Autoplay to get started";
    const body = reason === "detected_enabled" ? "We paused your video because YouTube Autoplay is enabled. Turn Autoplay off in the video player bar so your break timer can keep you from rolling into another video." : "TimeFit needs YouTube Autoplay turned off so videos do not keep playing past your break. You can switch Autoplay off directly on any video player bar.";
    showModal(`autoplay_${reason}`, title, body, [
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
        label: "I've already done it",
        variant: "secondary",
        onClick: async () => {
          removeModal();
          persistedState = await webext.runtime.sendMessage({
            type: "SET_AUTOPLAY_ONBOARDING",
            state: "claimed_disabled"
          });
          checkAutoplayOnWatchPage();
          runFullSweep();
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
    ]);
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
  function checkAutoplayOnWatchPage() {
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
          runFullSweep();
        }).catch(() => void 0);
      }
      if (activeModalId?.startsWith("autoplay_")) {
        removeModal();
      }
      return;
    }
    if (observed === "enabled" && !autoplayGuideActive) {
      if (persistedState.autoplayOnboarding === "claimed_disabled" || persistedState.autoplayOnboarding === "verified_disabled") {
        pauseActiveVideo();
        showAutoplaySetupPrompt("detected_enabled");
      } else if (persistedState.autoplayOnboarding === "unseen") {
        pauseActiveVideo();
        showAutoplaySetupPrompt("initial");
      }
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
    const shouldShow = isWatchPage() && snapshot.status === "active" && snapshot.remainingMs !== null && snapshot.remainingMs > 0 && snapshot.remainingMs <= 12e4 && visibleSidebarCount === 0;
    if (!shouldShow) {
      if (existing) existing.remove();
      return;
    }
    if (existing) return;
    const sidebar = document.querySelector("#related #items, #secondary-inner");
    if (!sidebar) return;
    const banner = document.createElement("div");
    banner.id = "yt-timefit-finish-banner";
    banner.className = "yt-timefit-finish-banner";
    const endLabel = snapshot.endsAtMs ? new Date(snapshot.endsAtMs).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" }) : "soon";
    banner.textContent = `Time's almost up \u2014 wrap up this video. Your break ends at ${endLabel}.`;
    sidebar.prepend(banner);
  }
  function convertCurrentShortToStandardPlayer() {
    const shortId = extractShortIdFromHref(window.location.pathname);
    if (!shortId) return;
    const video = document.querySelector("video");
    const currentTime = video?.currentTime ?? 0;
    window.location.replace(buildStandardWatchUrl(shortId, currentTime));
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
      pauseActiveVideo();
      webext.runtime.sendMessage({ type: "LOCK_SHORTS_FOR_SESSION" }).catch(() => void 0);
      persistedState = { ...persistedState, shortsLockedForSession: true };
      showModal(
        "shorts_lock",
        `Less than ${snapshot.policy.shortsLockCutoffMinutes} minutes left in your break`,
        "Switching this video to the standard YouTube player now. Shorts are locked for the rest of your break so you can finish cleanly.",
        [
          {
            label: "Switch to Standard Player",
            variant: "primary",
            onClick: () => {
              removeModal();
              convertCurrentShortToStandardPlayer();
            }
          }
        ]
      );
      return;
    }
    if (snapshot.shortsStage === "nudge_25" && !snapshot.acknowledgedPrompts.nudge_25) {
      pauseActiveVideo();
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
            }
          }
        ]
      );
      return;
    }
    if (snapshot.shortsStage === "nudge_50" && !snapshot.acknowledgedPrompts.nudge_50) {
      pauseActiveVideo();
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
            }
          }
        ]
      );
    }
  }
  function runFullSweep() {
    const snapshot = getCurrentSnapshot();
    if (expiredScreenRendered && snapshot.status !== "expired") {
      window.location.reload();
      return;
    }
    if (!snoozedUntilReloadOrPopup && snapshot.status === "expired") {
      renderExpiredTakeover();
      return;
    }
    scheduleExactExpiryTrigger(snapshot);
    syncShortsNavVisibility();
    if (snoozedUntilReloadOrPopup) {
      restoreAllCards();
      return;
    }
    if (snapshot.status === "needs_autoplay_setup" && persistedState.autoplayOnboarding === "unseen") {
      showAutoplaySetupPrompt("initial");
      return;
    }
    evaluateShortsPageEscalation(snapshot);
    if (snapshot.status !== "active") {
      restoreAllCards();
      return;
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
        window.location.assign(buildStandardWatchUrl(shortId));
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
    attachShortClickInterceptor();
    checkAutoplayOnWatchPage();
    runFullSweep();
    window.addEventListener("yt-navigate-finish", () => {
      consecutiveScrollNudges = 0;
      window.setTimeout(() => {
        checkAutoplayOnWatchPage();
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
      checkAutoplayOnWatchPage();
      runFullSweep();
    }, SWEEP_INTERVAL_MS);
    webext.storage.onChanged.addListener((changes, area) => {
      if (area !== "local" || !changes[STATE_KEY]?.newValue) return;
      persistedState = changes[STATE_KEY].newValue;
      runFullSweep();
    });
    webext.runtime.onMessage.addListener((msg) => {
      if (msg && typeof msg === "object" && msg.type === "WAKE_FROM_POPUP") {
        snoozedUntilReloadOrPopup = false;
        checkAutoplayOnWatchPage();
        runFullSweep();
      }
    });
    window.addEventListener("pagehide", () => {
      if (sweepTimer !== null) window.clearInterval(sweepTimer);
      if (exactExpiryTimer !== null) window.clearTimeout(exactExpiryTimer);
      mutationObserver?.disconnect();
      shortObserver?.disconnect();
    });
  }
  mountYouTubeFilterHost();
})();
//# sourceMappingURL=content.js.map
