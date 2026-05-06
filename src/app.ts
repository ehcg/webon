import {
  clearTaskData,
  createId,
  exportBackup,
  getAllTasks,
  getNextOrder,
  getScreenshot,
  getSetting,
  importBackup,
  saveTask,
  saveTasks,
  setSetting
} from "./db.js";
import type {
  BackupData,
  SortDirection,
  TaskFilter,
  TaskSortField,
  TodoTask
} from "./types.js";

declare const chrome: any;

type SaveFileHandle = {
  queryPermission?: (options: { mode: "readwrite" }) => Promise<PermissionState>;
  requestPermission?: (
    options: { mode: "readwrite" }
  ) => Promise<PermissionState>;
  createWritable: () => Promise<{
    write: (data: Blob) => Promise<void>;
    close: () => Promise<void>;
  }>;
};

type ImportedTask = {
  name: string;
  dueDate: string | null;
  notes: string;
  pageTitle: string;
  pageUrl: string;
  createdAt: string;
  done: boolean;
  sourceKey: string;
  sourceName: string;
};

type JiraImportSettings = {
  siteUrl: string;
  email: string;
  token: string;
  jql: string;
  savedAt: string;
};

type ImportResult = {
  imported: number;
  updated: number;
  skipped: number;
};

type SortSettings = {
  field: TaskSortField;
  direction: SortDirection;
};

declare global {
  interface Window {
    showSaveFilePicker?: (options: unknown) => Promise<SaveFileHandle>;
  }
}

const DEFAULT_FILE_NAME = "webon-data.json";
const DEFAULT_SORT_SETTINGS: SortSettings = {
  field: "manual",
  direction: "asc"
};
const DEFAULT_JIRA_JQL =
  "(assignee = currentUser() OR reporter = currentUser() OR creator = currentUser() OR watcher = currentUser() OR voter = currentUser()) AND resolution = Unresolved ORDER BY updated DESC";
const JIRA_IMPORT_SETTINGS_KEY = "jiraImportSettings";
const SORT_SETTINGS_KEY = "taskSortSettings";
const TASKS_CHANGED_MESSAGE = "TASKS_CHANGED";
const TASKS_CHANGED_FROM_APP_MESSAGE = "TASKS_CHANGED_FROM_APP";
const ONE_WEEK_MS = 7 * 24 * 60 * 60 * 1000;

let tasks: TodoTask[] = [];
let activeFilter: TaskFilter = "all";
let showArchived = false;
let activeSortField: TaskSortField = DEFAULT_SORT_SETTINGS.field;
let activeSortDirection: SortDirection = DEFAULT_SORT_SETTINGS.direction;
let savedJiraSettings: JiraImportSettings | null = null;

const elements = {
  undoneCount: getElement<HTMLElement>("undoneCount"),
  chooseFileButton: getElement<HTMLButtonElement>("chooseFileButton"),
  copyLinkButton: getElement<HTMLButtonElement>("copyLinkButton"),
  createTestTaskButton: getElement<HTMLButtonElement>("createTestTaskButton"),
  nukeListButton: getElement<HTMLButtonElement>("nukeListButton"),
  saveFileButton: getElement<HTMLButtonElement>("saveFileButton"),
  exportButton: getElement<HTMLButtonElement>("exportButton"),
  importInput: getElement<HTMLInputElement>("importInput"),
  firstRunPanel: getElement<HTMLElement>("firstRunPanel"),
  firstRunChooseButton: getElement<HTMLButtonElement>("firstRunChooseButton"),
  firstRunSkipButton: getElement<HTMLButtonElement>("firstRunSkipButton"),
  microsoftTokenInput: getElement<HTMLInputElement>("microsoftTokenInput"),
  importMicrosoftButton: getElement<HTMLButtonElement>("importMicrosoftButton"),
  jiraSiteInput: getElement<HTMLInputElement>("jiraSiteInput"),
  jiraEmailInput: getElement<HTMLInputElement>("jiraEmailInput"),
  jiraTokenInput: getElement<HTMLInputElement>("jiraTokenInput"),
  jiraJqlInput: getElement<HTMLTextAreaElement>("jiraJqlInput"),
  importJiraButton: getElement<HTMLButtonElement>("importJiraButton"),
  refreshJiraButton: getElement<HTMLButtonElement>("refreshJiraButton"),
  jiraSavedStatus: getElement<HTMLElement>("jiraSavedStatus"),
  sortFieldSelect: getElement<HTMLSelectElement>("sortFieldSelect"),
  sortDirectionSelect: getElement<HTMLSelectElement>("sortDirectionSelect"),
  showArchivedInput: getElement<HTMLInputElement>("showArchivedInput"),
  status: getElement<HTMLElement>("status"),
  taskList: getElement<HTMLUListElement>("taskList"),
  emptyState: getElement<HTMLElement>("emptyState"),
  emptyTitle: getElement<HTMLElement>("emptyTitle"),
  emptyMessage: getElement<HTMLElement>("emptyMessage"),
  taskTemplate: getElement<HTMLTemplateElement>("taskTemplate"),
  screenshotDialog: getElement<HTMLDialogElement>("screenshotDialog"),
  dialogImage: getElement<HTMLImageElement>("dialogImage")
};

