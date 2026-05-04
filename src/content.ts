declare const chrome: any;

interface Window {
  __webOnContentLoaded?: boolean;
  __webOnCleanup?: () => void;
}

interface QuickAddDraft {
  id: string;
  selectedText: string;
  pageTitle: string;
  pageUrl: string;
  createdAt: string;
  screenshotId: string | null;
  defaultName: string;
}

const QUICK_ADD_TIMEOUT_SECONDS = 30;

if (!window.__webOnContentLoaded) {
  window.__webOnContentLoaded = true;

  chrome.runtime.onMessage.addListener(
    (message: any, _sender: any, sendResponse: (response: unknown) => void) => {
      if (message?.type === "SHOW_QUICK_ADD_TASK") {
        showQuickAdd(message.draft);
        sendResponse({ ok: true });
        return false;
      }

      if (message?.type === "TASK_ADDED_TOAST") {
        showToast(`Task added: ${message.name}`);
        sendResponse({ ok: true });
        return false;
      }

      if (message?.type === "GET_SELECTED_TEXT") {
        sendResponse({ ok: true, text: readSelectedText() });
        return false;
      }

      return false;
    }
  );
}

function showQuickAdd(draft: QuickAddDraft): void {
  window.__webOnCleanup?.();

  // Shadow DOM keeps the quick-add UI readable without inheriting page styles.
  const host = document.createElement("div");
  host.dataset.webOn = "quick-add";
  const shadow = host.attachShadow({ mode: "open" });

  shadow.innerHTML = `
    <style>
      :host {
        all: initial;
        color-scheme: light dark;
        --bg: #ffffff;
        --text: #1d1f23;
        --muted: #5d6570;
        --border: #d7dbe0;
        --accent: #0b69a8;
        --accent-text: #ffffff;
        --danger: #b42318;
        font-family: Inter, ui-sans-serif, system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif;
      }

      @media (prefers-color-scheme: dark) {
        :host {
          --bg: #1b1f24;
          --text: #f1f4f8;
          --muted: #a9b2bd;
          --border: #3a424d;
          --accent: #76bdf2;
          --accent-text: #071018;
          --danger: #ff8a80;
        }
      }

      .backdrop {
        position: fixed;
        inset: 0;
        z-index: 2147483647;
        display: grid;
        place-items: start center;
        padding: 8vh 16px 16px;
        background: rgba(0, 0, 0, 0.28);
        box-sizing: border-box;
      }

      .modal {
        width: min(520px, 100%);
        box-sizing: border-box;
        border: 1px solid var(--border);
        border-radius: 8px;
        background: var(--bg);
        color: var(--text);
        box-shadow: 0 20px 70px rgba(0, 0, 0, 0.28);
        padding: 18px;
      }

      header {
        display: flex;
        align-items: start;
        justify-content: space-between;
        gap: 12px;
        margin-bottom: 14px;
      }

      h2 {
        margin: 0;
        font-size: 18px;
        line-height: 1.25;
        font-weight: 700;
      }

      .page {
        margin: 4px 0 0;
        color: var(--muted);
        font-size: 13px;
        line-height: 1.35;
        overflow-wrap: anywhere;
      }

      label {
        display: grid;
        gap: 6px;
        margin-top: 12px;
        color: var(--text);
        font-size: 13px;
        font-weight: 650;
      }

      input,
      textarea {
        box-sizing: border-box;
        width: 100%;
        border: 1px solid var(--border);
        border-radius: 6px;
        background: transparent;
        color: var(--text);
        font: inherit;
        font-size: 14px;
        padding: 10px 11px;
      }

      textarea {
        min-height: 108px;
        resize: vertical;
        line-height: 1.4;
      }

      .actions {
        display: flex;
        align-items: center;
        justify-content: space-between;
        gap: 12px;
        margin-top: 16px;
      }

      .timer,
      .error {
        color: var(--muted);
        font-size: 12px;
        line-height: 1.35;
      }

      .error {
        color: var(--danger);
      }

      .button-row {
        display: flex;
        gap: 8px;
      }

      button {
        border: 1px solid var(--border);
        border-radius: 6px;
        background: transparent;
        color: var(--text);
        cursor: pointer;
        font: inherit;
        font-size: 14px;
        font-weight: 650;
        padding: 9px 12px;
      }

      button:hover {
        border-color: var(--accent);
      }

      .primary {
        background: var(--accent);
        border-color: var(--accent);
        color: var(--accent-text);
      }

      .close {
        min-width: 34px;
        padding: 6px 9px;
      }
    </style>
    <div class="backdrop">
      <form class="modal">
        <header>
          <div>
            <h2>Quick add task</h2>
            <p class="page"></p>
          </div>
          <button class="close" type="button" aria-label="Cancel quick add">X</button>
        </header>

        <label>
          Task name
          <input class="task-name" name="taskName" autocomplete="off" />
        </label>

        <label>
          Due date
          <input class="due-date" name="dueDate" type="date" />
        </label>

        <label>
          Notes/info
          <textarea class="notes" name="notes"></textarea>
        </label>

        <p class="error" hidden></p>

        <div class="actions">
          <span class="timer"></span>
          <div class="button-row">
            <button class="cancel" type="button">Cancel</button>
            <button class="primary" type="submit">Save</button>
          </div>
        </div>
      </form>
    </div>
  `;

  const form = query<HTMLFormElement>(shadow, "form");
  const page = query<HTMLElement>(shadow, ".page");
  const taskName = query<HTMLInputElement>(shadow, ".task-name");
  const dueDate = query<HTMLInputElement>(shadow, ".due-date");
  const notes = query<HTMLTextAreaElement>(shadow, ".notes");
  const error = query<HTMLElement>(shadow, ".error");
  const timer = query<HTMLElement>(shadow, ".timer");
  const backdrop = query<HTMLElement>(shadow, ".backdrop");

  page.textContent = draft.pageTitle || draft.pageUrl || "Source page";
  taskName.value = draft.defaultName;
  notes.value = draft.selectedText || fallbackDraftNotes(draft);

  let secondsLeft = QUICK_ADD_TIMEOUT_SECONDS;
  let saved = false;

  const updateTimer = () => {
    timer.textContent = `Closes in ${secondsLeft}s`;
  };

  const intervalId = window.setInterval(() => {
    secondsLeft -= 1;
    updateTimer();
  }, 1000);

  const timeoutId = window.setTimeout(() => {
    // Unsaved quick-add drafts are discarded after the required 30 seconds.
    cleanup(true);
  }, QUICK_ADD_TIMEOUT_SECONDS * 1000);

  const cleanup = (discardScreenshot: boolean) => {
    window.clearInterval(intervalId);
    window.clearTimeout(timeoutId);
    document.removeEventListener("keydown", onKeydown, true);
    host.remove();
    window.__webOnCleanup = undefined;

    if (discardScreenshot && !saved) {
      void sendRuntimeMessage({
        type: "DISCARD_QUICK_TASK",
        screenshotId: draft.screenshotId
      }).catch(() => undefined);
    }
  };

  const onCancel = () => cleanup(true);
  const onKeydown = (event: KeyboardEvent) => {
    if (event.key === "Escape") {
      cleanup(true);
    }
  };

  query<HTMLElement>(shadow, ".close").addEventListener("click", onCancel);
  query<HTMLElement>(shadow, ".cancel").addEventListener("click", onCancel);
  backdrop.addEventListener("click", (event) => {
    if (event.target === backdrop) {
      cleanup(true);
    }
  });

  form.addEventListener("submit", async (event) => {
    event.preventDefault();
    error.hidden = true;

    const payload = {
      ...draft,
      name: taskName.value,
      dueDate: dueDate.value || null,
      notes: notes.value
    };

    try {
      const response = await sendRuntimeMessage({
        type: "SAVE_QUICK_TASK",
        payload
      });
      if (!response?.ok) {
        throw new Error(response?.error || "Task could not be saved.");
      }
      saved = true;
      cleanup(false);
      showToast("Task saved");
    } catch (saveError) {
      error.textContent =
        saveError instanceof Error ? saveError.message : String(saveError);
      error.hidden = false;
    }
  });

  document.addEventListener("keydown", onKeydown, true);
  window.__webOnCleanup = () => cleanup(true);
  document.documentElement.append(host);
  updateTimer();
  taskName.focus();
  taskName.select();
}

