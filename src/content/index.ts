import {
  extractShortIdFromHref,
  formatDurationBadge,
  parseDurationText,
} from '../core/duration';
import {
  buildSessionSnapshot,
  buildStandardWatchUrl,
  evaluateVideoCandidate,
} from '../core/policy';
import {
  AutoplayObservedState,
  INITIAL_PERSISTED_STATE,
  PersistedSessionState,
  SessionSnapshot,
  VideoCandidate,
} from '../core/types';
import { webext } from '../shared/webext';

const STATE_KEY = 'ytTimeFitSessionState';
const AUTOPLAY_HELP_URL = 'https://support.google.com/youtube/answer/6327615';
const SWEEP_INTERVAL_MS = 4_000;

const VIDEO_CARD_SELECTORS = [
  'ytd-rich-item-renderer',
  'ytd-video-renderer',
  'ytd-compact-video-renderer',
  'ytd-grid-video-renderer',
  'yt-lockup-view-model',
  'ytm-shorts-lockup-view-model',
  'ytm-shorts-lockup-view-model-v2',
  'ytd-reel-item-renderer',
  'ytm-video-with-context-renderer',
  'ytm-compact-video-renderer',
].join(', ');

const SHORTS_NAV_SELECTORS = [
  'ytd-guide-entry-renderer a[title="Shorts"]',
  'ytd-mini-guide-entry-renderer a[title="Shorts"]',
  'ytm-pivot-bar-item-renderer .pivot-shorts',
];

let persistedState: PersistedSessionState = { ...INITIAL_PERSISTED_STATE };
let snoozedUntilReloadOrPopup = false;
let autoplayObserved: AutoplayObservedState = 'unknown';
let autoplayGuideActive = false;
let activeModalId: string | null = null;

const resolvedShortDurations = new Map<string, number>();
const pendingShortIds = new Set<string>();
let shortObserver: IntersectionObserver | null = null;
let mutationObserver: MutationObserver | null = null;
let sweepTimer: number | null = null;
let mutationDebounceTimer: number | null = null;

function getCurrentSnapshot(): SessionSnapshot {
  return buildSessionSnapshot(persistedState, Date.now(), {
    snoozed: snoozedUntilReloadOrPopup,
    autoplayObserved,
  });
}

function isWatchPage(): boolean {
  return window.location.pathname === '/watch';
}

function isShortsPage(): boolean {
  return window.location.pathname.startsWith('/shorts/');
}

function readAutoplayToggleState(): AutoplayObservedState {
  const toggleBtn = document.querySelector<HTMLElement>(
    'button[data-tooltip-target-id="ytp-autonav-toggle-button"], .ytp-autonav-toggle-button',
  );
  if (!toggleBtn) return 'unknown';

  const checked =
    toggleBtn.getAttribute('aria-checked') ??
    toggleBtn.querySelector<HTMLElement>('[aria-checked]')?.getAttribute('aria-checked');

  if (checked === 'true') return 'enabled';
  if (checked === 'false') return 'disabled';
  return 'unknown';
}

function pauseActiveVideo(): void {
  const video = document.querySelector<HTMLVideoElement>('video.html5-main-video, video');
  if (video && !video.paused) {
    video.pause();
  }
}

function removeModal(): void {
  const existing = document.getElementById('yt-timefit-modal-root');
  if (existing) existing.remove();
  activeModalId = null;
}

function showModal(
  id: string,
  title: string,
  body: string,
  actions: Array<{ label: string; variant: 'primary' | 'secondary' | 'ghost'; onClick: () => void }>,
): void {
  if (activeModalId === id && document.getElementById('yt-timefit-modal-root')) {
    return;
  }
  removeModal();
  activeModalId = id;

  const root = document.createElement('div');
  root.id = 'yt-timefit-modal-root';
  root.className = 'yt-timefit-backdrop';

  const card = document.createElement('div');
  card.className = 'yt-timefit-modal';

  const heading = document.createElement('h2');
  heading.textContent = title;

  const text = document.createElement('p');
  text.textContent = body;

  const btnRow = document.createElement('div');
  btnRow.className = 'yt-timefit-actions';

  for (const act of actions) {
    const btn = document.createElement('button');
    btn.type = 'button';
    btn.textContent = act.label;
    btn.className = `yt-timefit-btn yt-timefit-btn-${act.variant}`;
    btn.addEventListener('click', act.onClick);
    btnRow.appendChild(btn);
  }

  card.appendChild(heading);
  card.appendChild(text);
  card.appendChild(btnRow);
  root.appendChild(card);
  document.documentElement.appendChild(root);
}

