import {
  DAY_NAMES, EMPTY_SCHEDULE, ruleLabel, SCHEDULE_KEY, validateSchedule,
  type ScheduleRule, type ScheduleState,
} from '../core/schedule';
import { webext } from '../shared/webext';

const weekly = document.querySelector<HTMLElement>('#weekly-rules')!;
const windowEnabled = document.querySelector<HTMLInputElement>('#window-enabled')!;
const limitEnabled = document.querySelector<HTMLInputElement>('#limit-enabled')!;
const windowFields = document.querySelector<HTMLFieldSetElement>('#window-fields')!;
const limitFields = document.querySelector<HTMLFieldSetElement>('#limit-fields')!;
const resetTime = document.querySelector<HTMLInputElement>('#rule-reset')!;
const removeDialog = document.querySelector<HTMLDialogElement>('#remove-dialog')!;
const removeDescription = document.querySelector<HTMLElement>('#remove-description')!;
const enabled = document.querySelector<HTMLInputElement>('#enabled')!;
const rulesList = document.querySelector<HTMLUListElement>('#rules')!;
const empty = document.querySelector<HTMLElement>('#empty-rules')!;
const editor = document.querySelector<HTMLFormElement>('#rule-editor')!;
const editorTitle = document.querySelector<HTMLElement>('#editor-title')!;
const dayOptions = document.querySelector<HTMLElement>('#day-options')!;
const start = document.querySelector<HTMLInputElement>('#rule-start')!;
const end = document.querySelector<HTMLInputElement>('#rule-end')!;
const limit = document.querySelector<HTMLInputElement>('#rule-limit')!;
const overnight = document.querySelector<HTMLElement>('#overnight')!;
const saveStatus = document.querySelector<HTMLElement>('#save-status')!;
const add = document.querySelector<HTMLButtonElement>('#add-rule')!;
const remove = document.querySelector<HTMLButtonElement>('#remove-rule')!;
const save = document.querySelector<HTMLButtonElement>('#save-schedule')!;
const cancel = document.querySelector<HTMLButtonElement>('#cancel-schedule')!;
const cancelRule = document.querySelector<HTMLButtonElement>('#cancel-rule')!;

let saved = EMPTY_SCHEDULE;
let rules: ScheduleRule[] = [];
let editing: string | null = null;

const dayInputs = [1, 2, 3, 4, 5, 6, 0].map((day) => {
  const label = document.createElement('label');
  const input = document.createElement('input');
  input.type = 'checkbox';
  input.value = String(day);
  input.setAttribute('aria-label', DAY_NAMES[day]!);
  input.setAttribute('aria-describedby', 'days-error');
  const name = document.createElement('span');
  name.textContent = DAY_NAMES[day]!.slice(0, 3);
  label.append(input, name);
  dayOptions.append(label);
  return input;
});

function setError(id: string, message = ''): void {
  const element = document.getElementById(id)!;
  element.textContent = message;
  element.hidden = !message;
}

function formatTime(value: string): string {
  const [hour = 0, minute = 0] = value.split(':').map(Number);
  return new Date(2000, 0, 1, hour, minute).toLocaleTimeString(undefined, { hour: 'numeric', minute: '2-digit' });
}

function renderRules(): void {
  rulesList.replaceChildren();
  empty.hidden = rules.length > 0;
  for (const rule of rules) {
    const row = document.createElement('li');
    const description = document.createElement('div');
    const name = document.createElement('strong');
    const details = document.createElement('span');
    const button = document.createElement('button');
    name.textContent = ruleLabel(rule.days);
    const parts = [];
    if (rule.windowEnabled !== false) {
      parts.push(`${formatTime(rule.start)}–${formatTime(rule.end)}${rule.end < rule.start ? ' next day' : ''}`);
    }
    if (rule.limitEnabled !== false) {
      parts.push(`${rule.limitMinutes} min per day`, `Resets at ${formatTime(rule.resetTime ?? '00:00')}`,
        rule.mode === 'site' ? 'Time on YouTube' : 'Active playback');
    }
    details.textContent = parts.join(' · ');
    button.type = 'button';
    button.className = 'tt-pill-btn tt-pill-tonal';
    button.dataset.ruleId = rule.id;
    button.textContent = 'Edit';
    button.setAttribute('aria-label', `Edit ${name.textContent} rule`);
    button.disabled = !enabled.checked || editing !== null;
    button.onclick = () => openEditor(rule);
    description.append(name, details);
    row.append(description, button);
    rulesList.append(row);
  }
}

