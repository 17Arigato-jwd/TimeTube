import { formatApproxRemaining } from '../core/duration';
import { computeRemainingMs } from '../core/policy';
import { BudgetSpec, PersistedSessionState } from '../core/types';
import { webext } from '../shared/webext';

let popoverOpen = false;
let selectedMode: BudgetSpec['mode'] = 'countdown';
let lastState: PersistedSessionState | null = null;
let outsideClickBound = false;

function formatClock(ms: number): string {
  const totalSec = Math.max(0, Math.ceil(ms / 1000));
  const mins = Math.floor(totalSec / 60);
  const secs = totalSec % 60;
  return `${mins}:${String(secs).padStart(2, '0')}`;
}

function isDarkTheme(): boolean {
  return document.documentElement.hasAttribute('dark');
}

function getHeaderButtonsContainer(): HTMLElement | null {
  return (
    document.querySelector<HTMLElement>('ytd-masthead #end #buttons') ??
    document.querySelector<HTMLElement>('#masthead-container #end #buttons') ??
    document.querySelector<HTMLElement>('#end #buttons')
  );
}

function findCreateButtonSlot(container: HTMLElement): HTMLElement | null {
  const candidates = Array.from(container.children) as HTMLElement[];
  for (const child of candidates) {
    if (child.id === 'yt-timetube-topbar-wrap') continue;
    const text = child.textContent?.trim().toLowerCase() ?? '';
    const aria = child.querySelector<HTMLElement>('[aria-label]')?.getAttribute('aria-label')?.toLowerCase() ?? '';
    if (text.includes('create') || aria.includes('create')) {
      return child;
    }
  }
  return candidates[0] ?? null;
}

function closePopover(): void {
  popoverOpen = false;
  const pop = document.getElementById('yt-timetube-popover');
  if (pop) pop.classList.add('yt-tt-hidden');
}