function showAutoplaySetupPrompt(reason: 'initial' | 'detected_enabled'): void {
  const title =
    reason === 'detected_enabled'
      ? 'Autoplay is still turned on'
      : 'Disable YouTube Autoplay to get started';

  const body =
    reason === 'detected_enabled'
      ? 'We paused your video because YouTube Autoplay is enabled. Turn Autoplay off in the video player bar so your break timer can keep you from rolling into another video.'
      : 'TimeFit needs YouTube Autoplay turned off so videos do not keep playing past your break. You can switch Autoplay off directly on any video player bar.';

  showModal(`autoplay_${reason}`, title, body, [
    {
      label: isWatchPage() ? 'Highlight Autoplay toggle' : 'How to disable Autoplay',
      variant: 'primary',
      onClick: () => {
        removeModal();
        if (isWatchPage()) {
          autoplayGuideActive = true;
          highlightAutoplayToggle();
        } else {
          window.open(AUTOPLAY_HELP_URL, '_blank', 'noopener');
        }
      },
    },
    {
      label: "I've already done it",
      variant: 'secondary',
      onClick: async () => {
        removeModal();
        persistedState = await webext.runtime.sendMessage<PersistedSessionState>({
          type: 'SET_AUTOPLAY_ONBOARDING',
          state: 'claimed_disabled',
        });
        checkAutoplayOnWatchPage();
        runFullSweep();
      },
    },
    {
      label: 'Not now',
      variant: 'ghost',
      onClick: () => {
        removeModal();
        snoozedUntilReloadOrPopup = true;
        restoreAllCards();
        syncShortsNavVisibility();
      },
    },
  ]);
}

function highlightAutoplayToggle(): void {
  const toggleBtn = document.querySelector<HTMLElement>(
    'button[data-tooltip-target-id="ytp-autonav-toggle-button"], .ytp-autonav-toggle-button',
  );
  if (!toggleBtn) return;
  toggleBtn.scrollIntoView({ behavior: 'smooth', block: 'center' });
  toggleBtn.classList.add('yt-timefit-autoplay-highlight');
  window.setTimeout(() => {
    toggleBtn.classList.remove('yt-timefit-autoplay-highlight');
  }, 6_000);
}

function checkAutoplayOnWatchPage(): void {
  if (snoozedUntilReloadOrPopup) return;
  if (!isWatchPage()) {
    autoplayObserved = 'unknown';
    return;
  }

  const observed = readAutoplayToggleState();
  autoplayObserved = observed;

  if (observed === 'disabled') {
    autoplayGuideActive = false;
    if (persistedState.autoplayOnboarding !== 'verified_disabled') {
      webext.runtime
        .sendMessage<PersistedSessionState>({
          type: 'SET_AUTOPLAY_ONBOARDING',
          state: 'verified_disabled',
        })
        .then((next) => {
          persistedState = next;
          runFullSweep();
        })
        .catch(() => undefined);
    }
    if (activeModalId?.startsWith('autoplay_')) {
      removeModal();
    }
    return;
  }

  if (observed === 'enabled' && !autoplayGuideActive) {
    if (persistedState.autoplayOnboarding === 'claimed_disabled' || persistedState.autoplayOnboarding === 'verified_disabled') {
      pauseActiveVideo();
      showAutoplaySetupPrompt('detected_enabled');
    } else if (persistedState.autoplayOnboarding === 'unseen') {
      pauseActiveVideo();
      showAutoplaySetupPrompt('initial');
    }
  }
}

function syncShortsNavVisibility(): void {
  const shouldHideNav = !snoozedUntilReloadOrPopup && persistedState.policy.hideShortsNavButton;
  for (const selector of SHORTS_NAV_SELECTORS) {
    const matches = document.querySelectorAll<HTMLElement>(selector);
    for (const el of matches) {
      const container =
        el.closest<HTMLElement>('ytd-guide-entry-renderer, ytd-mini-guide-entry-renderer, ytm-pivot-bar-item-renderer') ??
        el;
      if (shouldHideNav) {
        container.setAttribute('data-ytb-nav-hidden', 'true');
      } else {
        container.removeAttribute('data-ytb-nav-hidden');
      }
    }
  }
}