function showToast(message: string): void {
  const host = document.createElement("div");
  const shadow = host.attachShadow({ mode: "open" });
  shadow.innerHTML = `
    <style>
      :host {
        all: initial;
        color-scheme: light dark;
        --bg: #1d1f23;
        --text: #ffffff;
        font-family: Inter, ui-sans-serif, system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif;
      }

      @media (prefers-color-scheme: dark) {
        :host {
          --bg: #f1f4f8;
          --text: #101418;
        }
      }

      .toast {
        position: fixed;
        right: 16px;
        bottom: 16px;
        z-index: 2147483647;
        max-width: min(360px, calc(100vw - 32px));
        box-sizing: border-box;
        border-radius: 8px;
        background: var(--bg);
        color: var(--text);
        box-shadow: 0 12px 38px rgba(0, 0, 0, 0.24);
        font-size: 14px;
        line-height: 1.4;
        padding: 12px 14px;
        overflow-wrap: anywhere;
      }
    </style>
    <div class="toast"></div>
  `;
  query<HTMLElement>(shadow, ".toast").textContent = message;
  document.documentElement.append(host);
  window.setTimeout(() => host.remove(), 4000);
}

function sendRuntimeMessage(message: any): Promise<any> {
  return new Promise((resolve, reject) => {
    chrome.runtime.sendMessage(message, (response: any) => {
      if (chrome.runtime.lastError) {
        reject(new Error(chrome.runtime.lastError.message));
        return;
      }
      resolve(response);
    });
  });
}

function readSelectedText(): string {
  const pageSelection = window.getSelection()?.toString().trim();
  if (pageSelection) {
    return pageSelection;
  }

  const activeElement = document.activeElement;
  if (
    activeElement instanceof HTMLTextAreaElement ||
    (activeElement instanceof HTMLInputElement &&
      activeElement.type !== "password")
  ) {
    const start = activeElement.selectionStart ?? 0;
    const end = activeElement.selectionEnd ?? 0;
    return activeElement.value.slice(start, end).trim();
  }

  return "";
}

function fallbackDraftNotes(draft: QuickAddDraft): string {
  if (draft.pageUrl) {
    return `Captured from ${draft.pageTitle}\n${draft.pageUrl}`;
  }
  return `Captured from ${draft.pageTitle}`;
}

function query<T extends Element>(
  root: DocumentFragment,
  selector: string
): T {
  const element = root.querySelector<T>(selector);
  if (!element) {
    throw new Error(`Missing quick-add element: ${selector}`);
  }
  return element;
}