document.addEventListener("DOMContentLoaded", () => {
  void initialize();
});

async function initialize(): Promise<void> {
  bindRuntimeEvents();
  bindEvents();
  await showFirstRunPanelIfNeeded();
  await loadSortSettings();
  await loadJiraImportSettings();
  await refreshTasks();
}

function bindRuntimeEvents(): void {
  if (typeof chrome === "undefined" || !chrome.runtime?.onMessage) {
    return;
  }

  chrome.runtime.onMessage.addListener((message: any) => {
    if (message?.type === TASKS_CHANGED_MESSAGE) {
      void refreshFromExternalChange();
      return false;
    }
    return false;
  });
}

function bindEvents(): void {
  elements.chooseFileButton.addEventListener("click", () => {
    void chooseSaveFile();
  });
  elements.copyLinkButton.addEventListener("click", () => {
    void copyTaskListLink();
  });
  elements.createTestTaskButton.addEventListener("click", () => {
    void createTestTask();
  });
  elements.nukeListButton.addEventListener("click", () => {
    void nukeTaskList();
  });
  elements.firstRunChooseButton.addEventListener("click", () => {
    void chooseSaveFile();
  });
  elements.firstRunSkipButton.addEventListener("click", () => {
    void markFirstRunComplete();
  });
  elements.importMicrosoftButton.addEventListener("click", () => {
    void importMicrosoftTodo();
  });
  elements.importJiraButton.addEventListener("click", () => {
    void importJiraTasks();
  });
  elements.refreshJiraButton.addEventListener("click", () => {
    void refreshJiraTasks();
  });
  elements.saveFileButton.addEventListener("click", () => {
    void syncToChosenFile(true);
  });
  elements.exportButton.addEventListener("click", () => {
    void exportJsonBackup();
  });
  elements.importInput.addEventListener("change", () => {
    void importJsonBackup();
  });
  elements.showArchivedInput.addEventListener("change", () => {
    showArchived = elements.showArchivedInput.checked;
    renderTasks();
  });
  elements.sortFieldSelect.addEventListener("change", () => {
    activeSortField = getSortField(elements.sortFieldSelect.value);
    updateSortControls();
    renderTasks();
    void saveSortSettings();
  });
  elements.sortDirectionSelect.addEventListener("change", () => {
    activeSortDirection = getSortDirection(elements.sortDirectionSelect.value);
    updateSortControls();
    renderTasks();
    void saveSortSettings();
  });

  document.querySelectorAll<HTMLButtonElement>(".filter-button").forEach((button) => {
    button.addEventListener("click", () => {
      activeFilter = button.dataset.filter as TaskFilter;
      renderTasks();
    });
  });
}

async function showFirstRunPanelIfNeeded(): Promise<void> {
  const setupSeen = await getSetting<boolean>("fileSetupSeen");
  elements.firstRunPanel.hidden = Boolean(setupSeen);
}

async function loadSortSettings(): Promise<void> {
  const settings = await getSetting<SortSettings>(SORT_SETTINGS_KEY);

  if (isSortSettings(settings)) {
    activeSortField = settings.field;
    activeSortDirection = settings.direction;
  }

  updateSortControls();
}

async function saveSortSettings(): Promise<void> {
  await setSetting(SORT_SETTINGS_KEY, {
    field: activeSortField,
    direction: activeSortDirection
  });
}

async function loadJiraImportSettings(): Promise<void> {
  const settings = await getSetting<JiraImportSettings>(JIRA_IMPORT_SETTINGS_KEY);

  if (isJiraImportSettings(settings)) {
    savedJiraSettings = settings;
    elements.jiraSiteInput.value = settings.siteUrl;
    elements.jiraEmailInput.value = settings.email;
    elements.jiraJqlInput.value = settings.jql;
  } else if (!elements.jiraJqlInput.value.trim()) {
    elements.jiraJqlInput.value = DEFAULT_JIRA_JQL;
  }

  updateJiraSavedStatus();
}

async function markFirstRunComplete(): Promise<void> {
  await setSetting("fileSetupSeen", true);
  elements.firstRunPanel.hidden = true;
  setStatus("Using IndexedDB for WebOn task storage.");
}

async function refreshTasks(): Promise<void> {
  tasks = await getAllTasks();
  renderTasks();
}

function renderTasks(): void {
  updateFilterButtons();
  updateSortControls();

  const visibleTasks = getVisibleTasks();
  const undoneCount = tasks.filter((task) => !task.done && !task.archived).length;
  elements.undoneCount.textContent =
    undoneCount === 1 ? "1 undone task" : `${undoneCount} undone tasks`;

  elements.taskList.replaceChildren();
  updateEmptyState(visibleTasks);

  visibleTasks.forEach((task, index) => {
    elements.taskList.append(renderTask(task, index, visibleTasks.length));
  });
}