function extractCandidateFromCard(card: HTMLElement): { candidate: VideoCandidate; shortId: string | null } {
  const shortLink = card.querySelector<HTMLAnchorElement>('a[href*="/shorts/"]');
  const shortId = shortLink ? extractShortIdFromHref(shortLink.getAttribute('href') ?? '') : null;

  if (shortId) {
    const cachedDuration = resolvedShortDurations.get(shortId) ?? null;
    return {
      shortId,
      candidate: {
        id: shortId,
        kind: 'short',
        durationSeconds: cachedDuration,
      },
    };
  }

  const videoLink = card.querySelector<HTMLAnchorElement>('a[href*="/watch?v="]');
  const href = videoLink?.getAttribute('href') ?? '';
  const idMatch = href.match(/[?&]v=([a-zA-Z0-9_-]{6,})/);
  const videoId = idMatch?.[1] ?? card.getAttribute('data-ytb-id') ?? 'unknown';

  const liveBadge = card.querySelector(
    '.badge-style-type-live-now-alternate, [overlay-style="LIVE"], ytd-badge-supported-renderer[aria-label*="LIVE"]',
  );
  if (liveBadge) {
    return {
      shortId: null,
      candidate: { id: videoId, kind: 'livestream', durationSeconds: null },
    };
  }

  const timeEl = card.querySelector<HTMLElement>(
    'ytd-thumbnail-overlay-time-status-renderer #text, ytd-thumbnail-overlay-time-status-renderer .badge-shape-wiz__text, badge-shape .badge-shape-wiz__text, .yt-badge-shape__text',
  );
  const rawTime = timeEl?.textContent?.trim() ?? timeEl?.getAttribute('aria-label') ?? null;
  if (rawTime && /live/i.test(rawTime)) {
    return {
      shortId: null,
      candidate: { id: videoId, kind: 'livestream', durationSeconds: null },
    };
  }

  const parsedSec = parseDurationText(rawTime);
  return {
    shortId: null,
    candidate: {
      id: videoId,
      kind: 'video',
      durationSeconds: parsedSec,
    },
  };
}

function renderShortDurationBadge(card: HTMLElement, durationSeconds: number): void {
  if (!persistedState.policy.showShortDurationBadges) return;
  const thumb =
    card.querySelector<HTMLElement>('a[href*="/shorts/"], ytd-thumbnail, .shortsLockupViewModelHostThumbnailContainer') ??
    card;

  let badge = thumb.querySelector<HTMLElement>('.yt-timefit-short-duration');
  if (!badge) {
    if (getComputedStyle(thumb).position === 'static') {
      thumb.style.position = 'relative';
    }
    badge = document.createElement('span');
    badge.className = 'yt-timefit-short-duration';
    thumb.appendChild(badge);
  }
  badge.textContent = formatDurationBadge(durationSeconds);
}

function ensureShortObserver(): IntersectionObserver {
  if (shortObserver) return shortObserver;
  shortObserver = new IntersectionObserver(
    (entries) => {
      for (const entry of entries) {
        if (!entry.isIntersecting) continue;
        const card = entry.target as HTMLElement;
        const shortId = card.getAttribute('data-ytb-short-id');
        if (!shortId) continue;
        shortObserver?.unobserve(card);

        if (resolvedShortDurations.has(shortId)) {
          renderShortDurationBadge(card, resolvedShortDurations.get(shortId)!);
          continue;
        }
        if (pendingShortIds.has(shortId)) continue;
        pendingShortIds.add(shortId);

        webext.runtime
          .sendMessage<{ videoId: string; durationSeconds: number | null }>({
            type: 'FETCH_SHORT_DURATION',
            videoId: shortId,
          })
          .then((res) => {
            pendingShortIds.delete(shortId);
            if (res && typeof res.durationSeconds === 'number') {
              resolvedShortDurations.set(shortId, res.durationSeconds);
              renderShortDurationBadge(card, res.durationSeconds);
              runFullSweep();
            }
          })
          .catch(() => {
            pendingShortIds.delete(shortId);
          });
      }
    },
    { rootMargin: '200px' },
  );
  return shortObserver;
}

function restoreAllCards(): void {
  const cards = document.querySelectorAll<HTMLElement>('[data-ytb-filtered]');
  for (const card of cards) {
    card.removeAttribute('data-ytb-filtered');
  }
  const banner = document.getElementById('yt-timefit-finish-banner');
  if (banner) banner.remove();
}