function refreshEditor(): void {
  windowFields.disabled = !windowEnabled.checked;
  limitFields.disabled = !limitEnabled.checked;
  setError('sections-error');
  setError('reset-error');
  setError('time-error');
  setError('limit-error');
  const checked = dayInputs.filter((input) => input.checked).map((input) => input.value);
  for (const button of editor.querySelectorAll<HTMLButtonElement>('button[data-days]')) {
    button.setAttribute('aria-pressed', String(button.dataset.days === checked.join(',')));
  }
  overnight.hidden = !(windowEnabled.checked && start.value && end.value && end.value < start.value);
  const taken = rules.find((rule) => rule.id !== editing &&
    dayInputs.some((input) => input.checked && rule.days.includes(Number(input.value))));
  const conflict = dayInputs.find((input) => input.checked && taken?.days.includes(Number(input.value)));
  setError('days-error', taken && conflict
    ? `${DAY_NAMES[Number(conflict.value)]} already belongs to the ${ruleLabel(taken.days)} rule.`
    : '');
}

function openEditor(rule?: ScheduleRule): void {
  if (!enabled.checked) return;
  editing = rule?.id ?? crypto.randomUUID();
  editorTitle.textContent = rule ? `Edit ${ruleLabel(rule.days)}` : 'Add rule';
  remove.hidden = !rule;
  remove.disabled = false;
  for (const input of dayInputs) input.checked = rule?.days.includes(Number(input.value)) ?? false;
  start.value = rule?.start ?? '17:00';
  end.value = rule?.end ?? '21:00';
  windowEnabled.checked = rule ? rule.windowEnabled !== false : false;
  limitEnabled.checked = rule?.limitEnabled !== false;
  resetTime.value = rule?.resetTime ?? '00:00';
  limit.value = String(rule?.limitMinutes ?? 45);
  const mode = editor.elements.namedItem('mode') as RadioNodeList;
  mode.value = rule?.mode ?? 'site';
  setError('time-error');
  setError('limit-error');
  saveStatus.textContent = '';
  refreshEditor();
  editor.classList.remove('hidden');
  add.disabled = true;
  for (const button of rulesList.querySelectorAll('button')) button.disabled = true;
  dayInputs[0]?.focus();
}

function closeEditor(returnFocus = true): void {
  const previous = editing;
  editing = null;
  editor.classList.add('hidden');
  add.disabled = !enabled.checked;
  remove.disabled = !enabled.checked;
  weekly.classList.toggle('tt-rules-disabled', !enabled.checked);
  for (const button of rulesList.querySelectorAll('button')) button.disabled = !enabled.checked;
  if (returnFocus) {
    const button = [...rulesList.querySelectorAll('button')].find((item) => item.dataset.ruleId === previous);
    (enabled.checked ? button ?? add : enabled).focus();
  }
}

function applyRule(): boolean {
  if (!editing) return true;
  refreshEditor();
  const days = dayInputs.filter((input) => input.checked).map((input) => Number(input.value));
  if (!days.length) setError('days-error', 'Select at least one day.');
  if (!document.getElementById('days-error')!.hidden) {
    (dayInputs.find((input) => input.checked) ?? dayInputs[0])?.focus();
    return false;
  }
  if (!windowEnabled.checked && !limitEnabled.checked) {
    setError('sections-error', 'Select an access window, a daily limit, or both.');
    windowEnabled.focus();
    return false;
  }
  const timesValid = !windowEnabled.checked || (start.value && end.value && start.value !== end.value);
  setError('time-error', timesValid ? '' : 'Choose different start and end times.');
  if (!timesValid) {
    (start.value ? end : start).focus();
    return false;
  }
  const limitValid = !limitEnabled.checked || limit.validity.valid;
  setError('limit-error', limitValid ? '' : 'Enter a daily limit between 1 and 1,440 minutes.');
  if (!limitValid) {
    limit.focus();
    return false;
  }
  if (limitEnabled.checked && !resetTime.validity.valid) {
    setError('reset-error', 'Choose a daily reset time.');
    resetTime.focus();
    return false;
  }
  const mode = (editor.elements.namedItem('mode') as RadioNodeList).value as ScheduleRule['mode'];
  const next: ScheduleRule = {
    id: editing, days, mode,
    windowEnabled: windowEnabled.checked,
    start: start.value || '17:00',
    end: end.value || '21:00',
    limitEnabled: limitEnabled.checked,
    limitMinutes: limit.validity.valid && Number.isFinite(limit.valueAsNumber) ? limit.valueAsNumber : 45,
    resetTime: resetTime.value || '00:00',
  };
  rules = rules.some((rule) => rule.id === editing)
    ? rules.map((rule) => rule.id === editing ? next : rule)
    : [...rules, next];
  saveStatus.textContent = 'Unsaved changes';
  renderRules();
  closeEditor();
  return true;
}