function updateEmptyState(visibleTasks: TodoTask[]): void {
  const hasVisibleTasks = visibleTasks.length > 0;
  elements.emptyState.hidden = hasVisibleTasks;

  if (hasVisibleTasks) {
    return;
  }

  const unarchivedTasks = tasks.filter((task) => !task.archived);

  if (!showArchived && tasks.length > 0 && unarchivedTasks.length === 0) {
    elements.emptyTitle.textContent = "All tasks are archived";
    elements.emptyMessage.textContent = "Archived tasks are hidden from this view.";
    return;
  }

  if (tasks.length === 0) {
    elements.emptyTitle.textContent = "No tasks yet";
    elements.emptyMessage.textContent =
      "Captured pages and selections will appear here.";
    return;
  }

  if (activeFilter === "todo") {
    elements.emptyTitle.textContent = "No to-do tasks";
    elements.emptyMessage.textContent =
      "Open tasks that are not done will appear here.";
    return;
  }

  if (activeFilter === "done") {
    elements.emptyTitle.textContent = "No done tasks";
    elements.emptyMessage.textContent =
      "Completed tasks will appear here.";
    return;
  }

  elements.emptyTitle.textContent = "No tasks match this view";
  elements.emptyMessage.textContent = "Adjust the filter to see more tasks.";
}

function renderTask(
  task: TodoTask,
  index: number,
  visibleCount: number
): HTMLElement {
  const item = elements.taskTemplate.content.firstElementChild?.cloneNode(
    true
  ) as HTMLElement;

  item.dataset.taskId = task.id;
  item.classList.toggle("is-done", task.done);
  item.classList.toggle("is-overdue", isOverdue(task));
  item.classList.toggle("is-stale", isStaleWithoutDueDate(task));

  const doneCheckbox = query<HTMLInputElement>(item, ".done-checkbox");
  const title = query<HTMLElement>(item, ".task-title");
  const due = query<HTMLElement>(item, ".task-due");
  const created = query<HTMLElement>(item, ".task-created");
  const notes = query<HTMLElement>(item, ".task-notes");
  const sourceLink = query<HTMLAnchorElement>(item, ".source-link");
  const moveUp = query<HTMLButtonElement>(item, ".move-up");
  const moveDown = query<HTMLButtonElement>(item, ".move-down");
  const archiveButton = query<HTMLButtonElement>(item, ".archive-button");
  const canMoveTask = activeSortField === "manual";

  doneCheckbox.checked = task.done;
  title.textContent = task.name;
  due.textContent = task.dueDate ? formatDateOnly(task.dueDate) : "None";
  created.textContent = formatDateTime(task.createdAt);
  notes.textContent = task.notes || task.selectedText;

  if (task.pageUrl) {
    sourceLink.href = task.pageUrl;
    sourceLink.textContent = task.pageTitle || task.pageUrl;
  } else {
    sourceLink.hidden = true;
  }

  moveUp.disabled = !canMoveTask || index === 0;
  moveDown.disabled = !canMoveTask || index === visibleCount - 1;
  moveUp.title = canMoveTask ? "" : "Switch to manual sort to move tasks";
  moveDown.title = canMoveTask ? "" : "Switch to manual sort to move tasks";
  archiveButton.textContent = task.archived ? "Restore" : "Archive";

  doneCheckbox.addEventListener("change", () => {
    void updateTask(task.id, { done: doneCheckbox.checked });
  });
  moveUp.addEventListener("click", () => {
    void moveTask(task.id, -1);
  });
  moveDown.addEventListener("click", () => {
    void moveTask(task.id, 1);
  });
  archiveButton.addEventListener("click", () => {
    void updateTask(task.id, { archived: !task.archived });
  });

  void hydrateScreenshot(item, task);
  return item;
}

async function hydrateScreenshot(item: HTMLElement, task: TodoTask): Promise<void> {
  if (!task.screenshotId) {
    return;
  }

  const button = query<HTMLButtonElement>(item, ".thumbnail-button");
  const image = query<HTMLImageElement>(item, ".screenshot");
  const screenshot = await getScreenshot(task.screenshotId);

  if (!screenshot || !item.isConnected) {
    return;
  }

  image.src = screenshot.dataUrl;
  button.hidden = false;
  button.addEventListener("click", () => {
    elements.dialogImage.src = screenshot.dataUrl;
    if (typeof elements.screenshotDialog.showModal === "function") {
      elements.screenshotDialog.showModal();
    } else {
      window.open(screenshot.dataUrl, "_blank", "noopener");
    }
  });
}

