import { computeRemainingMs } from '../core/policy';
import { BudgetSpec, PersistedSessionState } from '../core/types';
import { webext } from '../shared/webext';

let selectedMode: BudgetSpec['mode'] = 'countdown';
let currentState: PersistedSessionState | null = null;

const statusPill = document.getElementById('status-pill') as HTMLSpanElement;
const activeBanner = document.getElementById('active-banner') as HTMLElement;
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

function formatMs(ms: number): string {
  const totalSec = Math.max(0, Math.ceil(ms / 1000));
  const mins = Math.floor(totalSec / 60);
  const secs = totalSec % 60;
  return `${mins}:${String(secs).padStart(2, '0')}`;
}

function setModeTab(mode: BudgetSpec['mode']): void {
  selectedMode = mode;
  document.querySelectorAll<HTMLButtonElement>('.tab').forEach((btn) => {
    btn.classList.toggle('active', btn.dataset.mode === mode);
  });
  document.getElementById('panel-countdown')?.classList.toggle('hidden', mode !== 'countdown');
  document.getElementById('panel-until')?.classList.toggle('hidden', mode !== 'until');
  document.getElementById('panel-maxLength')?.classList.toggle('hidden', mode !== 'maxLength');
}

function renderState(state: PersistedSessionState): void {
  currentState = state;
  const remainingMs = computeRemainingMs(state, Date.now());

  if (state.status === 'active' || state.status === 'paused') {
    statusPill.textContent =
      state.status === 'paused'
        ? 'Paused'
        : state.spec?.mode === 'maxLength'
          ? 'Max Length'
          : 'Active';
    statusPill.className = state.status === 'paused' ? 'pill pill-paused' : 'pill pill-active';
    activeBanner.classList.remove('hidden');

    if (state.spec?.mode === 'maxLength') {
      remainingDisplay.textContent = `≤ ${state.spec.maxMinutes}m`;
      extendBtn.classList.add('hidden');
    } else {
      remainingDisplay.textContent = remainingMs !== null ? formatMs(remainingMs) : '--:--';
      extendBtn.classList.remove('hidden');
    }
  } else if (state.status === 'expired') {
    statusPill.textContent = 'Break Ended';
    statusPill.className = 'pill pill-expired';
    activeBanner.classList.remove('hidden');
    remainingDisplay.textContent = '0:00';
    extendBtn.classList.remove('hidden');
  } else {
    statusPill.textContent = 'Idle';
    statusPill.className = 'pill pill-idle';
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
  const next = await webext.runtime.sendMessage<PersistedSessionState>({
    type: 'UPDATE_POLICY',
    patch: {
      shortsMode: disableShortsCheckbox.checked ? 'redirectToWatch' : 'escalatingNudge',
      shortsLockCutoffMinutes: Number(shortsCutoffSelect.value) === 10 ? 10 : 5,
      exceedAction: exceedActionSelect.value === 'dim' ? 'dim' : 'hide',
      hideShortsNavButton: hideShortsNavCheckbox.checked,
      showShortDurationBadges: showShortDurationsCheckbox.checked,
    },
  });
  renderState(next);
}

async function initPopup(): Promise<void> {
  await webext.runtime.sendMessage({ type: 'WAKE_FROM_POPUP' }).catch(() => undefined);
  const state = await webext.runtime.sendMessage<PersistedSessionState>({ type: 'GET_STATE' });
  renderState(state);

  document.querySelectorAll<HTMLButtonElement>('.tab').forEach((btn) => {
    btn.addEventListener('click', () => {
      const mode = btn.dataset.mode as BudgetSpec['mode'];
      if (mode) setModeTab(mode);
    });
  });

  document.querySelectorAll<HTMLButtonElement>('.preset').forEach((btn) => {
    btn.addEventListener('click', () => {
      if (btn.dataset.mins) countdownInput.value = btn.dataset.mins;
    });
  });

  startBtn.addEventListener('click', async () => {
    let spec: BudgetSpec;
    if (selectedMode === 'countdown') {
      spec = { mode: 'countdown', durationMinutes: Math.max(1, Number(countdownInput.value) || 25) };
    } else if (selectedMode === 'until') {
      spec = { mode: 'until', endTime: untilInput.value || '17:00' };
    } else {
      spec = { mode: 'maxLength', maxMinutes: Math.max(1, Number(maxLengthInput.value) || 15) };
    }

    const next = await webext.runtime.sendMessage<PersistedSessionState>({
      type: 'START_SESSION',
      spec,
    });
    renderState(next);
  });

  extendBtn.addEventListener('click', async () => {
    const next = await webext.runtime.sendMessage<PersistedSessionState>({
      type: 'EXTEND_SESSION',
      additionalMinutes: 5,
    });
    renderState(next);
  });

  stopBtn.addEventListener('click', async () => {
    const next = await webext.runtime.sendMessage<PersistedSessionState>({
      type: 'STOP_SESSION',
    });
    renderState(next);
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