function buildPopover(onStateChange: (next: PersistedSessionState) => void): HTMLElement {
  const pop = document.createElement('div');
  pop.id = 'yt-timetube-popover';
  pop.className = 'yt-tt-popover yt-tt-hidden';
  pop.setAttribute('role', 'dialog');
  pop.setAttribute('aria-label', 'TimeTube Controls');

  pop.innerHTML = `
    <div class="yt-tt-pop-header">
      <div class="yt-tt-pop-brand">
        <img class="yt-tt-pop-logo" alt="TimeTube" />
        <strong>TimeTube</strong>
      </div>
      <span id="yt-tt-status-pill" class="yt-tt-pill yt-tt-pill-idle">Idle</span>
    </div>

    <div id="yt-tt-active-banner" class="yt-tt-card yt-tt-active-card yt-tt-hidden">
      <div class="yt-tt-active-time">
        <span class="yt-tt-label">Remaining</span>
        <strong id="yt-tt-remaining">--:--</strong>
      </div>
      <div class="yt-tt-active-actions">
        <button id="yt-tt-extend" type="button" class="yt-tt-btn yt-tt-btn-secondary">+5 min</button>
        <button id="yt-tt-stop" type="button" class="yt-tt-btn yt-tt-btn-danger">Stop</button>
      </div>
    </div>

    <div class="yt-tt-card">
      <div class="yt-tt-tabs">
        <button type="button" class="yt-tt-tab active" data-mode="countdown">Timer</button>
        <button type="button" class="yt-tt-tab" data-mode="until">End Time</button>
        <button type="button" class="yt-tt-tab" data-mode="maxLength">Max Length</button>
      </div>

      <div id="yt-tt-panel-countdown" class="yt-tt-panel">
        <div class="yt-tt-presets">
          <button type="button" class="yt-tt-preset" data-mins="15">15m</button>
          <button type="button" class="yt-tt-preset" data-mins="25">25m</button>
          <button type="button" class="yt-tt-preset" data-mins="45">45m</button>
        </div>
        <label class="yt-tt-row">
          <span>Custom minutes</span>
          <input id="yt-tt-countdown-mins" type="number" min="1" max="360" value="25" />
        </label>
      </div>

      <div id="yt-tt-panel-until" class="yt-tt-panel yt-tt-hidden">
        <label class="yt-tt-row">
          <span>Break ends at</span>
          <input id="yt-tt-until-time" type="time" value="17:00" />
        </label>
      </div>

      <div id="yt-tt-panel-maxLength" class="yt-tt-panel yt-tt-hidden">
        <label class="yt-tt-row">
          <span>Max video length (min)</span>
          <input id="yt-tt-max-mins" type="number" min="1" max="240" value="15" />
        </label>
      </div>

      <button id="yt-tt-start" type="button" class="yt-tt-btn yt-tt-btn-primary yt-tt-full">Start Session</button>
    </div>

    <div class="yt-tt-card yt-tt-settings">
      <h3>Guardrails</h3>
      <label class="yt-tt-row">
        <span>Disable Shorts (standard player)</span>
        <input id="yt-tt-disable-shorts" type="checkbox" />
      </label>
      <label id="yt-tt-cutoff-row" class="yt-tt-row">
        <span>Force leave Shorts before end</span>
        <select id="yt-tt-shorts-cutoff">
          <option value="5">5 min left</option>
          <option value="10">10 min left</option>
        </select>
      </label>
      <label class="yt-tt-row">
        <span>Unfinishable videos</span>
        <select id="yt-tt-exceed-action">
          <option value="hide">Hide completely</option>
          <option value="dim">Dim thumbnail</option>
        </select>
      </label>
      <label class="yt-tt-row">
        <span>Hide Shorts sidebar/nav button</span>
        <input id="yt-tt-hide-nav" type="checkbox" checked />
      </label>
      <label class="yt-tt-row">
        <span>Show duration badge on Shorts</span>
        <input id="yt-tt-show-durations" type="checkbox" checked />
      </label>
    </div>
  `;

  const logoImg = pop.querySelector<HTMLImageElement>('.yt-tt-pop-logo');
  if (logoImg) {
    logoImg.src = webext.runtime.getURL('assets/logo-main.svg');
  }

  // Stop YouTube keyboard shortcuts while typing in inputs inside the popover
  pop.addEventListener('keydown', (e) => {
    if (e.key === 'Escape') {
      closePopover();
    }
    e.stopPropagation();
  });

  pop.querySelectorAll<HTMLButtonElement>('.yt-tt-tab').forEach((tab) => {
    tab.addEventListener('click', () => {
      const mode = tab.dataset.mode as BudgetSpec['mode'];
      if (!mode) return;
      selectedMode = mode;
      pop.querySelectorAll<HTMLButtonElement>('.yt-tt-tab').forEach((t) => {
        t.classList.toggle('active', t.dataset.mode === mode);
      });
      pop.querySelector('#yt-tt-panel-countdown')?.classList.toggle('yt-tt-hidden', mode !== 'countdown');
      pop.querySelector('#yt-tt-panel-until')?.classList.toggle('yt-tt-hidden', mode !== 'until');
      pop.querySelector('#yt-tt-panel-maxLength')?.classList.toggle('yt-tt-hidden', mode !== 'maxLength');
    });
  });

  pop.querySelectorAll<HTMLButtonElement>('.yt-tt-preset').forEach((btn) => {
    btn.addEventListener('click', () => {
      const input = pop.querySelector<HTMLInputElement>('#yt-tt-countdown-mins');
      if (input && btn.dataset.mins) input.value = btn.dataset.mins;
    });
  });

  pop.querySelector<HTMLButtonElement>('#yt-tt-start')?.addEventListener('click', async () => {
    const countdownVal = Number(pop.querySelector<HTMLInputElement>('#yt-tt-countdown-mins')?.value || 25);
    const untilVal = pop.querySelector<HTMLInputElement>('#yt-tt-until-time')?.value || '17:00';
    const maxVal = Number(pop.querySelector<HTMLInputElement>('#yt-tt-max-mins')?.value || 15);

    let spec: BudgetSpec;
    if (selectedMode === 'countdown') {
      spec = { mode: 'countdown', durationMinutes: Math.max(1, countdownVal) };
    } else if (selectedMode === 'until') {
      spec = { mode: 'until', endTime: untilVal };
    } else {
      spec = { mode: 'maxLength', maxMinutes: Math.max(1, maxVal) };
    }

    const next = await webext.runtime.sendMessage<PersistedSessionState>({
      type: 'START_SESSION',
      spec,
    });
    onStateChange(next);
  });

  pop.querySelector<HTMLButtonElement>('#yt-tt-extend')?.addEventListener('click', async () => {
    const next = await webext.runtime.sendMessage<PersistedSessionState>({
      type: 'EXTEND_SESSION',
      additionalMinutes: 5,
    });
    onStateChange(next);
  });

  pop.querySelector<HTMLButtonElement>('#yt-tt-stop')?.addEventListener('click', async () => {
    const next = await webext.runtime.sendMessage<PersistedSessionState>({
      type: 'STOP_SESSION',
    });
    onStateChange(next);
  });

  const syncPolicy = async () => {
    const disableShorts = Boolean(pop.querySelector<HTMLInputElement>('#yt-tt-disable-shorts')?.checked);
    const cutoff = Number(pop.querySelector<HTMLSelectElement>('#yt-tt-shorts-cutoff')?.value) === 10 ? 10 : 5;
    const exceed = pop.querySelector<HTMLSelectElement>('#yt-tt-exceed-action')?.value === 'dim' ? 'dim' : 'hide';
    const hideNav = Boolean(pop.querySelector<HTMLInputElement>('#yt-tt-hide-nav')?.checked);
    const showDur = Boolean(pop.querySelector<HTMLInputElement>('#yt-tt-show-durations')?.checked);

    const next = await webext.runtime.sendMessage<PersistedSessionState>({
      type: 'UPDATE_POLICY',
      patch: {
        shortsMode: disableShorts ? 'redirectToWatch' : 'escalatingNudge',
        shortsLockCutoffMinutes: cutoff,
        exceedAction: exceed,
        hideShortsNavButton: hideNav,
        showShortDurationBadges: showDur,
      },
    });
    onStateChange(next);
  };

  pop.querySelector('#yt-tt-disable-shorts')?.addEventListener('change', syncPolicy);
  pop.querySelector('#yt-tt-shorts-cutoff')?.addEventListener('change', syncPolicy);
  pop.querySelector('#yt-tt-exceed-action')?.addEventListener('change', syncPolicy);
  pop.querySelector('#yt-tt-hide-nav')?.addEventListener('change', syncPolicy);
  pop.querySelector('#yt-tt-show-durations')?.addEventListener('change', syncPolicy);

  return pop;
}