async function updateTask(
  taskId: string,
  changes: Partial<TodoTask>
): Promise<void> {
  const task = tasks.find((candidate) => candidate.id === taskId);
  if (!task) {
    return;
  }

  await saveTask({ ...task, ...changes });
  await refreshTasks();
  await syncToChosenFile(false);
  notifyTasksChangedFromApp();
}

async function moveTask(taskId: string, direction: -1 | 1): Promise<void> {
  if (activeSortField !== "manual") {
    setStatus("Switch to manual sort to move tasks.");
    return;
  }

  const visibleTasks = getVisibleTasks();
  const currentIndex = visibleTasks.findIndex((task) => task.id === taskId);
  const targetIndex = currentIndex + direction;
  const current = visibleTasks[currentIndex];
  const target = visibleTasks[targetIndex];

  if (!current || !target) {
    return;
  }

  const currentOrder = current.order;
  current.order = target.order;
  target.order = currentOrder;

  await saveTasks([current, target]);
  await refreshTasks();
  await syncToChosenFile(false);
  notifyTasksChangedFromApp();
}

function getVisibleTasks(): TodoTask[] {
  return tasks
    .filter((task) => showArchived || !task.archived)
    .filter((task) => {
      if (activeFilter === "todo") {
        return !task.done;
      }
      if (activeFilter === "done") {
        return task.done;
      }
      return true;
    })
    .sort(compareTasks);
}

function updateFilterButtons(): void {
  document.querySelectorAll<HTMLButtonElement>(".filter-button").forEach((button) => {
    const isActive = button.dataset.filter === activeFilter;
    button.classList.toggle("is-active", isActive);
    button.setAttribute("aria-pressed", String(isActive));
  });
}

function updateSortControls(): void {
  elements.sortFieldSelect.value = activeSortField;
  if (activeSortField === "manual") {
    elements.sortDirectionSelect.value = "manual";
    elements.sortDirectionSelect.disabled = true;
    return;
  }

  elements.sortDirectionSelect.disabled = false;
  elements.sortDirectionSelect.value = activeSortDirection;
}

function compareTasks(left: TodoTask, right: TodoTask): number {
  if (activeSortField === "manual") {
    return compareManualOrder(left, right, "asc");
  }

  const primary =
    activeSortField === "createdAt"
      ? compareIsoDateTime(left.createdAt, right.createdAt, activeSortDirection)
      : compareDueDate(left, right, activeSortDirection);

  return primary || compareManualOrder(left, right, "asc");
}

function compareManualOrder(
  left: TodoTask,
  right: TodoTask,
  direction: SortDirection
): number {
  const orderCompare = left.order - right.order;
  const result = orderCompare || left.createdAt.localeCompare(right.createdAt);
  return applySortDirection(result, direction);
}

function compareIsoDateTime(
  leftValue: string,
  rightValue: string,
  direction: SortDirection
): number {
  const leftTime = new Date(leftValue).getTime();
  const rightTime = new Date(rightValue).getTime();
  const leftComparable = Number.isNaN(leftTime) ? 0 : leftTime;
  const rightComparable = Number.isNaN(rightTime) ? 0 : rightTime;

  return applySortDirection(leftComparable - rightComparable, direction);
}

function compareDueDate(
  left: TodoTask,
  right: TodoTask,
  direction: SortDirection
): number {
  if (!left.dueDate && !right.dueDate) {
    return 0;
  }
  if (!left.dueDate) {
    return 1;
  }
  if (!right.dueDate) {
    return -1;
  }

  return applySortDirection(left.dueDate.localeCompare(right.dueDate), direction);
}

function applySortDirection(value: number, direction: SortDirection): number {
  return direction === "asc" ? value : -value;
}

function isOverdue(task: TodoTask): boolean {
  return Boolean(!task.done && task.dueDate && task.dueDate < todayString());
}

function isStaleWithoutDueDate(task: TodoTask): boolean {
  return Boolean(
    !task.done &&
      !task.dueDate &&
      Date.now() - new Date(task.createdAt).getTime() > ONE_WEEK_MS
  );
}

async function chooseSaveFile(): Promise<void> {
  // File System Access is optional; IndexedDB remains the primary local store.
  if (!window.showSaveFilePicker) {
    await markFirstRunComplete();
    setStatus("File picker unavailable here; export and import JSON backups instead.");
    return;
  }

  try {
    const handle = await window.showSaveFilePicker({
      suggestedName: DEFAULT_FILE_NAME,
      types: [
        {
          description: "JSON backup",
          accept: { "application/json": [".json"] }
        }
      ]
    });

    await setSetting("fileHandle", handle);
    await setSetting("fileSetupSeen", true);
    elements.firstRunPanel.hidden = true;
    await writeBackupToHandle(handle);
    setStatus(`Saving local backups to ${DEFAULT_FILE_NAME}.`);
  } catch (error) {
    if (!isAbortError(error)) {
      setStatus(getErrorMessage(error));
    }
  }
}

