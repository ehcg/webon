export interface TodoTask {
  id: string;
  name: string;
  dueDate: string | null;
  notes: string;
  selectedText: string;
  pageTitle: string;
  pageUrl: string;
  createdAt: string;
  screenshotId: string | null;
  done: boolean;
  archived: boolean;
  order: number;
  sourceKey?: string;
  sourceName?: string;
}

export interface ScreenshotRecord {
  id: string;
  dataUrl: string;
  pageUrl: string;
  createdAt: string;
}

export interface BackupData {
  version: 1;
  exportedAt: string;
  tasks: TodoTask[];
  screenshots: ScreenshotRecord[];
}

export interface QuickAddDraft {
  id: string;
  selectedText: string;
  pageTitle: string;
  pageUrl: string;
  createdAt: string;
  screenshotId: string | null;
  defaultName: string;
}

export interface QuickAddPayload extends QuickAddDraft {
  name: string;
  dueDate: string | null;
  notes: string;
}

export type TaskFilter = "all" | "todo" | "done";
