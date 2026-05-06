import { createId, deleteScreenshot, getSetting, getNextOrder, saveScreenshot, saveTask } from "./db.js";
const QUICK_MENU_ID = "add-selection-to-task-list";
const DIRECT_MENU_ID = "add-task-directly";
const CREATE_JIRA_MENU_ID = "create-jira-ticket";
const OPEN_LIST_MENU_ID = "open-webon-task-list";
const JIRA_IMPORT_SETTINGS_KEY = "jiraImportSettings";
const TASKS_CHANGED_MESSAGE = "TASKS_CHANGED";
const TASKS_CHANGED_FROM_APP_MESSAGE = "TASKS_CHANGED_FROM_APP";
const TASK_NAME_LIMIT = 90;
const JIRA_DESCRIPTION_LIMIT = 3000;
let contextMenuRegistration = Promise.resolve();
void registerContextMenus();
chrome.runtime.onInstalled.addListener(() => {
    void registerContextMenus();
});
chrome.action.onClicked.addListener(() => {
    openTaskList();
});
chrome.contextMenus.onClicked.addListener((info, tab) => {
    if (info.menuItemId === QUICK_MENU_ID) {
        void handleQuickAdd(info, tab);
    }
    if (info.menuItemId === DIRECT_MENU_ID) {
        void handleDirectAdd(info, tab);
    }
    if (info.menuItemId === CREATE_JIRA_MENU_ID) {
        void handleCreateJiraTicket(info, tab);
    }
    if (info.menuItemId === OPEN_LIST_MENU_ID) {
        openTaskList();
    }
});
chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
    if (message?.type === "SAVE_QUICK_TASK") {
        void handleSaveQuickTask(message.payload)
            .then((task) => {
            notifyTaskViews();
            sendResponse({ ok: true, taskId: task.id });
        })
            .catch((error) => sendResponse({ ok: false, error: getErrorMessage(error) }));
        return true;
    }
    if (message?.type === "DISCARD_QUICK_TASK") {
        void discardDraftScreenshot(message.screenshotId)
            .then(() => sendResponse({ ok: true }))
            .catch((error) => sendResponse({ ok: false, error: getErrorMessage(error) }));
        return true;
    }
    if (message?.type === "OPEN_TASK_LIST") {
        openTaskList();
        sendResponse({ ok: true });
        return false;
    }
    if (message?.type === TASKS_CHANGED_FROM_APP_MESSAGE) {
        notifyTaskViews();
        sendResponse({ ok: true });
        return false;
    }
    return false;
});
async function handleQuickAdd(info, tab) {
    if (typeof tab?.id !== "number") {
        return;
    }
    const selectedText = await resolveSelectedText(info, tab);
    const draft = await createDraft(info, tab, selectedText, {
        captureScreenshot: Boolean(selectedText)
    });
    try {
        await sendMessageToTabWithFallback(tab.id, {
            type: "SHOW_QUICK_ADD_TASK",
            draft
        });
    }
    catch (error) {
        console.warn("Could not show quick-add task popup.", error);
        await discardDraftScreenshot(draft.screenshotId);
    }
}
function openTaskList() {
    chrome.tabs.create({ url: chrome.runtime.getURL("app.html") });
}
async function registerContextMenus() {
    contextMenuRegistration = contextMenuRegistration.then(recreateContextMenus, recreateContextMenus);
    return contextMenuRegistration;
}
async function recreateContextMenus() {
    try {
        await removeAllContextMenus();
        createMenuItem(QUICK_MENU_ID, "Add selection to task list");
        createMenuItem(DIRECT_MENU_ID, "Add manual task");
        createMenuItem(CREATE_JIRA_MENU_ID, "Create Jira ticket");
        createMenuItem(OPEN_LIST_MENU_ID, "Open WebOn task list");
        console.info("WebOn context menus registered.");
    }
    catch (error) {
        console.warn("WebOn could not register context menus.", error);
    }
}
function removeAllContextMenus() {
    return new Promise((resolve, reject) => {
        chrome.contextMenus.removeAll(() => {
            if (chrome.runtime.lastError) {
                reject(new Error(chrome.runtime.lastError.message));
                return;
            }
            resolve();
        });
    });
}
function createMenuItem(id, title) {
    // Keep WebOn available from the context menu even when no text is selected.
    chrome.contextMenus.create({
        id,
        title,
        contexts: ["all"]
    });
}
function notifyTaskViews() {
    chrome.runtime.sendMessage({ type: TASKS_CHANGED_MESSAGE, changedAt: new Date().toISOString() }, () => {
        // No open task page is fine; Chrome reports that as a lastError.
        void chrome.runtime.lastError;
    });
}
async function handleDirectAdd(info, tab) {
    if (typeof tab?.id !== "number") {
        return;
    }
    const draft = createManualDraft();
    try {
        await sendMessageToTabWithFallback(tab.id, {
            type: "SHOW_QUICK_ADD_TASK",
            draft
        });
    }
    catch (error) {
        console.warn("Could not show manual task popup.", error);
    }
}
async function handleCreateJiraTicket(info, tab) {
    const settings = await getSetting(JIRA_IMPORT_SETTINGS_KEY);
    if (!isJiraImportSettings(settings)) {
        openTaskList();
        return;
    }
    const selectedText = await resolveSelectedText(info, tab);
    const url = buildJiraCreateUrl(settings.siteUrl, info, tab, selectedText);
    openPopupWindow(url);
}
function buildJiraCreateUrl(siteUrl, info, tab, selectedText) {
    const pageUrl = tab?.url || info.pageUrl || "";
    const pageTitle = tab?.title || pageUrl || "Untitled page";
    const summarySeed = selectedText || pageTitle || "New Jira ticket";
    const summary = truncateTaskName(summarySeed);
    const description = truncateText([
        selectedText ? `Selected text:\n${selectedText}` : "",
        pageTitle ? `Source title: ${pageTitle}` : "",
        pageUrl ? `Source URL: ${pageUrl}` : ""
    ]
        .filter(Boolean)
        .join("\n\n"), JIRA_DESCRIPTION_LIMIT);
    const url = new URL(`${siteUrl.replace(/\/+$/, "")}/secure/CreateIssueDetails!init.jspa`);
    url.searchParams.set("summary", summary);
    if (description) {
        url.searchParams.set("description", description);
    }
    return url.toString();
}
function isJiraImportSettings(value) {
    if (!value || typeof value !== "object") {
        return false;
    }
    const settings = value;
    return Boolean(settings.siteUrl);
}
function openPopupWindow(url) {
    if (!chrome.windows?.create) {
        chrome.tabs.create({ url });
        return;
    }
    chrome.windows.create({
        url,
        type: "popup",
        width: 1100,
        height: 850,
        focused: true
    }, () => {
        if (chrome.runtime.lastError) {
            chrome.tabs.create({ url });
        }
    });
}
function createManualDraft() {
    return {
        id: createId("draft"),
        selectedText: "",
        pageTitle: "Manual task",
        pageUrl: "",
        createdAt: new Date().toISOString(),
        screenshotId: null,
        defaultName: ""
    };
}
async function handleSaveQuickTask(payload) {
    const task = await buildTask(payload);
    await saveTask(task);
    return task;
}
async function createDraft(info, tab, selectedText, options) {
    const pageUrl = tab?.url || info.pageUrl || "";
    const pageTitle = tab?.title || pageUrl || "Untitled page";
    const taskSeedText = selectedText || "";
    const screenshotId = options.captureScreenshot
        ? await captureAndStoreScreenshot(tab, pageUrl)
        : null;
    return {
        id: createId("draft"),
        selectedText,
        pageTitle,
        pageUrl,
        createdAt: new Date().toISOString(),
        screenshotId,
        defaultName: taskSeedText ? truncateTaskName(taskSeedText) : ""
    };
}
async function buildTask(payload) {
    const selectedText = payload.selectedText.trim();
    const defaultName = payload.defaultName || truncateTaskName(selectedText);
    const name = (payload.name || defaultName).trim() || defaultName;
    const notes = keepOriginalSelectionInNotes(payload.notes || "", selectedText, name !== defaultName);
    return {
        id: createId("task"),
        name,
        dueDate: payload.dueDate || null,
        notes,
        selectedText,
        pageTitle: payload.pageTitle || "Untitled page",
        pageUrl: payload.pageUrl || "",
        createdAt: payload.createdAt || new Date().toISOString(),
        screenshotId: payload.screenshotId || null,
        done: false,
        archived: false,
        order: await getNextOrder()
    };
}
function keepOriginalSelectionInNotes(notesValue, selectedText, renamed) {
    const notes = notesValue.trim();
    // Renamed quick-add tasks still retain the original source text for context.
    if (renamed && selectedText && !notes.includes(selectedText)) {
        return notes ? `${selectedText}\n\n${notes}` : selectedText;
    }
    return notes || selectedText;
}
async function captureAndStoreScreenshot(tab, pageUrl) {
    // The screenshot is captured in the service worker because tabs capture APIs
    // are unavailable to the content script running inside the page.
    const dataUrl = await captureVisibleTab(tab?.windowId);
    if (!dataUrl) {
        return null;
    }
    return saveScreenshot(dataUrl, pageUrl);
}
function captureVisibleTab(windowId) {
    if (typeof windowId !== "number") {
        return Promise.resolve(null);
    }
    return new Promise((resolve) => {
        chrome.tabs.captureVisibleTab(windowId, { format: "png" }, (dataUrl) => {
            if (chrome.runtime.lastError || !dataUrl) {
                console.warn("Could not capture visible tab.", chrome.runtime.lastError?.message);
                resolve(null);
                return;
            }
            resolve(dataUrl);
        });
    });
}
function sendMessageToTabWithFallback(tabId, message) {
    return sendMessageToTab(tabId, message).catch(async () => {
        await executeContentScript(tabId);
        return sendMessageToTab(tabId, message);
    });
}
function sendMessageToTab(tabId, message) {
    return new Promise((resolve, reject) => {
        chrome.tabs.sendMessage(tabId, message, (response) => {
            if (chrome.runtime.lastError) {
                reject(new Error(chrome.runtime.lastError.message));
                return;
            }
            resolve(response);
        });
    });
}
function executeContentScript(tabId) {
    return new Promise((resolve, reject) => {
        chrome.scripting.executeScript({ target: { tabId }, files: ["content.js"] }, () => {
            if (chrome.runtime.lastError) {
                reject(new Error(chrome.runtime.lastError.message));
                return;
            }
            resolve();
        });
    });
}
async function discardDraftScreenshot(screenshotId) {
    if (screenshotId) {
        await deleteScreenshot(screenshotId);
    }
}
async function resolveSelectedText(info, tab) {
    const menuSelection = (info.selectionText || "").trim();
    if (menuSelection || typeof tab?.id !== "number") {
        return menuSelection;
    }
    try {
        const response = (await sendMessageToTabWithFallback(tab.id, {
            type: "GET_SELECTED_TEXT"
        }));
        return (response?.text || "").trim();
    }
    catch {
        return "";
    }
}
function truncateTaskName(text) {
    const compact = text.replace(/\s+/g, " ").trim();
    if (!compact) {
        return "Untitled task";
    }
    if (compact.length <= TASK_NAME_LIMIT) {
        return compact;
    }
    return `${compact.slice(0, TASK_NAME_LIMIT - 3)}...`;
}
function truncateText(text, limit) {
    const compact = text.trim();
    if (compact.length <= limit) {
        return compact;
    }
    return `${compact.slice(0, limit - 3)}...`;
}
function getErrorMessage(error) {
    return error instanceof Error ? error.message : String(error);
}
