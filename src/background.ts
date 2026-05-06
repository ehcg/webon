import {
  createId,
  deleteScreenshot,
  getSetting,
  getNextOrder,
  saveScreenshot,
  saveTask
} from "./db.js";
import type { QuickAddDraft, QuickAddPayload, TodoTask } from "./types.js";

declare const chrome: any;

const QUICK_MENU_ID = "add-selection-to-task-list";
const DIRECT_MENU_ID = "add-task-directly";
const CREATE_JIRA_MENU_ID = "create-jira-ticket";
const OPEN_LIST_MENU_ID = "open-webon-task-list";
const JIRA_IMPORT_SETTINGS_KEY = "jiraImportSettings";
const TASKS_CHANGED_MESSAGE = "TASKS_CHANGED";
const TASKS_CHANGED_FROM_APP_MESSAGE = "TASKS_CHANGED_FROM_APP";
const TASK_NAME_LIMIT = 90;
const JIRA_DESCRIPTION_LIMIT = 3000;
const DEFAULT_JIRA_PROJECT = "Nexus";
const DEFAULT_JIRA_ISSUE_TYPE = "dtask";

type JiraImportSettings = {
  siteUrl: string;
  email: string;
  token: string;
  jql: string;
  savedAt: string;
};

type JiraProject = {
  id: string;
  key?: string;
  name?: string;
  issueTypes?: JiraIssueType[];
};

type JiraIssueType = {
  id: string;
  name?: string;
  untranslatedName?: string;
};

type JiraCreateDefaults = {
  projectId: string;
  issueTypeId: string;
};

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

  if (info.menuItemId === CREATE_JIRA_MENU_ID) {
    void handleCreateJiraTicket(info, tab);
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
    createMenuItem(DIRECT_MENU_ID, "Add manual task");
    createMenuItem(CREATE_JIRA_MENU_ID, "Create Jira ticket");
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
  if (typeof tab?.id !== "number") {
    return;
  }

  const draft = createManualDraft();

  try {
    await sendMessageToTabWithFallback(tab.id, {
      type: "SHOW_QUICK_ADD_TASK",
      draft
    });
  } catch (error) {
    console.warn("Could not show manual task popup.", error);
  }
}

async function handleCreateJiraTicket(info: any, tab: any): Promise<void> {
  const settings = await getSetting<JiraImportSettings>(JIRA_IMPORT_SETTINGS_KEY);
  if (!isJiraImportSettings(settings)) {
    openTaskList();
    return;
  }

  const selectedText = await resolveSelectedText(info, tab);
  const url = await buildJiraCreateUrl(settings, info, tab, selectedText);
  openPopupWindow(url);
}

async function buildJiraCreateUrl(
  settings: JiraImportSettings,
  info: any,
  tab: any,
  selectedText: string
): Promise<string> {
  const pageUrl = tab?.url || info.pageUrl || "";
  const pageTitle = tab?.title || pageUrl || "Untitled page";
  const summarySeed = selectedText || pageTitle || "New Jira ticket";
  const summary = truncateTaskName(summarySeed);
  const description = truncateText(
    [
      selectedText ? `Selected text:\n${selectedText}` : "",
      pageTitle ? `Source title: ${pageTitle}` : "",
      pageUrl ? `Source URL: ${pageUrl}` : ""
    ]
      .filter(Boolean)
      .join("\n\n"),
    JIRA_DESCRIPTION_LIMIT
  );
  const defaults = await resolveJiraCreateDefaults(settings);
  const route = defaults ? "CreateIssue.jspa" : "CreateIssue!default.jspa";
  const url = new URL(
    `${settings.siteUrl.replace(/\/+$/, "")}/secure/${route}`
  );

  if (defaults) {
    url.searchParams.set("pid", defaults.projectId);
    url.searchParams.set("issuetype", defaults.issueTypeId);
  }
  url.searchParams.set("summary", summary);
  if (description) {
    url.searchParams.set("description", description);
  }

  return url.toString();
}

