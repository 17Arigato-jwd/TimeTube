import {
  DAY_NAMES, EMPTY_SCHEDULE, ruleLabel, SCHEDULE_KEY, validateSchedule,
  type ScheduleRule, type ScheduleState,
} from '../core/schedule';
import { webext } from '../shared/webext';

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
    details.textContent = `${formatTime(rule.start)}–${formatTime(rule.end)}${rule.end < rule.start ? ' next day' : ''} · ${rule.limitMinutes} min per day · ${rule.mode === 'site' ? 'Time on YouTube' : 'Active playback'}`;
    button.type = 'button';
    button.className = 'tt-pill-btn tt-pill-tonal';
    button.dataset.ruleId = rule.id;
    button.textContent = 'Edit';
    button.setAttribute('aria-label', `Edit ${name.textContent} rule`);
    button.disabled = editing !== null;
    button.onclick = () => openEditor(rule);
    description.append(name, details);
    row.append(description, button);
    rulesList.append(row);
  }
}

function refreshEditor(): void {
  overnight.hidden = !(start.value && end.value && end.value < start.value);
  const taken = rules.find((rule) => rule.id !== editing &&
    dayInputs.some((input) => input.checked && rule.days.includes(Number(input.value))));
  const conflict = dayInputs.find((input) => input.checked && taken?.days.includes(Number(input.value)));
  setError('days-error', taken && conflict
    ? `${DAY_NAMES[Number(conflict.value)]} already belongs to the ${ruleLabel(taken.days)} rule.`
    : '');
}

function openEditor(rule?: ScheduleRule): void {
  editing = rule?.id ?? crypto.randomUUID();
  editorTitle.textContent = rule ? `Edit ${ruleLabel(rule.days)}` : 'Add rule';
  remove.hidden = !rule;
  for (const input of dayInputs) input.checked = rule?.days.includes(Number(input.value)) ?? false;
  start.value = rule?.start ?? '17:00';
  end.value = rule?.end ?? '21:00';
  limit.value = String(rule?.limitMinutes ?? 45);
  const mode = editor.elements.namedItem('mode') as RadioNodeList;
  mode.value = rule?.mode ?? 'site';
  setError('time-error');
  setError('limit-error');
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
  add.disabled = false;
  for (const button of rulesList.querySelectorAll('button')) button.disabled = false;
  if (returnFocus) {
    const button = [...rulesList.querySelectorAll('button')].find((item) => item.dataset.ruleId === previous);
    (button ?? add).focus();
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
  const timesValid = start.value && end.value && start.value !== end.value;
  setError('time-error', timesValid ? '' : 'Choose different start and end times.');
  if (!timesValid) {
    (start.value ? end : start).focus();
    return false;
  }
  const limitValid = limit.validity.valid;
  setError('limit-error', limitValid ? '' : 'Enter a daily limit between 1 and 1,440 minutes.');
  if (!limitValid) {
    limit.focus();
    return false;
  }
  const mode = (editor.elements.namedItem('mode') as RadioNodeList).value as ScheduleRule['mode'];
  const next = { id: editing, days, start: start.value, end: end.value, limitMinutes: limit.valueAsNumber, mode };
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
cancelRule.onclick = () => closeEditor();
remove.onclick = () => {
  rules = rules.filter((rule) => rule.id !== editing);
  saveStatus.textContent = 'Unsaved changes';
  renderRules();
  closeEditor();
};
enabled.onchange = () => { saveStatus.textContent = 'Unsaved changes'; };
cancel.onclick = () => {
  restoreDraft();
  saveStatus.textContent = 'Changes discarded';
};
editor.addEventListener('input', refreshEditor);
editor.addEventListener('submit', (event) => {
  event.preventDefault();
  applyRule();
});
for (const button of editor.querySelectorAll<HTMLButtonElement>('button[data-days]')) {
  button.onclick = () => {
    const days = button.dataset.days!.split(',');
    for (const input of dayInputs) input.checked = days.includes(input.value);
    refreshEditor();
  };
}

save.onclick = async () => {
  if (!applyRule()) return;
  setError('schedule-save-error');
  try {
    validateSchedule(enabled.checked, rules);
  } catch (error) {
    setError('schedule-save-error', (error as Error).message);
    enabled.focus();
    return;
  }
  save.disabled = true;
  try {
    const result = await webext.runtime.sendMessage<ScheduleState | { error: string }>({
      type: 'SAVE_SCHEDULE', enabled: enabled.checked, rules,
    });
    if ('error' in result) throw new Error(result.error);
    saved = result;
    restoreDraft();
    saveStatus.textContent = 'Schedule saved';
  } catch {
    setError('schedule-save-error', 'Could not save the schedule. Try again.');
  } finally {
    save.disabled = false;
  }
};

async function init(): Promise<void> {
  try {
    const stored = await webext.storage.local.get<{ [SCHEDULE_KEY]?: ScheduleState }>(SCHEDULE_KEY);
    saved = stored[SCHEDULE_KEY] ?? EMPTY_SCHEDULE;
    restoreDraft();
    for (const control of [enabled, add, save, cancel]) control.disabled = false;
  } catch {
    setError('schedule-save-error', 'Could not load the schedule. Reopen settings to try again.');
  }
}

void init();