async function syncToChosenFile(showResult: boolean): Promise<boolean> {
  const handle = await getSetting<SaveFileHandle>("fileHandle");
  if (!handle) {
    if (showResult) {
      setStatus("Choose a save file first, or use Export JSON.");
    }
    return false;
  }

  try {
    await writeBackupToHandle(handle);
    if (showResult) {
      setStatus("Saved JSON backup.");
    }
    return true;
  } catch (error) {
    setStatus(getErrorMessage(error));
    return false;
  }
}

async function writeBackupToHandle(handle: SaveFileHandle): Promise<void> {
  // The selected file mirrors the IndexedDB state as a portable JSON backup.
  if (!(await ensureWritablePermission(handle))) {
    throw new Error("Permission to write the selected file was not granted.");
  }

  const writable = await handle.createWritable();
  const backup = await exportBackup();
  await writable.write(
    new Blob([JSON.stringify(backup, null, 2)], {
      type: "application/json"
    })
  );
  await writable.close();
}

async function ensureWritablePermission(handle: SaveFileHandle): Promise<boolean> {
  const options = { mode: "readwrite" as const };
  if (!handle.queryPermission || !handle.requestPermission) {
    return true;
  }

  if ((await handle.queryPermission(options)) === "granted") {
    return true;
  }

  return (await handle.requestPermission(options)) === "granted";
}

async function exportJsonBackup(): Promise<void> {
  const backup = await exportBackup();
  const blob = new Blob([JSON.stringify(backup, null, 2)], {
    type: "application/json"
  });
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement("a");
  anchor.href = url;
  anchor.download = DEFAULT_FILE_NAME;
  document.body.append(anchor);
  anchor.click();
  anchor.remove();
  window.setTimeout(() => URL.revokeObjectURL(url), 1000);
  setStatus("Exported JSON backup.");
}

async function copyTaskListLink(): Promise<void> {
  const link = getTaskListLink();

  try {
    await navigator.clipboard.writeText(link);
    setStatus("Copied WebOn task list link.");
  } catch {
    setStatus(link);
  }
}

async function createTestTask(): Promise<void> {
  const createdAt = new Date().toISOString();
  await saveTask({
    id: createId("task"),
    name: "WebOn test task",
    dueDate: null,
    notes: "Created from the WebOn task page to verify local storage and list rendering.",
    selectedText: "",
    pageTitle: "WebOn",
    pageUrl: getTaskListLink(),
    createdAt,
    screenshotId: null,
    done: false,
    archived: false,
    order: await getNextOrder()
  });

  await refreshTasks();
  await syncToChosenFile(false);
  setStatus("Created a WebOn test task.");
  notifyTasksChangedFromApp();
}

async function nukeTaskList(): Promise<void> {
  if (tasks.length === 0) {
    setStatus("The WebOn task list is already empty.");
    return;
  }

  const confirmed = window.confirm(
    "Nuke the whole WebOn task list? This deletes all local tasks and screenshots. Saved Jira settings stay."
  );
  if (!confirmed) {
    setStatus("Kept the WebOn task list.");
    return;
  }

  await clearTaskData();
  await refreshTasks();
  await syncToChosenFile(false);
  setStatus("Nuked the local WebOn task list.");
  notifyTasksChangedFromApp();
}

async function importMicrosoftTodo(): Promise<void> {
  const token = elements.microsoftTokenInput.value.trim();
  if (!token) {
    setStatus("Paste a Microsoft Graph access token first.");
    return;
  }

  setImportBusy(elements.importMicrosoftButton, true);
  setStatus("Importing Microsoft To Do tasks...");

  try {
    const lists = await fetchMicrosoftLists(token);
    const importedTasks: ImportedTask[] = [];

    for (const list of lists) {
      const listTasks = await fetchMicrosoftTasks(token, list.id);
      for (const task of listTasks) {
        importedTasks.push(mapMicrosoftTask(list, task));
      }
    }

    const result = await saveImportedTasks(importedTasks);
    elements.microsoftTokenInput.value = "";
    setStatus(formatImportResult("Microsoft To Do", result));
  } catch (error) {
    setStatus(getErrorMessage(error));
  } finally {
    setImportBusy(elements.importMicrosoftButton, false);
  }
}

async function importJiraTasks(): Promise<void> {
  const settings = collectJiraSettingsFromForm();

  if (!settings) {
    setStatus("Fill in Jira site URL, email, API token, and JQL.");
    return;
  }

  setJiraBusy(true);
  setStatus("Importing Jira tasks...");

  try {
    const issues = await fetchJiraIssues(
      settings.siteUrl,
      settings.email,
      settings.token,
      settings.jql
    );
    const result = await saveImportedTasks(
      issues.map((issue) => mapJiraIssue(settings.siteUrl, issue))
    );
    await saveJiraImportSettings(settings);
    elements.jiraTokenInput.value = "";
    setStatus(`${formatImportResult("Jira", result)} Saved Jira settings locally.`);
  } catch (error) {
    setStatus(getErrorMessage(error));
  } finally {
    setJiraBusy(false);
  }
}

