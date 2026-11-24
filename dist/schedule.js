// src/core/schedule.ts
var SCHEDULE_KEY = "timeTubeSchedule";
var DAY_NAMES = ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"];
var EMPTY_SCHEDULE = { enabled: false, rules: [], usage: {} };
function ruleLabel(days) {
  const ordered = [1, 2, 3, 4, 5, 6, 0].filter((day) => days.includes(day));
  if (ordered.length === 7) return "Every day";
  if (ordered.join() === "1,2,3,4,5") return "Weekdays";
  if (ordered.join() === "6,0") return "Weekends";
  return ordered.map((day) => DAY_NAMES[day]).join(", ");
}
function validateSchedule(enabled2, rules2) {
  if (enabled2 && !rules2.length) throw new Error("Add a rule before enabling the schedule.");
  const owners = /* @__PURE__ */ new Map();
  const ids = /* @__PURE__ */ new Set();
  for (const rule of rules2) {
    if (!rule.id || ids.has(rule.id)) throw new Error("Each rule must have a unique ID.");
    ids.add(rule.id);
    if (!rule.days.length) throw new Error("Select at least one day.");
    for (const day of rule.days) {
      if (!Number.isInteger(day) || day < 0 || day > 6) throw new Error("Select a valid day.");
      const owner = owners.get(day);
      if (owner) throw new Error(`${DAY_NAMES[day]} already belongs to the ${ruleLabel(owner.days)} rule.`);
      owners.set(day, rule);
    }
    const time = /^(?:[01]\d|2[0-3]):[0-5]\d$/;
    if (!time.test(rule.start) || !time.test(rule.end) || rule.start === rule.end) {
      throw new Error("Choose different start and end times.");
    }
    if (!Number.isInteger(rule.limitMinutes) || rule.limitMinutes < 1 || rule.limitMinutes > 1440) {
      throw new Error("Enter a daily limit between 1 and 1,440 minutes.");
    }
    if (rule.mode !== "site" && rule.mode !== "playback") throw new Error("Choose how to count usage.");
  }
}

// src/shared/webext.ts
var rawApi = globalThis.browser ?? globalThis.chrome;
var webext = rawApi;

