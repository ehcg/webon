import {
  createId,
  deleteScreenshot,
  getNextOrder,
  saveScreenshot,
  saveTask
} from "./db.js";
import type { QuickAddDraft, QuickAddPayload, TodoTask } from "./types.js";

declare const chrome: any;

const QUICK_MENU_ID = "add-selection-to-task-list";
const DIRECT_MENU_ID = "add-task-directly";
const OPEN_LIST_MENU_ID = "open-webon-task-list";
const TASKS_CHANGED_MESSAGE = "TASKS_CHANGED";
const TASKS_CHANGED_FROM_APP_MESSAGE = "TASKS_CHANGED_FROM_APP";
const TASK_NAME_LIMIT = 90;

let contextMenuRegistration: Promise<void> = Promise.resolve();

void registerContextMenus();

chrome.runtime.onInstalled.addListener(() => {
  void registerContextMenus();
});

chrome.action.onClicked.addListener(() => {
  openTaskList();
});

chrome.contextMenus.onClicked.addListener((info: any, tab: any) => {
  if (info.menuItemId === QUICK_MENU_ID) {
    void handleQuickAdd(info, tab);
  }

  if (info.menuItemId === DIRECT_MENU_ID) {
    void handleDirectAdd(info, tab);
  }

  if (info.menuItemId === OPEN_LIST_MENU_ID) {
    openTaskList();
  }
});

chrome.runtime.onMessage.addListener(
  (message: any, _sender: any, sendResponse: (response: unknown) => void) => {
    if (message?.type === "SAVE_QUICK_TASK") {
      void handleSaveQuickTask(message.payload)
        .then((task) => {
          notifyTaskViews();
          sendResponse({ ok: true, taskId: task.id });
        })
        .catch((error) =>
          sendResponse({ ok: false, error: getErrorMessage(error) })
        );
      return true;
    }

    if (message?.type === "DISCARD_QUICK_TASK") {
      void discardDraftScreenshot(message.screenshotId)
        .then(() => sendResponse({ ok: true }))
        .catch((error) =>
          sendResponse({ ok: false, error: getErrorMessage(error) })
        );
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
  }
);

async function handleQuickAdd(info: any, tab: any): Promise<void> {
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
  } catch (error) {
    console.warn("Could not show quick-add task popup.", error);
    await discardDraftScreenshot(draft.screenshotId);
  }
}

function openTaskList(): void {
  chrome.tabs.create({ url: chrome.runtime.getURL("app.html") });
}

async function registerContextMenus(): Promise<void> {
  contextMenuRegistration = contextMenuRegistration.then(
    recreateContextMenus,
    recreateContextMenus
  );
  return contextMenuRegistration;
}

async function recreateContextMenus(): Promise<void> {
  try {
    await removeAllContextMenus();
    createMenuItem(QUICK_MENU_ID, "Add selection to task list");
    createMenuItem(DIRECT_MENU_ID, "Add task directly");
    createMenuItem(OPEN_LIST_MENU_ID, "Open WebOn task list");
    console.info("WebOn context menus registered.");
  } catch (error) {
    console.warn("WebOn could not register context menus.", error);
  }
}