async function refreshJiraTasks(): Promise<void> {
  const settings = savedJiraSettings;
  if (!settings) {
    setStatus("Save Jira settings with Import Jira first.");
    return;
  }

  setJiraBusy(true);
  setStatus("Refreshing Jira tasks...");

  try {
    const issues = await fetchJiraIssues(
      settings.siteUrl,
      settings.email,
      settings.token,
      settings.jql
    );
    const result = await saveImportedTasks(
      issues.map((issue) => mapJiraIssue(settings.siteUrl, issue))
    );
    await saveJiraImportSettings({
      ...settings,
      savedAt: new Date().toISOString()
    });
    setStatus(formatImportResult("Jira refresh", result));
  } catch (error) {
    setStatus(getErrorMessage(error));
  } finally {
    setJiraBusy(false);
  }
}

function collectJiraSettingsFromForm(): JiraImportSettings | null {
  const siteUrl = normalizeJiraSiteUrl(elements.jiraSiteInput.value);
  const email = elements.jiraEmailInput.value.trim();
  const token = elements.jiraTokenInput.value.trim() || savedJiraSettings?.token || "";
  const jql = elements.jiraJqlInput.value.trim();

  if (!siteUrl || !email || !token || !jql) {
    return null;
  }

  return {
    siteUrl,
    email,
    token,
    jql,
    savedAt: new Date().toISOString()
  };
}

async function saveJiraImportSettings(
  settings: JiraImportSettings
): Promise<void> {
  await setSetting(JIRA_IMPORT_SETTINGS_KEY, settings);
  savedJiraSettings = settings;
  elements.jiraSiteInput.value = settings.siteUrl;
  elements.jiraEmailInput.value = settings.email;
  elements.jiraJqlInput.value = settings.jql;
  updateJiraSavedStatus();
}

function updateJiraSavedStatus(): void {
  const hasSavedSettings = Boolean(savedJiraSettings);
  elements.refreshJiraButton.disabled = !hasSavedSettings;
  elements.jiraTokenInput.placeholder = hasSavedSettings
    ? "Saved locally; leave blank to reuse"
    : "";

  elements.jiraSavedStatus.textContent = savedJiraSettings
    ? `Saved locally for ${savedJiraSettings.siteUrl} on ${formatDateTime(
        savedJiraSettings.savedAt
      )}.`
    : "No saved Jira settings.";
}

function isJiraImportSettings(value: unknown): value is JiraImportSettings {
  if (!value || typeof value !== "object") {
    return false;
  }

  const settings = value as Partial<JiraImportSettings>;
  return Boolean(
    settings.siteUrl &&
      settings.email &&
      settings.token &&
      settings.jql &&
      settings.savedAt
  );
}

function isSortSettings(value: unknown): value is SortSettings {
  if (!value || typeof value !== "object") {
    return false;
  }

  const settings = value as Partial<SortSettings>;
  return Boolean(
    settings.field &&
      settings.direction &&
      ["manual", "createdAt", "dueDate"].includes(settings.field) &&
      ["asc", "desc"].includes(settings.direction)
  );
}

function getSortField(value: string): TaskSortField {
  return value === "createdAt" || value === "dueDate" ? value : "manual";
}

function getSortDirection(value: string): SortDirection {
  return value === "desc" ? "desc" : "asc";
}

async function fetchMicrosoftLists(token: string): Promise<any[]> {
  const data = await fetchJsonWithBearer(
    "https://graph.microsoft.com/v1.0/me/todo/lists",
    token
  );
  return Array.isArray(data.value) ? data.value : [];
}

async function fetchMicrosoftTasks(
  token: string,
  listId: string
): Promise<any[]> {
  const tasks: any[] = [];
  let nextUrl:
    | string
    | null = `https://graph.microsoft.com/v1.0/me/todo/lists/${encodeURIComponent(
    listId
  )}/tasks?$top=100`;

  while (nextUrl) {
    const data = await fetchJsonWithBearer(nextUrl, token);
    tasks.push(...(Array.isArray(data.value) ? data.value : []));
    nextUrl = typeof data["@odata.nextLink"] === "string"
      ? data["@odata.nextLink"]
      : null;
  }

  return tasks;
}

async function fetchJsonWithBearer(url: string, token: string): Promise<any> {
  const response = await fetch(url, {
    headers: {
      Authorization: `Bearer ${token}`,
      Accept: "application/json"
    }
  });
  return readJsonResponse(response);
}

