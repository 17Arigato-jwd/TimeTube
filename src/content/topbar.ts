import { EMPTY_SCHEDULE, type ScheduleState, type ScheduledStartResponse } from '../core/schedule';
import { bindScheduleStrip } from '../shared/schedule-strip';
import { formatMs } from '../shared/clock';
import { formatApproxRemaining, getDefaultEndTime } from '../core/duration';
import { buildSessionSnapshot, computeRemainingMs } from '../core/policy';
import { BudgetSpec, PersistedSessionState } from '../core/types';
import { webext } from '../shared/webext';

let popoverOpen = false;
let userEditedUntilTime = false;
let selectedMode: BudgetSpec['mode'] = 'countdown';
let lastState: PersistedSessionState | null = null;
let outsideClickBound = false;

let lastSchedule = EMPTY_SCHEDULE;
let renderScheduleStrip: ReturnType<typeof bindScheduleStrip> | undefined;

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

export function closeTopbarPopover(): void {
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
        <img class="yt-tt-pop-logo" alt="" width="20" height="20" />
        <strong>TimeTube</strong>
      </div>
      <span id="yt-tt-status-pill" class="yt-tt-status yt-tt-status-idle">Off</span>
    </div>

    <section id="yt-tt-schedule-strip" data-schedule-strip aria-label="Schedule status" hidden>
      <div id="yt-tt-schedule-budget" data-schedule-budget class="yt-tt-budget-line" hidden>
        <strong id="yt-tt-schedule-status" data-schedule-status></strong>
        <span id="yt-tt-schedule-paused" data-schedule-paused hidden>Paused</span>
        <span id="yt-tt-schedule-reset" data-schedule-reset></span>
      </div>
      <div id="yt-tt-schedule-window" data-schedule-window hidden>
        <div class="yt-tt-window-labels" aria-hidden="true">
          <span id="yt-tt-window-start" data-window-start></span>
          <strong id="yt-tt-window-now" data-window-now></strong>
          <span id="yt-tt-window-end" data-window-end></span>
        </div>
        <div id="yt-tt-window-progress" data-window-progress role="progressbar" aria-label="Scheduled access window"
             aria-valuemin="0" aria-valuemax="100"></div>
      </div>
      <div id="yt-tt-schedule-detail" data-schedule-detail hidden></div>
    </section>

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

    <div id="yt-tt-session-setup" class="yt-tt-section">
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
    <p id="yt-tt-schedule-error" role="alert" hidden></p>
    <button id="yt-tt-schedule-open" type="button" class="yt-tt-schedule-link">
      <strong>Schedule</strong>
      <span aria-hidden="true"></span>
    </button>
  `;

  renderScheduleStrip = bindScheduleStrip(pop.querySelector<HTMLElement>('#yt-tt-schedule-strip')!);
  const scheduleButton = pop.querySelector<HTMLButtonElement>('#yt-tt-schedule-open')!;
  scheduleButton.querySelector('span')!.style.maskImage =
    `url("${webext.runtime.getURL('assets/material/chevron_right.svg')}")`;
  scheduleButton.addEventListener('click', async () => {
    const response = await webext.runtime.sendMessage<{ error?: string }>({ type: 'OPEN_SCHEDULE_SETTINGS' })
      .catch(() => ({ error: 'Could not open schedule settings.' }));
    if (response?.error) {
      const error = pop.querySelector<HTMLElement>('#yt-tt-schedule-error')!;
      error.textContent = 'Could not open schedule settings.';
      error.hidden = false;
    } else {
      closeTopbarPopover();
      document.getElementById('yt-timetube-topbar-btn')?.focus();
    }
  });

  const logoImg = pop.querySelector<HTMLImageElement>('.yt-tt-pop-logo');
  if (logoImg) {
    logoImg.src = webext.runtime.getURL('assets/logo-main.svg');
  }

  pop.addEventListener('keydown', (e) => {
    if (e.key === 'Escape') {
      closeTopbarPopover();
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

  const countdownInput = pop.querySelector<HTMLInputElement>('#yt-tt-countdown-mins');
  const syncChips = () => {
    const val = countdownInput?.value.trim() ?? '';
    pop.querySelectorAll<HTMLButtonElement>('.yt-tt-chip').forEach((c) => {
      c.classList.toggle('active', c.dataset.mins === val);
    });
  };

  pop.querySelectorAll<HTMLButtonElement>('.yt-tt-chip').forEach((btn) => {
    btn.addEventListener('click', () => {
      if (countdownInput && btn.dataset.mins) {
        countdownInput.value = btn.dataset.mins;
        syncChips();
      }
    });
  });
  countdownInput?.addEventListener('input', syncChips);
  const untilInputEl = pop.querySelector<HTMLInputElement>('#yt-tt-until-time');
  if (untilInputEl) {
    untilInputEl.value = getDefaultEndTime();
    untilInputEl.addEventListener('input', () => { userEditedUntilTime = true; });
  }

  pop.querySelector<HTMLButtonElement>('#yt-tt-start')?.addEventListener('click', async () => {
    const countdownVal = Number(countdownInput?.value || 25);
    const untilVal = pop.querySelector<HTMLInputElement>('#yt-tt-until-time')?.value || getDefaultEndTime();
    const maxVal = Number(pop.querySelector<HTMLInputElement>('#yt-tt-max-mins')?.value || 15);

    let spec: BudgetSpec;
    if (selectedMode === 'countdown') {
      spec = { mode: 'countdown', durationMinutes: Math.max(1, countdownVal) };
    } else if (selectedMode === 'until') {
      spec = { mode: 'until', endTime: untilVal };
    } else {
      spec = { mode: 'maxLength', maxMinutes: Math.max(1, maxVal) };
    }

    const status = pop.querySelector<HTMLElement>('#yt-tt-start-message')!;
    status.hidden = true;
    try {
      const result = await webext.runtime.sendMessage<ScheduledStartResponse | { error: string }>({
        type: 'START_SCHEDULED_SESSION',
        spec,
      });
      if ('error' in result) throw new Error(result.error);
      if (result.kind === 'start') {
        onStateChange(result.state);
        return;
      }
      status.textContent = result.kind === 'conflict'
        ? 'This session exceeds your schedule. Open the TimeTube toolbar popup to shorten it or add extra time.'
        : 'Your schedule is restricting access.';
    } catch {
      status.textContent = 'Could not start the session. Try again.';
    }
    status.hidden = false;
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
  schedule: ScheduleState,
  onStateChange: (next: PersistedSessionState) => void,
  onWake: () => void,
): void {
  lastState = state;
  lastSchedule = schedule;
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
        if (!userEditedUntilTime) {
          const u = popover.querySelector<HTMLInputElement>('#yt-tt-until-time');
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
      document.addEventListener('click', (event) => {
        if (!popoverOpen) return;
        const wrapEl = document.getElementById('yt-timetube-topbar-wrap');
        if (wrapEl && !wrapEl.contains(event.target as Node)) {
          closeTopbarPopover();
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

  icon.src = webext.runtime.getURL('assets/topbar-empty.svg');
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
  const now = Date.now();
  const { status, remainingMs } = buildSessionSnapshot(state, now);
  const restricted = renderScheduleStrip?.(lastSchedule, now) ?? false;
  pop.querySelector('#yt-tt-session-setup')?.classList.toggle(
    'yt-tt-hidden', restricted || status === 'active' || status === 'paused',
  );

  if (pill && activeBanner && remainingEl && extendBtn) {
    if (status === 'active' || status === 'paused') {
      pill.textContent =
        status === 'paused'
          ? 'Paused'
          : state.spec?.mode === 'maxLength'
            ? 'Max length'
            : 'Active';
      pill.className = status === 'paused' ? 'yt-tt-status yt-tt-status-paused' : 'yt-tt-status yt-tt-status-active';
      activeBanner.classList.remove('yt-tt-hidden');
      if (state.spec?.mode === 'maxLength') {
        remainingEl.textContent = `≤ ${state.spec.maxMinutes}m`;
        extendBtn.classList.add('yt-tt-hidden');
      } else {
        remainingEl.textContent = remainingMs !== null ? formatMs(remainingMs) : '--:--';
        extendBtn.classList.remove('yt-tt-hidden');
      }
    } else if (status === 'expired') {
      pill.textContent = 'Time up';
      pill.className = 'yt-tt-status yt-tt-status-expired';
      activeBanner.classList.remove('yt-tt-hidden');
      remainingEl.textContent = '0:00';
      extendBtn.classList.remove('yt-tt-hidden');
    } else {
      pill.textContent = 'Off';
      pill.className = 'yt-tt-status yt-tt-status-idle';
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

export function tickTopbarUI(state: PersistedSessionState, schedule: ScheduleState): void {
  lastSchedule = schedule;
  updateTopbarBadge(state);
  const pop = document.getElementById('yt-timetube-popover');
  if (pop && popoverOpen) {
    updatePopoverUI(pop, state);
  }
}

export function openTopbarPopover(): void {
  const pop = document.getElementById('yt-timetube-popover');
  if (!pop) return;
  popoverOpen = true;
  pop.classList.remove('yt-tt-hidden');
  if (!userEditedUntilTime) {
    const u = pop.querySelector<HTMLInputElement>('#yt-tt-until-time');
    if (u) u.value = getDefaultEndTime();
  }
  if (lastState) {
    updatePopoverUI(pop, lastState);
  }
}
