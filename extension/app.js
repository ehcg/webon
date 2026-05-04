import { exportBackup, getAllTasks, getScreenshot, getSetting, importBackup, saveTask, saveTasks, setSetting } from "./db.js";
const DEFAULT_FILE_NAME = "webon-data.json";
const ONE_WEEK_MS = 7 * 24 * 60 * 60 * 1000;
let tasks = [];
let activeFilter = "all";
let showArchived = false;
const elements = {
    undoneCount: getElement("undoneCount"),
    chooseFileButton: getElement("chooseFileButton"),
    copyLinkButton: getElement("copyLinkButton"),
    saveFileButton: getElement("saveFileButton"),
    exportButton: getElement("exportButton"),
    importInput: getElement("importInput"),
    firstRunPanel: getElement("firstRunPanel"),
    firstRunChooseButton: getElement("firstRunChooseButton"),
    firstRunSkipButton: getElement("firstRunSkipButton"),
    showArchivedInput: getElement("showArchivedInput"),
    status: getElement("status"),
    taskList: getElement("taskList"),
    emptyState: getElement("emptyState"),
    emptyTitle: getElement("emptyTitle"),
    emptyMessage: getElement("emptyMessage"),
    taskTemplate: getElement("taskTemplate"),
    screenshotDialog: getElement("screenshotDialog"),
    dialogImage: getElement("dialogImage")
};
document.addEventListener("DOMContentLoaded", () => {
    void initialize();
});
async function initialize() {
    bindEvents();
    await showFirstRunPanelIfNeeded();
    await refreshTasks();
}
function bindEvents() {
    elements.chooseFileButton.addEventListener("click", () => {
        void chooseSaveFile();
    });
    elements.copyLinkButton.addEventListener("click", () => {
        void copyTaskListLink();
    });
    elements.firstRunChooseButton.addEventListener("click", () => {
        void chooseSaveFile();
    });
    elements.firstRunSkipButton.addEventListener("click", () => {
        void markFirstRunComplete();
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
    document.querySelectorAll(".filter-button").forEach((button) => {
        button.addEventListener("click", () => {
            activeFilter = button.dataset.filter;
            renderTasks();
        });
    });
}
async function showFirstRunPanelIfNeeded() {
    const setupSeen = await getSetting("fileSetupSeen");
    elements.firstRunPanel.hidden = Boolean(setupSeen);
}
async function markFirstRunComplete() {
    await setSetting("fileSetupSeen", true);
    elements.firstRunPanel.hidden = true;
    setStatus("Using IndexedDB for WebOn task storage.");
}
async function refreshTasks() {
    tasks = await getAllTasks();
    renderTasks();
}
function renderTasks() {
    updateFilterButtons();
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
function updateEmptyState(visibleTasks) {
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
function renderTask(task, index, visibleCount) {
    const item = elements.taskTemplate.content.firstElementChild?.cloneNode(true);
    item.dataset.taskId = task.id;
    item.classList.toggle("is-done", task.done);
    item.classList.toggle("is-overdue", isOverdue(task));
    item.classList.toggle("is-stale", isStaleWithoutDueDate(task));
    const doneCheckbox = query(item, ".done-checkbox");
    const title = query(item, ".task-title");
    const due = query(item, ".task-due");
    const created = query(item, ".task-created");
    const notes = query(item, ".task-notes");
    const sourceLink = query(item, ".source-link");
    const moveUp = query(item, ".move-up");
    const moveDown = query(item, ".move-down");
    const archiveButton = query(item, ".archive-button");
    doneCheckbox.checked = task.done;
    title.textContent = task.name;
    due.textContent = task.dueDate ? formatDateOnly(task.dueDate) : "None";
    created.textContent = formatDateTime(task.createdAt);
    notes.textContent = task.notes || task.selectedText;
    if (task.pageUrl) {
        sourceLink.href = task.pageUrl;
        sourceLink.textContent = task.pageTitle || task.pageUrl;
    }
    else {
        sourceLink.hidden = true;
    }
    moveUp.disabled = index === 0;
    moveDown.disabled = index === visibleCount - 1;
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
async function hydrateScreenshot(item, task) {
    if (!task.screenshotId) {
        return;
    }
    const button = query(item, ".thumbnail-button");
    const image = query(item, ".screenshot");
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
        }
        else {
            window.open(screenshot.dataUrl, "_blank", "noopener");
        }
    });
}
async function updateTask(taskId, changes) {
    const task = tasks.find((candidate) => candidate.id === taskId);
    if (!task) {
        return;
    }
    await saveTask({ ...task, ...changes });
    await refreshTasks();
    await syncToChosenFile(false);
}
async function moveTask(taskId, direction) {
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
}
function getVisibleTasks() {
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
        .sort((left, right) => {
        if (left.order !== right.order) {
            return left.order - right.order;
        }
        return left.createdAt.localeCompare(right.createdAt);
    });
}
function updateFilterButtons() {
    document.querySelectorAll(".filter-button").forEach((button) => {
        const isActive = button.dataset.filter === activeFilter;
        button.classList.toggle("is-active", isActive);
        button.setAttribute("aria-pressed", String(isActive));
    });
}
function isOverdue(task) {
    return Boolean(!task.done && task.dueDate && task.dueDate < todayString());
}
function isStaleWithoutDueDate(task) {
    return Boolean(!task.done &&
        !task.dueDate &&
        Date.now() - new Date(task.createdAt).getTime() > ONE_WEEK_MS);
}
async function chooseSaveFile() {
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
    }
    catch (error) {
        if (!isAbortError(error)) {
            setStatus(getErrorMessage(error));
        }
    }
}
async function syncToChosenFile(showResult) {
    const handle = await getSetting("fileHandle");
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
    }
    catch (error) {
        setStatus(getErrorMessage(error));
        return false;
    }
}
async function writeBackupToHandle(handle) {
    // The selected file mirrors the IndexedDB state as a portable JSON backup.
    if (!(await ensureWritablePermission(handle))) {
        throw new Error("Permission to write the selected file was not granted.");
    }
    const writable = await handle.createWritable();
    const backup = await exportBackup();
    await writable.write(new Blob([JSON.stringify(backup, null, 2)], {
        type: "application/json"
    }));
    await writable.close();
}
async function ensureWritablePermission(handle) {
    const options = { mode: "readwrite" };
    if (!handle.queryPermission || !handle.requestPermission) {
        return true;
    }
    if ((await handle.queryPermission(options)) === "granted") {
        return true;
    }
    return (await handle.requestPermission(options)) === "granted";
}
async function exportJsonBackup() {
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
async function copyTaskListLink() {
    const link = getTaskListLink();
    try {
        await navigator.clipboard.writeText(link);
        setStatus("Copied WebOn task list link.");
    }
    catch {
        setStatus(link);
    }
}
function getTaskListLink() {
    if (typeof chrome !== "undefined" && chrome.runtime?.getURL) {
        return chrome.runtime.getURL("app.html");
    }
    return window.location.href;
}
async function importJsonBackup() {
    const file = elements.importInput.files?.[0];
    if (!file) {
        return;
    }
    try {
        const data = JSON.parse(await file.text());
        await importBackup(data);
        await refreshTasks();
        await syncToChosenFile(false);
        setStatus("Imported JSON backup.");
    }
    catch (error) {
        setStatus(getErrorMessage(error));
    }
    finally {
        elements.importInput.value = "";
    }
}
function formatDateTime(value) {
    const date = new Date(value);
    if (Number.isNaN(date.getTime())) {
        return "Unknown";
    }
    return new Intl.DateTimeFormat(undefined, {
        dateStyle: "medium",
        timeStyle: "short"
    }).format(date);
}
function formatDateOnly(value) {
    const [year, month, day] = value.split("-").map(Number);
    if (!year || !month || !day) {
        return value;
    }
    return new Intl.DateTimeFormat(undefined, { dateStyle: "medium" }).format(new Date(year, month - 1, day));
}
function todayString() {
    const today = new Date();
    const month = String(today.getMonth() + 1).padStart(2, "0");
    const day = String(today.getDate()).padStart(2, "0");
    return `${today.getFullYear()}-${month}-${day}`;
}
function setStatus(message) {
    elements.status.textContent = message;
}
function isAbortError(error) {
    return error instanceof DOMException && error.name === "AbortError";
}
function getErrorMessage(error) {
    return error instanceof Error ? error.message : String(error);
}
function getElement(id) {
    const element = document.getElementById(id);
    if (!element) {
        throw new Error(`Missing element: ${id}`);
    }
    return element;
}
function query(root, selector) {
    const element = root.querySelector(selector);
    if (!element) {
        throw new Error(`Missing task element: ${selector}`);
    }
    return element;
}