function updateFinishLineBanner(snapshot: SessionSnapshot, visibleSidebarCount: number): void {
  const existing = document.getElementById('yt-timefit-finish-banner');
  const shouldShow =
    isWatchPage() &&
    snapshot.status === 'active' &&
    snapshot.remainingMs !== null &&
    snapshot.remainingMs > 0 &&
    snapshot.remainingMs <= 120_000 &&
    visibleSidebarCount === 0;

  if (!shouldShow) {
    if (existing) existing.remove();
    return;
  }

  if (existing) return;

  const sidebar = document.querySelector<HTMLElement>('#related #items, #secondary-inner');
  if (!sidebar) return;

  const banner = document.createElement('div');
  banner.id = 'yt-timefit-finish-banner';
  banner.className = 'yt-timefit-finish-banner';
  const endLabel = snapshot.endsAtMs
    ? new Date(snapshot.endsAtMs).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })
    : 'soon';
  banner.textContent = `Time's almost up — wrap up this video. Your break ends at ${endLabel}.`;
  sidebar.prepend(banner);
}

function convertCurrentShortToStandardPlayer(): void {
  const shortId = extractShortIdFromHref(window.location.pathname);
  if (!shortId) return;
  const video = document.querySelector<HTMLVideoElement>('video');
  const currentTime = video?.currentTime ?? 0;
  window.location.replace(buildStandardWatchUrl(shortId, currentTime));
}

function evaluateShortsPageEscalation(snapshot: SessionSnapshot): void {
  if (snoozedUntilReloadOrPopup || !isShortsPage()) return;

  const shortId = extractShortIdFromHref(window.location.pathname);
  if (!shortId) return;

  // Toggle ON or already locked for this session -> immediate conversion to standard player
  if (snapshot.policy.shortsMode === 'redirectToWatch' || snapshot.shortsLockedForSession) {
    convertCurrentShortToStandardPlayer();
    return;
  }

  if (snapshot.status !== 'active') return;

  if (snapshot.shortsStage === 'locked_to_watch') {
    pauseActiveVideo();
    webext.runtime.sendMessage({ type: 'LOCK_SHORTS_FOR_SESSION' }).catch(() => undefined);
    persistedState = { ...persistedState, shortsLockedForSession: true };
    showModal(
      'shorts_lock',
      `Less than ${snapshot.policy.shortsLockCutoffMinutes} minutes left in your break`,
      'Switching this video to the standard YouTube player now. Shorts are locked for the rest of your break so you can finish cleanly.',
      [
        {
          label: 'Switch to Standard Player',
          variant: 'primary',
          onClick: () => {
            removeModal();
            convertCurrentShortToStandardPlayer();
          },
        },
      ],
    );
    return;
  }

  if (snapshot.shortsStage === 'nudge_25' && !snapshot.acknowledgedPrompts.nudge_25) {
    pauseActiveVideo();
    showModal(
      'shorts_nudge_25',
      'Only a quarter of your break is left',
      'You are still in Shorts with 25% of your time remaining. Switch to the standard player now so you do not lose track of time?',
      [
        {
          label: 'Switch to Standard Player',
          variant: 'primary',
          onClick: () => {
            removeModal();
            convertCurrentShortToStandardPlayer();
          },
        },
        {
          label: 'Keep Watching Shorts',
          variant: 'secondary',
          onClick: async () => {
            removeModal();
            persistedState = await webext.runtime.sendMessage<PersistedSessionState>({
              type: 'ACK_SHORTS_PROMPT',
              stage: 'nudge_25',
            });
          },
        },
      ],
    );
    return;
  }

  if (snapshot.shortsStage === 'nudge_50' && !snapshot.acknowledgedPrompts.nudge_50) {
    pauseActiveVideo();
    showModal(
      'shorts_nudge_50',
      'Half of your break is gone',
      'You have spent half your break time. Want to switch this Short into the standard player so you can pick a video that fits your remaining time?',
      [
        {
          label: 'Switch to Standard Player',
          variant: 'primary',
          onClick: () => {
            removeModal();
            convertCurrentShortToStandardPlayer();
          },
        },
        {
          label: 'Keep Watching Shorts',
          variant: 'secondary',
          onClick: async () => {
            removeModal();
            persistedState = await webext.runtime.sendMessage<PersistedSessionState>({
              type: 'ACK_SHORTS_PROMPT',
              stage: 'nudge_50',
            });
          },
        },
      ],
    );
  }
}