function restoreDraft(): void {
  enabled.checked = saved.enabled;
  rules = [...saved.rules];
  renderRules();
  closeEditor(false);
  setError('schedule-save-error');
}

add.onclick = () => openEditor();
cancelRule.onclick = () => {
  if (!saved.enabled && !rules.length) enabled.checked = false;
  closeEditor();
  saveStatus.textContent = JSON.stringify(rules) === JSON.stringify(saved.rules) ? '' : 'Unsaved changes';
};
remove.onclick = () => {
  const rule = rules.find((item) => item.id === editing);
  if (!rule || !enabled.checked) return;
  removeDescription.textContent = `Remove the ${ruleLabel(rule.days)} rule? Save the schedule to apply this change.`;
  removeDialog.returnValue = '';
  removeDialog.showModal();
};
removeDialog.addEventListener('close', () => {
  if (removeDialog.returnValue !== 'remove') {
    remove.focus();
    return;
  }
  rules = rules.filter((rule) => rule.id !== editing);
  saveStatus.textContent = 'Unsaved changes';
  renderRules();
  closeEditor();
});

enabled.onchange = async () => {
  const turnOn = enabled.checked;
  if (turnOn && !saved.rules.length) {
    weekly.classList.remove('tt-rules-disabled');
    openEditor();
    return;
  }
  // A toggle always operates on saved rules, discarding pending rule edits.
  rules = [...saved.rules];
  renderRules();
  closeEditor(false);
  await persist(turnOn, rules, turnOn ? 'Schedule enabled' : 'Schedule disabled', true);
  enabled.focus();
};
cancel.onclick = () => {
  restoreDraft();
  saveStatus.textContent = 'Changes discarded';
};
editor.addEventListener('input', () => {
  saveStatus.textContent = 'Unsaved changes';
  refreshEditor();
});
editor.addEventListener('submit', (event) => {
  event.preventDefault();
  applyRule();
});
for (const button of editor.querySelectorAll<HTMLButtonElement>('button[data-days]')) {
  button.onclick = () => {
    const days = button.dataset.days!.split(',');
    for (const input of dayInputs) input.checked = days.includes(input.value);
    refreshEditor();
    saveStatus.textContent = 'Unsaved changes';
  };
}

async function persist(turnOn: boolean, nextRules: ScheduleRule[], message: string, restoreOnFailure = false): Promise<void> {
  setError('schedule-save-error');
  const main = document.querySelector('main')!;
  main.inert = true;
  try {
    const result = await webext.runtime.sendMessage<ScheduleState | { error: string }>({
      type: 'SAVE_SCHEDULE', enabled: turnOn, rules: nextRules,
    });
    if ('error' in result) throw new Error(result.error);
    saved = result;
    restoreDraft();
    saveStatus.textContent = message;
  } catch {
    if (restoreOnFailure) restoreDraft();
    setError('schedule-save-error', 'Could not save the schedule. Try again.');
  } finally {
    main.inert = false;
  }
}

save.onclick = async () => {
  if (!applyRule()) return;
  const turnOn = enabled.checked && rules.length > 0;
  try {
    validateSchedule(turnOn, rules);
  } catch (error) {
    setError('schedule-save-error', (error as Error).message);
    enabled.focus();
    return;
  }
  await persist(turnOn, rules, 'Schedule saved');
  save.focus();
};

async function init(): Promise<void> {
  try {
    const stored = await webext.storage.local.get<{ [SCHEDULE_KEY]?: ScheduleState }>(SCHEDULE_KEY);
    saved = stored[SCHEDULE_KEY] ?? EMPTY_SCHEDULE;
    restoreDraft();
    for (const control of [enabled, save, cancel]) control.disabled = false;
  } catch {
    setError('schedule-save-error', 'Could not load the schedule. Reopen settings to try again.');
  }
}

void init();