// src/options/index.ts
var enabled = document.querySelector("#enabled");
var rulesList = document.querySelector("#rules");
var empty = document.querySelector("#empty-rules");
var editor = document.querySelector("#rule-editor");
var editorTitle = document.querySelector("#editor-title");
var dayOptions = document.querySelector("#day-options");
var start = document.querySelector("#rule-start");
var end = document.querySelector("#rule-end");
var limit = document.querySelector("#rule-limit");
var overnight = document.querySelector("#overnight");
var saveStatus = document.querySelector("#save-status");
var add = document.querySelector("#add-rule");
var remove = document.querySelector("#remove-rule");
var save = document.querySelector("#save-schedule");
var cancel = document.querySelector("#cancel-schedule");
var cancelRule = document.querySelector("#cancel-rule");
var saved = EMPTY_SCHEDULE;
var rules = [];
var editing = null;
var dayInputs = [1, 2, 3, 4, 5, 6, 0].map((day) => {
  const label = document.createElement("label");
  const input = document.createElement("input");
  input.type = "checkbox";
  input.value = String(day);
  input.setAttribute("aria-label", DAY_NAMES[day]);
  input.setAttribute("aria-describedby", "days-error");
  const name = document.createElement("span");
  name.textContent = DAY_NAMES[day].slice(0, 3);
  label.append(input, name);
  dayOptions.append(label);
  return input;
});
function setError(id, message = "") {
  const element = document.getElementById(id);
  element.textContent = message;
  element.hidden = !message;
}
function formatTime(value) {
  const [hour = 0, minute = 0] = value.split(":").map(Number);
  return new Date(2e3, 0, 1, hour, minute).toLocaleTimeString(void 0, { hour: "numeric", minute: "2-digit" });
}
function renderRules() {
  rulesList.replaceChildren();
  empty.hidden = rules.length > 0;
  for (const rule of rules) {
    const row = document.createElement("li");
    const description = document.createElement("div");
    const name = document.createElement("strong");
    const details = document.createElement("span");
    const button = document.createElement("button");
    name.textContent = ruleLabel(rule.days);
    details.textContent = `${formatTime(rule.start)}\u2013${formatTime(rule.end)}${rule.end < rule.start ? " next day" : ""} \xB7 ${rule.limitMinutes} min per day \xB7 ${rule.mode === "site" ? "Time on YouTube" : "Active playback"}`;
    button.type = "button";
    button.className = "tt-pill-btn tt-pill-tonal";
    button.dataset.ruleId = rule.id;
    button.textContent = "Edit";
    button.setAttribute("aria-label", `Edit ${name.textContent} rule`);
    button.disabled = editing !== null;
    button.onclick = () => openEditor(rule);
    description.append(name, details);
    row.append(description, button);
    rulesList.append(row);
  }
}
function refreshEditor() {
  overnight.hidden = !(start.value && end.value && end.value < start.value);
  const taken = rules.find((rule) => rule.id !== editing && dayInputs.some((input) => input.checked && rule.days.includes(Number(input.value))));
  const conflict = dayInputs.find((input) => input.checked && taken?.days.includes(Number(input.value)));
  setError("days-error", taken && conflict ? `${DAY_NAMES[Number(conflict.value)]} already belongs to the ${ruleLabel(taken.days)} rule.` : "");
}
function openEditor(rule) {
  editing = rule?.id ?? crypto.randomUUID();
  editorTitle.textContent = rule ? `Edit ${ruleLabel(rule.days)}` : "Add rule";
  remove.hidden = !rule;
  for (const input of dayInputs) input.checked = rule?.days.includes(Number(input.value)) ?? false;
  start.value = rule?.start ?? "17:00";
  end.value = rule?.end ?? "21:00";
  limit.value = String(rule?.limitMinutes ?? 45);
  const mode = editor.elements.namedItem("mode");
  mode.value = rule?.mode ?? "site";
  setError("time-error");
  setError("limit-error");
  refreshEditor();
  editor.classList.remove("hidden");
  add.disabled = true;
  for (const button of rulesList.querySelectorAll("button")) button.disabled = true;
  dayInputs[0]?.focus();
}
function closeEditor(returnFocus = true) {
  const previous = editing;
  editing = null;
  editor.classList.add("hidden");
  add.disabled = false;
  for (const button of rulesList.querySelectorAll("button")) button.disabled = false;
  if (returnFocus) {
    const button = [...rulesList.querySelectorAll("button")].find((item) => item.dataset.ruleId === previous);
    (button ?? add).focus();
  }
}
function applyRule() {
  if (!editing) return true;
  refreshEditor();
  const days = dayInputs.filter((input) => input.checked).map((input) => Number(input.value));
  if (!days.length) setError("days-error", "Select at least one day.");
  if (!document.getElementById("days-error").hidden) {
    (dayInputs.find((input) => input.checked) ?? dayInputs[0])?.focus();
    return false;
  }
  const timesValid = start.value && end.value && start.value !== end.value;
  setError("time-error", timesValid ? "" : "Choose different start and end times.");
  if (!timesValid) {
    (start.value ? end : start).focus();
    return false;
  }
  const limitValid = limit.validity.valid;
  setError("limit-error", limitValid ? "" : "Enter a daily limit between 1 and 1,440 minutes.");
  if (!limitValid) {
    limit.focus();
    return false;
  }
  const mode = editor.elements.namedItem("mode").value;
  const next = { id: editing, days, start: start.value, end: end.value, limitMinutes: limit.valueAsNumber, mode };
  rules = rules.some((rule) => rule.id === editing) ? rules.map((rule) => rule.id === editing ? next : rule) : [...rules, next];
  saveStatus.textContent = "Unsaved changes";
  renderRules();
  closeEditor();
  return true;
}
function restoreDraft() {
  enabled.checked = saved.enabled;
  rules = [...saved.rules];
  renderRules();
  closeEditor(false);
  setError("schedule-save-error");
}
add.onclick = () => openEditor();
cancelRule.onclick = () => closeEditor();
remove.onclick = () => {
  rules = rules.filter((rule) => rule.id !== editing);
  saveStatus.textContent = "Unsaved changes";
  renderRules();
  closeEditor();
};
enabled.onchange = () => {
  saveStatus.textContent = "Unsaved changes";
};
cancel.onclick = () => {
  restoreDraft();
  saveStatus.textContent = "Changes discarded";
};
editor.addEventListener("input", refreshEditor);
editor.addEventListener("submit", (event) => {
  event.preventDefault();
  applyRule();
});
for (const button of editor.querySelectorAll("button[data-days]")) {
  button.onclick = () => {
    const days = button.dataset.days.split(",");
    for (const input of dayInputs) input.checked = days.includes(input.value);
    refreshEditor();
  };
}
save.onclick = async () => {
  if (!applyRule()) return;
  setError("schedule-save-error");
  try {
    validateSchedule(enabled.checked, rules);
  } catch (error) {
    setError("schedule-save-error", error.message);
    enabled.focus();
    return;
  }
  save.disabled = true;
  try {
    const result = await webext.runtime.sendMessage({
      type: "SAVE_SCHEDULE",
      enabled: enabled.checked,
      rules
    });
    if ("error" in result) throw new Error(result.error);
    saved = result;
    restoreDraft();
    saveStatus.textContent = "Schedule saved";
  } catch {
    setError("schedule-save-error", "Could not save the schedule. Try again.");
  } finally {
    save.disabled = false;
  }
};
async function init() {
  try {
    const stored = await webext.storage.local.get(SCHEDULE_KEY);
    saved = stored[SCHEDULE_KEY] ?? EMPTY_SCHEDULE;
    restoreDraft();
    for (const control of [enabled, add, save, cancel]) control.disabled = false;
  } catch {
    setError("schedule-save-error", "Could not load the schedule. Reopen settings to try again.");
  }
}
void init();
//# sourceMappingURL=schedule.js.map