function runFullSweep(): void {
  syncShortsNavVisibility();

  if (snoozedUntilReloadOrPopup) {
    restoreAllCards();
    return;
  }

  const snapshot = getCurrentSnapshot();

  if (snapshot.status === 'needs_autoplay_setup' && persistedState.autoplayOnboarding === 'unseen') {
    showAutoplaySetupPrompt('initial');
    return;
  }

  evaluateShortsPageEscalation(snapshot);

  if (snapshot.status !== 'active') {
    restoreAllCards();
    return;
  }

  const cards = document.querySelectorAll<HTMLElement>(VIDEO_CARD_SELECTORS);
  const observer = ensureShortObserver();
  let visibleSidebarCount = 0;

  for (const card of cards) {
    const { candidate, shortId } = extractCandidateFromCard(card);
    if (shortId) {
      card.setAttribute('data-ytb-short-id', shortId);
      const cached = resolvedShortDurations.get(shortId);
      if (cached !== undefined) {
        renderShortDurationBadge(card, cached);
      } else {
        observer.observe(card);
      }
    }

    const verdict = evaluateVideoCandidate(candidate, snapshot);
    if (verdict === 'allow') {
      card.removeAttribute('data-ytb-filtered');
      if (card.closest('#related, #secondary')) {
        visibleSidebarCount += 1;
      }
    } else {
      card.setAttribute('data-ytb-filtered', verdict);
    }
  }

  updateFinishLineBanner(snapshot, visibleSidebarCount);
}

function attachShortClickInterceptor(): void {
  document.addEventListener(
    'click',
    (event) => {
      if (snoozedUntilReloadOrPopup) return;
      const snapshot = getCurrentSnapshot();
      const shouldForceStandard =
        snapshot.policy.shortsMode === 'redirectToWatch' || snapshot.shortsLockedForSession;
      if (!shouldForceStandard) return;

      const target = event.target as HTMLElement | null;
      const anchor = target?.closest<HTMLAnchorElement>('a[href*="/shorts/"]');
      if (!anchor) return;

      const shortId = extractShortIdFromHref(anchor.getAttribute('href') ?? '');
      if (!shortId) return;

      event.preventDefault();
      event.stopPropagation();
      window.location.assign(buildStandardWatchUrl(shortId));
    },
    true,
  );
}

function scheduleDebouncedSweep(): void {
  if (mutationDebounceTimer !== null) return;
  mutationDebounceTimer = window.setTimeout(() => {
    mutationDebounceTimer = null;
    runFullSweep();
  }, 250);
}

async function mountYouTubeFilterHost(): Promise<void> {
  try {
    persistedState = await webext.runtime.sendMessage<PersistedSessionState>({ type: 'GET_STATE' });
  } catch {
    persistedState = { ...INITIAL_PERSISTED_STATE };
  }

  attachShortClickInterceptor();
  checkAutoplayOnWatchPage();
  runFullSweep();

  // Re-evaluate on YouTube SPA navigations
  window.addEventListener('yt-navigate-finish', () => {
    window.setTimeout(() => {
      checkAutoplayOnWatchPage();
      runFullSweep();
    }, 350);
  });

  // Catch infinite scroll & dynamic sidebar cards
  mutationObserver = new MutationObserver(() => {
    scheduleDebouncedSweep();
  });
  mutationObserver.observe(document.documentElement, {
    childList: true,
    subtree: true,
  });

  // Active 4-second re-evaluation loop while tab is visible
  sweepTimer = window.setInterval(() => {
    if (document.hidden) return;
    checkAutoplayOnWatchPage();
    runFullSweep();
  }, SWEEP_INTERVAL_MS);

  // React to storage updates from popup or other tabs
  webext.storage.onChanged.addListener((changes, area) => {
    if (area !== 'local' || !changes[STATE_KEY]?.newValue) return;
    persistedState = changes[STATE_KEY].newValue as PersistedSessionState;
    runFullSweep();
  });

  // Wake tab if user opens the extension from the toolbar extensions menu
  webext.runtime.onMessage.addListener((msg) => {
    if (msg && typeof msg === 'object' && (msg as { type?: string }).type === 'WAKE_FROM_POPUP') {
      snoozedUntilReloadOrPopup = false;
      checkAutoplayOnWatchPage();
      runFullSweep();
    }
  });

  window.addEventListener('pagehide', () => {
    if (sweepTimer !== null) window.clearInterval(sweepTimer);
    mutationObserver?.disconnect();
    shortObserver?.disconnect();
  });
}

mountYouTubeFilterHost();
