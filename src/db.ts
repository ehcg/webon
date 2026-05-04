import type { BackupData, ScreenshotRecord, TodoTask } from "./types.js";

const DB_NAME = "local-first-todo-extension";
const DB_VERSION = 1;
const TASK_STORE = "tasks";
const SCREENSHOT_STORE = "screenshots";
const SETTINGS_STORE = "settings";

let databasePromise: Promise<IDBDatabase> | null = null;

export function createId(prefix: string): string {
  const value =
    globalThis.crypto && "randomUUID" in globalThis.crypto
      ? globalThis.crypto.randomUUID()
      : `${Date.now()}-${Math.random().toString(16).slice(2)}`;
  return `${prefix}-${value}`;
}

export function openTodoDatabase(): Promise<IDBDatabase> {
  if (databasePromise) {
    return databasePromise;
  }

  databasePromise = new Promise((resolve, reject) => {
    const request = indexedDB.open(DB_NAME, DB_VERSION);

    request.onupgradeneeded = () => {
      const db = request.result;

      // Tasks and screenshots stay in IndexedDB so the extension works offline.
      if (!db.objectStoreNames.contains(TASK_STORE)) {
        const tasks = db.createObjectStore(TASK_STORE, { keyPath: "id" });
        tasks.createIndex("order", "order");
        tasks.createIndex("done", "done");
        tasks.createIndex("archived", "archived");
        tasks.createIndex("createdAt", "createdAt");
      }

      if (!db.objectStoreNames.contains(SCREENSHOT_STORE)) {
        db.createObjectStore(SCREENSHOT_STORE, { keyPath: "id" });
      }

      if (!db.objectStoreNames.contains(SETTINGS_STORE)) {
        db.createObjectStore(SETTINGS_STORE, { keyPath: "key" });
      }
    };

    request.onerror = () => reject(request.error);
    request.onsuccess = () => resolve(request.result);
  });

  return databasePromise;
}

function requestToPromise<T>(request: IDBRequest<T>): Promise<T> {
  return new Promise((resolve, reject) => {
    request.onerror = () => reject(request.error);
    request.onsuccess = () => resolve(request.result);
  });
}

function transactionDone(transaction: IDBTransaction): Promise<void> {
  return new Promise((resolve, reject) => {
    transaction.oncomplete = () => resolve();
    transaction.onerror = () => reject(transaction.error);
    transaction.onabort = () => reject(transaction.error);
  });
}

export async function getAllTasks(): Promise<TodoTask[]> {
  const db = await openTodoDatabase();
  const transaction = db.transaction(TASK_STORE, "readonly");
  const tasks = await requestToPromise<TodoTask[]>(
    transaction.objectStore(TASK_STORE).getAll()
  );

  return tasks.sort((left, right) => {
    if (left.order !== right.order) {
      return left.order - right.order;
    }
    return left.createdAt.localeCompare(right.createdAt);
  });
}

export async function saveTask(task: TodoTask): Promise<void> {
  const db = await openTodoDatabase();
  const transaction = db.transaction(TASK_STORE, "readwrite");
  transaction.objectStore(TASK_STORE).put(task);
  await transactionDone(transaction);
}

export async function saveTasks(tasks: TodoTask[]): Promise<void> {
  const db = await openTodoDatabase();
  const transaction = db.transaction(TASK_STORE, "readwrite");
  const store = transaction.objectStore(TASK_STORE);
  for (const task of tasks) {
    store.put(task);
  }
  await transactionDone(transaction);
}

export async function getNextOrder(): Promise<number> {
  const tasks = await getAllTasks();
  if (tasks.length === 0) {
    return 1;
  }
  return Math.max(...tasks.map((task) => task.order || 0)) + 1;
}

export async function saveScreenshot(
  dataUrl: string,
  pageUrl: string
): Promise<string> {
  const screenshot: ScreenshotRecord = {
    id: createId("screenshot"),
    dataUrl,
    pageUrl,
    createdAt: new Date().toISOString()
  };
  const db = await openTodoDatabase();
  const transaction = db.transaction(SCREENSHOT_STORE, "readwrite");
  transaction.objectStore(SCREENSHOT_STORE).put(screenshot);
  await transactionDone(transaction);
  return screenshot.id;
}

export async function getScreenshot(
  id: string
): Promise<ScreenshotRecord | undefined> {
  const db = await openTodoDatabase();
  const transaction = db.transaction(SCREENSHOT_STORE, "readonly");
  return requestToPromise<ScreenshotRecord | undefined>(
    transaction.objectStore(SCREENSHOT_STORE).get(id)
  );
}

export async function deleteScreenshot(id: string): Promise<void> {
  const db = await openTodoDatabase();
  const transaction = db.transaction(SCREENSHOT_STORE, "readwrite");
  transaction.objectStore(SCREENSHOT_STORE).delete(id);
  await transactionDone(transaction);
}

export async function getAllScreenshots(): Promise<ScreenshotRecord[]> {
  const db = await openTodoDatabase();
  const transaction = db.transaction(SCREENSHOT_STORE, "readonly");
  return requestToPromise<ScreenshotRecord[]>(
    transaction.objectStore(SCREENSHOT_STORE).getAll()
  );
}

export async function getSetting<T>(key: string): Promise<T | undefined> {
  const db = await openTodoDatabase();
  const transaction = db.transaction(SETTINGS_STORE, "readonly");
  const record = await requestToPromise<{ key: string; value: T } | undefined>(
    transaction.objectStore(SETTINGS_STORE).get(key)
  );
  return record?.value;
}

export async function setSetting<T>(key: string, value: T): Promise<void> {
  const db = await openTodoDatabase();
  const transaction = db.transaction(SETTINGS_STORE, "readwrite");
  transaction.objectStore(SETTINGS_STORE).put({ key, value });
  await transactionDone(transaction);
}

export async function exportBackup(): Promise<BackupData> {
  // Backups are plain JSON so users can keep a local file copy anywhere.
  return {
    version: 1,
    exportedAt: new Date().toISOString(),
    tasks: await getAllTasks(),
    screenshots: await getAllScreenshots()
  };
}

export async function importBackup(data: BackupData): Promise<void> {
  if (!data || data.version !== 1 || !Array.isArray(data.tasks)) {
    throw new Error("This backup file is not a supported task backup.");
  }

  const db = await openTodoDatabase();
  const transaction = db.transaction(
    [TASK_STORE, SCREENSHOT_STORE],
    "readwrite"
  );
  const taskStore = transaction.objectStore(TASK_STORE);
  const screenshotStore = transaction.objectStore(SCREENSHOT_STORE);

  for (const task of data.tasks) {
    taskStore.put(task);
  }

  for (const screenshot of data.screenshots || []) {
    screenshotStore.put(screenshot);
  }

  await transactionDone(transaction);
}