function removeAllContextMenus(): Promise<void> {
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

function createMenuItem(id: string, title: string): void {
  // Keep WebOn available from the context menu even when no text is selected.
  chrome.contextMenus.create({
    id,
    title,
    contexts: ["all"]
  });
}

function notifyTaskViews(): void {
  chrome.runtime.sendMessage(
    { type: TASKS_CHANGED_MESSAGE, changedAt: new Date().toISOString() },
    () => {
      // No open task page is fine; Chrome reports that as a lastError.
      void chrome.runtime.lastError;
    }
  );
}

async function handleDirectAdd(info: any, tab: any): Promise<void> {
  const selectedText = await resolveSelectedText(info, tab);

  if (!selectedText && typeof tab?.id === "number") {
    await handleQuickAdd(info, tab);
    return;
  }

  const draft = await createDraft(info, tab, selectedText, {
    captureScreenshot: true
  });
  const task = await buildTask({
    ...draft,
    name: draft.defaultName,
    dueDate: null,
    notes: selectedText
  });

  await saveTask(task);
  notifyTaskViews();

  if (typeof tab?.id === "number") {
    void sendMessageToTabWithFallback(tab.id, {
      type: "TASK_ADDED_TOAST",
      name: task.name
    }).catch(() => undefined);
  }
}

async function handleSaveQuickTask(payload: QuickAddPayload): Promise<TodoTask> {
  const task = await buildTask(payload);
  await saveTask(task);
  return task;
}

async function createDraft(
  info: any,
  tab: any,
  selectedText: string,
  options: { captureScreenshot: boolean }
): Promise<QuickAddDraft> {
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

async function buildTask(payload: QuickAddPayload): Promise<TodoTask> {
  const selectedText = payload.selectedText.trim();
  const defaultName = payload.defaultName || truncateTaskName(selectedText);
  const name = (payload.name || defaultName).trim() || defaultName;
  const notes = keepOriginalSelectionInNotes(
    payload.notes || "",
    selectedText,
    name !== defaultName
  );

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

function keepOriginalSelectionInNotes(
  notesValue: string,
  selectedText: string,
  renamed: boolean
): string {
  const notes = notesValue.trim();

  // Renamed quick-add tasks still retain the original source text for context.
  if (renamed && selectedText && !notes.includes(selectedText)) {
    return notes ? `${selectedText}\n\n${notes}` : selectedText;
  }

  return notes || selectedText;
}

async function captureAndStoreScreenshot(
  tab: any,
  pageUrl: string
): Promise<string | null> {
  // The screenshot is captured in the service worker because tabs capture APIs
  // are unavailable to the content script running inside the page.
  const dataUrl = await captureVisibleTab(tab?.windowId);
  if (!dataUrl) {
    return null;
  }
  return saveScreenshot(dataUrl, pageUrl);
}

function captureVisibleTab(windowId: number | undefined): Promise<string | null> {
  if (typeof windowId !== "number") {
    return Promise.resolve(null);
  }

  return new Promise((resolve) => {
    chrome.tabs.captureVisibleTab(
      windowId,
      { format: "png" },
      (dataUrl?: string) => {
        if (chrome.runtime.lastError || !dataUrl) {
          console.warn(
            "Could not capture visible tab.",
            chrome.runtime.lastError?.message
          );
          resolve(null);
          return;
        }
        resolve(dataUrl);
      }
    );
  });
}

function sendMessageToTabWithFallback(
  tabId: number,
  message: unknown
): Promise<unknown> {
  return sendMessageToTab(tabId, message).catch(async () => {
    await executeContentScript(tabId);
    return sendMessageToTab(tabId, message);
  });
}

function sendMessageToTab(tabId: number, message: unknown): Promise<unknown> {
  return new Promise((resolve, reject) => {
    chrome.tabs.sendMessage(tabId, message, (response: unknown) => {
      if (chrome.runtime.lastError) {
        reject(new Error(chrome.runtime.lastError.message));
        return;
      }
      resolve(response);
    });
  });
}

function executeContentScript(tabId: number): Promise<void> {
  return new Promise((resolve, reject) => {
    chrome.scripting.executeScript(
      { target: { tabId }, files: ["content.js"] },
      () => {
        if (chrome.runtime.lastError) {
          reject(new Error(chrome.runtime.lastError.message));
          return;
        }
        resolve();
      }
    );
  });
}

async function discardDraftScreenshot(
  screenshotId: string | null | undefined
): Promise<void> {
  if (screenshotId) {
    await deleteScreenshot(screenshotId);
  }
}

async function resolveSelectedText(info: any, tab: any): Promise<string> {
  const menuSelection = (info.selectionText || "").trim();
  if (menuSelection || typeof tab?.id !== "number") {
    return menuSelection;
  }

  try {
    const response = (await sendMessageToTabWithFallback(tab.id, {
      type: "GET_SELECTED_TEXT"
    })) as { text?: string } | undefined;
    return (response?.text || "").trim();
  } catch {
    return "";
  }
}

function truncateTaskName(text: string): string {
  const compact = text.replace(/\s+/g, " ").trim();
  if (!compact) {
    return "Untitled task";
  }
  if (compact.length <= TASK_NAME_LIMIT) {
    return compact;
  }
  return `${compact.slice(0, TASK_NAME_LIMIT - 3)}...`;
}

function getErrorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
