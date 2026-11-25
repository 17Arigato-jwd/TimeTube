import { formatMs } from '../shared/clock';
import { initSchedulePopup, renderSchedule, startScheduledSession } from './schedule';
import { getDefaultEndTime } from '../core/duration';
import { buildSessionSnapshot } from '../core/policy';
import { BudgetSpec, PersistedSessionState } from '../core/types';
import { webext } from '../shared/webext';

const STATE_KEY = 'ytTimeFitSessionState';

let selectedMode: BudgetSpec['mode'] = 'countdown';
let currentState: PersistedSessionState | null = null;

const statusPill = document.getElementById('status-pill') as HTMLSpanElement;
const activeBanner = document.getElementById('active-banner') as HTMLElement;
const sessionSetup = document.getElementById('session-setup') as HTMLElement;
const remainingDisplay = document.getElementById('remaining-display') as HTMLElement;
const extendBtn = document.getElementById('extend-btn') as HTMLButtonElement;
const stopBtn = document.getElementById('stop-btn') as HTMLButtonElement;
const startBtn = document.getElementById('start-btn') as HTMLButtonElement;

const countdownInput = document.getElementById('countdown-mins') as HTMLInputElement;
const untilInput = document.getElementById('until-time') as HTMLInputElement;
const maxLengthInput = document.getElementById('max-length-mins') as HTMLInputElement;

const disableShortsCheckbox = document.getElementById('disable-shorts') as HTMLInputElement;
const shortsCutoffSelect = document.getElementById('shorts-cutoff') as HTMLSelectElement;
const cutoffRow = document.getElementById('cutoff-row') as HTMLElement;
const exceedActionSelect = document.getElementById('exceed-action') as HTMLSelectElement;
const hideShortsNavCheckbox = document.getElementById('hide-shorts-nav') as HTMLInputElement;
const showShortDurationsCheckbox = document.getElementById('show-short-durations') as HTMLInputElement;

function setModeTab(mode: BudgetSpec['mode']): void {
  selectedMode = mode;
  document.querySelectorAll<HTMLButtonElement>('.tt-tab').forEach((btn) => {
    btn.classList.toggle('active', btn.dataset.mode === mode);
  });
  document.getElementById('panel-countdown')?.classList.toggle('hidden', mode !== 'countdown');
  document.getElementById('panel-until')?.classList.toggle('hidden', mode !== 'until');
  document.getElementById('panel-maxLength')?.classList.toggle('hidden', mode !== 'maxLength');
}

function syncActivePresetChip(): void {
  const val = countdownInput.value.trim();
  document.querySelectorAll<HTMLButtonElement>('.tt-chip').forEach((btn) => {
    btn.classList.toggle('active', btn.dataset.mins === val);
  });
}

function renderState(state: PersistedSessionState): void {
  currentState = state;
  const { status, remainingMs } = buildSessionSnapshot(state, Date.now());
  const sessionInProgress = status === 'active' || status === 'paused';
  const scheduleRestricted = renderSchedule();
  sessionSetup.classList.toggle('hidden', sessionInProgress || scheduleRestricted);

  if (sessionInProgress) {
    statusPill.textContent =
      status === 'paused'
        ? 'Paused'
        : state.spec?.mode === 'maxLength'
          ? 'Max length'
          : 'Active';
    statusPill.className =
      status === 'paused' ? 'tt-status tt-status-paused' : 'tt-status tt-status-active';
    activeBanner.classList.remove('hidden');

    if (state.spec?.mode === 'maxLength') {
      remainingDisplay.textContent = `≤ ${state.spec.maxMinutes}m`;
      extendBtn.classList.add('hidden');
    } else {
      remainingDisplay.textContent = remainingMs !== null ? formatMs(remainingMs) : '--:--';
      extendBtn.classList.remove('hidden');
    }
  } else if (status === 'expired') {
    statusPill.textContent = 'Time up';
    statusPill.className = 'tt-status tt-status-expired';
    activeBanner.classList.remove('hidden');
    remainingDisplay.textContent = '0:00';
    extendBtn.classList.remove('hidden');
  } else {
    statusPill.textContent = 'Off';
    statusPill.className = 'tt-status tt-status-idle';
    activeBanner.classList.add('hidden');
  }

  disableShortsCheckbox.checked = state.policy.shortsMode === 'redirectToWatch';
  cutoffRow.classList.toggle('hidden', state.policy.shortsMode === 'redirectToWatch');
  shortsCutoffSelect.value = String(state.policy.shortsLockCutoffMinutes);
  exceedActionSelect.value = state.policy.exceedAction;
  hideShortsNavCheckbox.checked = state.policy.hideShortsNavButton;
  showShortDurationsCheckbox.checked = state.policy.showShortDurationBadges;
}