export function syncTopbarControl(
  state: PersistedSessionState,
  onStateChange: (next: PersistedSessionState) => void,
  onWake: () => void,
): void {
  lastState = state;
  const container = getHeaderButtonsContainer();
  if (!container) return;

  let wrap = document.getElementById('yt-timetube-topbar-wrap');
  if (!wrap) {
    wrap = document.createElement('div');
    wrap.id = 'yt-timetube-topbar-wrap';
    wrap.className = 'yt-tt-topbar-wrap';

    const btn = document.createElement('button');
    btn.id = 'yt-timetube-topbar-btn';
    btn.type = 'button';
    btn.className = 'yt-tt-topbar-btn';
    btn.setAttribute('aria-label', 'Open TimeTube menu');
    btn.title = 'TimeTube';

    const icon = document.createElement('img');
    icon.id = 'yt-timetube-topbar-icon';
    icon.className = 'yt-tt-topbar-icon';
    icon.alt = 'TimeTube';

    const badge = document.createElement('span');
    badge.id = 'yt-timetube-topbar-badge';
    badge.className = 'yt-tt-topbar-badge yt-tt-hidden';

    btn.appendChild(icon);
    btn.appendChild(badge);
    wrap.appendChild(btn);

    const popover = buildPopover(onStateChange);
    wrap.appendChild(popover);

    btn.addEventListener('click', (e) => {
      e.stopPropagation();
      onWake();
      popoverOpen = !popoverOpen;
      popover.classList.toggle('yt-tt-hidden', !popoverOpen);
      if (popoverOpen && lastState) {
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
      document.addEventListener('click', (event) => {
        if (!popoverOpen) return;
        const wrapEl = document.getElementById('yt-timetube-topbar-wrap');
        if (wrapEl && !wrapEl.contains(event.target as Node)) {
          closePopover();
        }
      });
    }
  }

  updateTopbarBadge(state);
  const pop = document.getElementById('yt-timetube-popover');
  if (pop && popoverOpen) {
    updatePopoverUI(pop, state);
  }
}

export function updateTopbarBadge(state: PersistedSessionState): void {
  const icon = document.getElementById('yt-timetube-topbar-icon') as HTMLImageElement | null;
  const badge = document.getElementById('yt-timetube-topbar-badge') as HTMLSpanElement | null;
  if (!icon || !badge) return;

  const remainingMs = computeRemainingMs(state, Date.now());
  const hasActiveBadge =
    state.status === 'active' || state.status === 'paused' || state.status === 'expired';

  const lightMode = !isDarkTheme();
  icon.classList.toggle('yt-tt-icon-light', lightMode);

  if (!hasActiveBadge) {
    icon.src = webext.runtime.getURL('assets/topbar-empty.svg');
    badge.classList.add('yt-tt-hidden');
    badge.textContent = '';
    return;
  }

  // Use the user's badged SVG artwork + crisp live approximate time text overlaid on the badge
  icon.src = webext.runtime.getURL('assets/topbar-badge.svg');
  let label = '';
  if (state.status === 'expired') {
    label = '0s';
  } else if (state.spec?.mode === 'maxLength') {
    label = formatApproxRemaining(state.spec.maxMinutes * 60_000);
  } else if (remainingMs !== null) {
    label = formatApproxRemaining(remainingMs);
  }

  if (label) {
    badge.textContent = label;
    badge.classList.remove('yt-tt-hidden');
    badge.classList.toggle('yt-tt-badge-paused', state.status === 'paused');
  } else {
    badge.classList.add('yt-tt-hidden');
  }
}

function updatePopoverUI(pop: HTMLElement, state: PersistedSessionState): void {
  const pill = pop.querySelector<HTMLElement>('#yt-tt-status-pill');
  const activeBanner = pop.querySelector<HTMLElement>('#yt-tt-active-banner');
  const remainingEl = pop.querySelector<HTMLElement>('#yt-tt-remaining');
  const extendBtn = pop.querySelector<HTMLElement>('#yt-tt-extend');
  const remainingMs = computeRemainingMs(state, Date.now());

  if (pill && activeBanner && remainingEl && extendBtn) {
    if (state.status === 'active' || state.status === 'paused') {
      pill.textContent =
        state.status === 'paused'
          ? 'Paused'
          : state.spec?.mode === 'maxLength'
            ? 'Max Length'
            : 'Active';
      pill.className = state.status === 'paused' ? 'yt-tt-pill yt-tt-pill-paused' : 'yt-tt-pill yt-tt-pill-active';
      activeBanner.classList.remove('yt-tt-hidden');
      if (state.spec?.mode === 'maxLength') {
        remainingEl.textContent = `≤ ${state.spec.maxMinutes}m`;
        extendBtn.classList.add('yt-tt-hidden');
      } else {
        remainingEl.textContent = remainingMs !== null ? formatClock(remainingMs) : '--:--';
        extendBtn.classList.remove('yt-tt-hidden');
      }
    } else if (state.status === 'expired') {
      pill.textContent = 'Break Ended';
      pill.className = 'yt-tt-pill yt-tt-pill-expired';
      activeBanner.classList.remove('yt-tt-hidden');
      remainingEl.textContent = '0:00';
      extendBtn.classList.remove('yt-tt-hidden');
    } else {
      pill.textContent = 'Idle';
      pill.className = 'yt-tt-pill yt-tt-pill-idle';
      activeBanner.classList.add('yt-tt-hidden');
    }
  }

  const disableShorts = pop.querySelector<HTMLInputElement>('#yt-tt-disable-shorts');
  const cutoffRow = pop.querySelector<HTMLElement>('#yt-tt-cutoff-row');
  const cutoffSelect = pop.querySelector<HTMLSelectElement>('#yt-tt-shorts-cutoff');
  const exceedSelect = pop.querySelector<HTMLSelectElement>('#yt-tt-exceed-action');
  const hideNav = pop.querySelector<HTMLInputElement>('#yt-tt-hide-nav');
  const showDur = pop.querySelector<HTMLInputElement>('#yt-tt-show-durations');

  if (disableShorts) disableShorts.checked = state.policy.shortsMode === 'redirectToWatch';
  if (cutoffRow) cutoffRow.classList.toggle('yt-tt-hidden', state.policy.shortsMode === 'redirectToWatch');
  if (cutoffSelect) cutoffSelect.value = String(state.policy.shortsLockCutoffMinutes);
  if (exceedSelect) exceedSelect.value = state.policy.exceedAction;
  if (hideNav) hideNav.checked = state.policy.hideShortsNavButton;
  if (showDur) showDur.checked = state.policy.showShortDurationBadges;
}