async function resolveJiraCreateDefaults(
  settings: JiraImportSettings
): Promise<JiraCreateDefaults | null> {
  if (!settings.email || !settings.token) {
    return null;
  }

  try {
    const project = await findJiraProject(settings, DEFAULT_JIRA_PROJECT);
    if (!project) {
      return null;
    }

    const issueTypes =
      project.issueTypes && project.issueTypes.length > 0
        ? project.issueTypes
        : await fetchJiraProjectIssueTypes(settings, project.id);
    const issueType = findJiraIssueType(issueTypes, DEFAULT_JIRA_ISSUE_TYPE);

    if (!issueType) {
      return null;
    }

    return {
      projectId: project.id,
      issueTypeId: issueType.id
    };
  } catch (error) {
    console.warn("Could not resolve Jira create defaults.", error);
    return null;
  }
}

async function findJiraProject(
  settings: JiraImportSettings,
  projectName: string
): Promise<JiraProject | null> {
  const url = new URL(
    `${settings.siteUrl.replace(/\/+$/, "")}/rest/api/3/project/search`
  );
  url.searchParams.set("query", projectName);
  const data = await fetchJiraJson(settings, url.toString());
  const projects = Array.isArray(data.values) ? data.values : [];

  return findBestJiraProject(projects, projectName);
}

async function fetchJiraProjectIssueTypes(
  settings: JiraImportSettings,
  projectId: string
): Promise<JiraIssueType[]> {
  const url = new URL(
    `${settings.siteUrl.replace(/\/+$/, "")}/rest/api/3/project/${encodeURIComponent(
      projectId
    )}`
  );
  url.searchParams.set("expand", "issueTypes");
  const data = await fetchJiraJson(settings, url.toString());

  return Array.isArray(data.issueTypes) ? data.issueTypes : [];
}

async function fetchJiraJson(
  settings: JiraImportSettings,
  url: string
): Promise<any> {
  const response = await fetch(url, {
    headers: {
      Authorization: `Basic ${btoa(`${settings.email}:${settings.token}`)}`,
      Accept: "application/json"
    }
  });
  const text = await response.text();
  const data = text ? JSON.parse(text) : {};

  if (!response.ok) {
    throw new Error(data.message || response.statusText);
  }

  return data;
}

function findBestJiraProject(
  projects: JiraProject[],
  projectName: string
): JiraProject | null {
  const normalizedProjectName = normalizeJiraName(projectName);

  return (
    projects.find(
      (project) =>
        normalizeJiraName(project.key || "") === normalizedProjectName ||
        normalizeJiraName(project.name || "") === normalizedProjectName
    ) ||
    projects.find(
      (project) =>
        normalizeJiraName(project.key || "").includes(normalizedProjectName) ||
        normalizeJiraName(project.name || "").includes(normalizedProjectName)
    ) ||
    projects[0] ||
    null
  );
}

function findJiraIssueType(
  issueTypes: JiraIssueType[],
  issueTypeName: string
): JiraIssueType | null {
  const normalizedIssueType = normalizeJiraName(issueTypeName);

  return (
    issueTypes.find(
      (issueType) =>
        normalizeJiraName(issueType.name || "") === normalizedIssueType ||
        normalizeJiraName(issueType.untranslatedName || "") === normalizedIssueType
    ) ||
    issueTypes.find(
      (issueType) =>
        normalizeJiraName(issueType.name || "").includes(normalizedIssueType) ||
        normalizeJiraName(issueType.untranslatedName || "").includes(normalizedIssueType)
    ) ||
    null
  );
}

function normalizeJiraName(value: string): string {
  return value.toLowerCase().replace(/[\s_-]+/g, "").trim();
}

function isJiraImportSettings(value: unknown): value is JiraImportSettings {
  if (!value || typeof value !== "object") {
    return false;
  }

  const settings = value as Partial<JiraImportSettings>;
  return Boolean(settings.siteUrl);
}

function openPopupWindow(url: string): void {
  if (!chrome.windows?.create) {
    chrome.tabs.create({ url });
    return;
  }

  chrome.windows.create(
    {
      url,
      type: "popup",
      width: 1100,
      height: 850,
      focused: true
    },
    () => {
      if (chrome.runtime.lastError) {
        chrome.tabs.create({ url });
      }
    }
  );
}

function createManualDraft(): QuickAddDraft {
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

function truncateText(text: string, limit: number): string {
  const compact = text.trim();
  if (compact.length <= limit) {
    return compact;
  }
  return `${compact.slice(0, limit - 3)}...`;
}

function getErrorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