function mapMicrosoftTask(list: any, task: any): ImportedTask {
  const listName = list.displayName || "Tasks";
  const body = stripHtml(task.body?.content || "");
  const notes = joinLines([`List: ${listName}`, body]);

  return {
    name: task.title || "Untitled Microsoft To Do task",
    dueDate: parseDateOnly(task.dueDateTime?.dateTime),
    notes,
    pageTitle: `Microsoft To Do - ${listName}`,
    pageUrl: "",
    createdAt: normalizeDateTime(task.createdDateTime),
    done: task.status === "completed",
    sourceKey: `microsoft-todo:${list.id}:${task.id}`,
    sourceName: "Microsoft To Do"
  };
}

async function fetchJiraIssues(
  siteUrl: string,
  email: string,
  token: string,
  jql: string
): Promise<any[]> {
  const issues: any[] = [];
  let nextPageToken: string | null = null;
  const auth = btoa(`${email}:${token}`);

  do {
    const url = new URL(`${siteUrl}/rest/api/3/search/jql`);
    url.searchParams.set("jql", jql);
    url.searchParams.set("maxResults", "100");
    url.searchParams.set(
      "fields",
      "summary,status,duedate,description,assignee,priority,created"
    );
    if (nextPageToken) {
      url.searchParams.set("nextPageToken", nextPageToken);
    }

    const response = await fetch(url.toString(), {
      headers: {
        Authorization: `Basic ${auth}`,
        Accept: "application/json"
      }
    });
    const data = await readJsonResponse(response);
    issues.push(...(Array.isArray(data.issues) ? data.issues : []));
    nextPageToken = typeof data.nextPageToken === "string"
      ? data.nextPageToken
      : null;
  } while (nextPageToken);

  return issues;
}

function mapJiraIssue(siteUrl: string, issue: any): ImportedTask {
  const fields = issue.fields || {};
  const issueUrl = `${siteUrl}/browse/${issue.key}`;
  const status = fields.status?.name ? `Status: ${fields.status.name}` : "";
  const priority = fields.priority?.name ? `Priority: ${fields.priority.name}` : "";
  const assignee = fields.assignee?.displayName
    ? `Assignee: ${fields.assignee.displayName}`
    : "";
  const description = extractAdfText(fields.description);

  return {
    name: `${issue.key}: ${fields.summary || "Untitled Jira issue"}`,
    dueDate: fields.duedate || null,
    notes: joinLines([status, priority, assignee, description]),
    pageTitle: "Jira",
    pageUrl: issueUrl,
    createdAt: normalizeDateTime(fields.created),
    done: fields.status?.statusCategory?.key === "done",
    sourceKey: `jira:${siteUrl}:${issue.key}`,
    sourceName: "Jira"
  };
}

async function saveImportedTasks(
  importedTasks: ImportedTask[]
): Promise<ImportResult> {
  const existingTasks = await getAllTasks();
  const existingTasksBySourceKey = new Map(
    existingTasks
      .filter((task) => Boolean(task.sourceKey))
      .map((task) => [task.sourceKey as string, task])
  );

  let order = await getNextOrder();
  let imported = 0;
  let updated = 0;
  let skipped = 0;

  for (const importedTask of importedTasks) {
    const existingTask = existingTasksBySourceKey.get(importedTask.sourceKey);

    if (existingTask) {
      const refreshedTask = {
        ...existingTask,
        name: importedTask.name,
        dueDate: importedTask.dueDate,
        notes: importedTask.notes,
        pageTitle: importedTask.pageTitle,
        pageUrl: importedTask.pageUrl,
        createdAt: importedTask.createdAt,
        done: existingTask.done || importedTask.done,
        sourceName: importedTask.sourceName
      };

      if (hasTaskChanges(existingTask, refreshedTask)) {
        await saveTask(refreshedTask);
        updated += 1;
      } else {
        skipped += 1;
      }
      continue;
    }

    const newTask: TodoTask = {
      id: createId("task"),
      name: importedTask.name,
      dueDate: importedTask.dueDate,
      notes: importedTask.notes,
      selectedText: "",
      pageTitle: importedTask.pageTitle,
      pageUrl: importedTask.pageUrl,
      createdAt: importedTask.createdAt,
      screenshotId: null,
      done: importedTask.done,
      archived: false,
      order,
      sourceKey: importedTask.sourceKey,
      sourceName: importedTask.sourceName
    };

    await saveTask(newTask);
    existingTasksBySourceKey.set(importedTask.sourceKey, newTask);
    order += 1;
    imported += 1;
  }

  await refreshTasks();
  await syncToChosenFile(false);
  notifyTasksChangedFromApp();

  return { imported, updated, skipped };
}

function hasTaskChanges(task: TodoTask, nextTask: TodoTask): boolean {
  return (
    task.name !== nextTask.name ||
    task.dueDate !== nextTask.dueDate ||
    task.notes !== nextTask.notes ||
    task.pageTitle !== nextTask.pageTitle ||
    task.pageUrl !== nextTask.pageUrl ||
    task.createdAt !== nextTask.createdAt ||
    task.done !== nextTask.done ||
    task.sourceName !== nextTask.sourceName
  );
}