async function syncPolicy(): Promise<void> {
  await webext.runtime.sendMessage({
    type: 'UPDATE_POLICY',
    patch: {
      shortsMode: disableShortsCheckbox.checked ? 'redirectToWatch' : 'escalatingNudge',
      shortsLockCutoffMinutes: Number(shortsCutoffSelect.value) === 10 ? 10 : 5,
      exceedAction: exceedActionSelect.value === 'dim' ? 'dim' : 'hide',
      hideShortsNavButton: hideShortsNavCheckbox.checked,
      showShortDurationBadges: showShortDurationsCheckbox.checked,
    },
  });
}

async function initPopup(): Promise<void> {
  webext.storage.onChanged.addListener((changes, area) => {
    if (area !== 'local' || !changes[STATE_KEY]?.newValue) return;
    renderState(changes[STATE_KEY].newValue as PersistedSessionState);
  });

  await initSchedulePopup(() => {
    if (currentState) renderState(currentState);
  });
  await webext.runtime.sendMessage({ type: 'WAKE_FROM_POPUP' }).catch(() => undefined);
  const state = await webext.runtime.sendMessage<PersistedSessionState>({ type: 'GET_STATE' });
  untilInput.value = getDefaultEndTime();
  renderState(currentState ?? state);

  document.querySelectorAll<HTMLButtonElement>('.tt-tab').forEach((btn) => {
    btn.addEventListener('click', () => {
      const mode = btn.dataset.mode as BudgetSpec['mode'];
      if (mode) setModeTab(mode);
    });
  });

  document.querySelectorAll<HTMLButtonElement>('.tt-chip').forEach((btn) => {
    btn.addEventListener('click', () => {
      if (btn.dataset.mins) {
        countdownInput.value = btn.dataset.mins;
        syncActivePresetChip();
      }
    });
  });

  countdownInput.addEventListener('input', syncActivePresetChip);

  startBtn.addEventListener('click', async () => {
    let spec: BudgetSpec;
    if (selectedMode === 'countdown') {
      spec = { mode: 'countdown', durationMinutes: Math.max(1, Number(countdownInput.value) || 25) };
    } else if (selectedMode === 'until') {
      spec = { mode: 'until', endTime: untilInput.value || getDefaultEndTime() };
    } else {
      spec = { mode: 'maxLength', maxMinutes: Math.max(1, Number(maxLengthInput.value) || 15) };
    }

    await startScheduledSession(spec);
  });

  extendBtn.addEventListener('click', async () => {
    await webext.runtime.sendMessage({
      type: 'EXTEND_SESSION',
      additionalMinutes: 5,
    });
  });

  stopBtn.addEventListener('click', async () => {
    await webext.runtime.sendMessage({
      type: 'STOP_SESSION',
    });
  });

  disableShortsCheckbox.addEventListener('change', syncPolicy);
  shortsCutoffSelect.addEventListener('change', syncPolicy);
  exceedActionSelect.addEventListener('change', syncPolicy);
  hideShortsNavCheckbox.addEventListener('change', syncPolicy);
  showShortDurationsCheckbox.addEventListener('change', syncPolicy);

  window.setInterval(() => {
    if (currentState) renderState(currentState);
  }, 1000);
}

initPopup();