async function readJsonResponse(response: Response): Promise<any> {
  const text = await response.text();
  const data = text ? JSON.parse(text) : {};

  if (!response.ok) {
    const message =
      data.error?.message ||
      data.errorMessages?.join(" ") ||
      data.message ||
      response.statusText;
    throw new Error(`${response.status}: ${message}`);
  }

  return data;
}

function normalizeJiraSiteUrl(value: string): string {
  const trimmed = value.trim().replace(/\/+$/, "");
  if (!trimmed) {
    return "";
  }
  return /^https?:\/\//i.test(trimmed) ? trimmed : `https://${trimmed}`;
}

function parseDateOnly(value: unknown): string | null {
  if (typeof value !== "string") {
    return null;
  }
  const match = value.match(/^\d{4}-\d{2}-\d{2}/);
  return match ? match[0] : null;
}

function normalizeDateTime(value: unknown): string {
  if (typeof value !== "string") {
    return new Date().toISOString();
  }
  const parsed = new Date(value);
  return Number.isNaN(parsed.getTime()) ? new Date().toISOString() : parsed.toISOString();
}

function extractAdfText(value: unknown): string {
  const pieces: string[] = [];

  const visit = (node: any) => {
    if (!node) {
      return;
    }
    if (typeof node === "string") {
      pieces.push(node);
      return;
    }
    if (typeof node.text === "string") {
      pieces.push(node.text);
    }
    if (Array.isArray(node.content)) {
      for (const child of node.content) {
        visit(child);
      }
    }
  };

  visit(value);
  return pieces.join(" ").replace(/\s+/g, " ").trim();
}

function stripHtml(value: string): string {
  const document = new DOMParser().parseFromString(value, "text/html");
  return document.body.textContent?.replace(/\s+/g, " ").trim() || "";
}

function joinLines(lines: string[]): string {
  return lines
    .map((line) => line.trim())
    .filter(Boolean)
    .join("\n");
}

function formatImportResult(source: string, result: ImportResult): string {
  return `${source}: imported ${result.imported}, updated ${result.updated}, skipped ${result.skipped}.`;
}

function setImportBusy(button: HTMLButtonElement, busy: boolean): void {
  button.disabled = busy;
}

function setJiraBusy(busy: boolean): void {
  elements.importJiraButton.disabled = busy;
  elements.refreshJiraButton.disabled = busy || !savedJiraSettings;
}

function getTaskListLink(): string {
  if (typeof chrome !== "undefined" && chrome.runtime?.getURL) {
    return chrome.runtime.getURL("app.html");
  }
  return window.location.href;
}

async function importJsonBackup(): Promise<void> {
  const file = elements.importInput.files?.[0];
  if (!file) {
    return;
  }

  try {
    const data = JSON.parse(await file.text()) as BackupData;
    await importBackup(data);
    await refreshTasks();
    await syncToChosenFile(false);
    setStatus("Imported JSON backup.");
    notifyTasksChangedFromApp();
  } catch (error) {
    setStatus(getErrorMessage(error));
  } finally {
    elements.importInput.value = "";
  }
}

async function refreshFromExternalChange(): Promise<void> {
  await refreshTasks();
  await syncToChosenFile(false);
}

function notifyTasksChangedFromApp(): void {
  if (typeof chrome === "undefined" || !chrome.runtime?.sendMessage) {
    return;
  }

  chrome.runtime.sendMessage(
    { type: TASKS_CHANGED_FROM_APP_MESSAGE, changedAt: new Date().toISOString() },
    () => {
      void chrome.runtime.lastError;
    }
  );
}

function formatDateTime(value: string): string {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) {
    return "Unknown";
  }
  return new Intl.DateTimeFormat(undefined, {
    dateStyle: "medium",
    timeStyle: "short"
  }).format(date);
}

function formatDateOnly(value: string): string {
  const [year, month, day] = value.split("-").map(Number);
  if (!year || !month || !day) {
    return value;
  }
  return new Intl.DateTimeFormat(undefined, { dateStyle: "medium" }).format(
    new Date(year, month - 1, day)
  );
}

function todayString(): string {
  const today = new Date();
  const month = String(today.getMonth() + 1).padStart(2, "0");
  const day = String(today.getDate()).padStart(2, "0");
  return `${today.getFullYear()}-${month}-${day}`;
}

function setStatus(message: string): void {
  elements.status.textContent = message;
}

function isAbortError(error: unknown): boolean {
  return error instanceof DOMException && error.name === "AbortError";
}

function getErrorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

function getElement<T extends HTMLElement>(id: string): T {
  const element = document.getElementById(id);
  if (!element) {
    throw new Error(`Missing element: ${id}`);
  }
  return element as T;
}

function query<T extends Element>(root: Element, selector: string): T {
  const element = root.querySelector<T>(selector);
  if (!element) {
    throw new Error(`Missing task element: ${selector}`);
  }
  return element;
}
