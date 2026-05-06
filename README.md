# WebOn

WebOn is a Manifest V3 Chrome/Edge extension that captures selected webpage text into a local-only task list. Tasks are stored in IndexedDB, screenshots are stored locally as data URL records, and the task page supports JSON backup import/export plus an optional File System Access API save file.

## Project Structure

```text
.
├── extension/
│   ├── manifest.json       # MV3 manifest loaded by Chrome/Edge
│   ├── background.js       # Context menus, screenshots, task creation
│   ├── content.js          # In-page quick-add modal and toast
│   ├── db.js               # IndexedDB storage module
│   ├── app.html            # Extension-hosted WebOn webpage
│   ├── app.css             # Light/dark responsive task UI
│   └── app.js              # WebOn page behavior
├── src/
│   ├── background.ts
│   ├── content.ts
│   ├── db.ts
│   ├── app.ts
│   └── types.ts
├── package.json
└── tsconfig.json
```

The `src/` TypeScript files are the source. The `extension/` JavaScript files are checked in so the extension can be loaded immediately as an unpacked extension.

## Install Locally

1. Open Chrome or Edge.
2. Go to `chrome://extensions` or `edge://extensions`.
3. Enable **Developer mode**.
4. Click **Load unpacked**.
5. Select the `extension/` folder in this project.
6. Pin WebOn to the toolbar.
7. Click the WebOn icon, then choose **Open task list**.

The task list URL is:

```text
chrome-extension://EXTENSION_ID/app.html
```

Replace `EXTENSION_ID` with the ID shown for WebOn in `chrome://extensions`. You can also click the WebOn toolbar icon and use **Copy link**.

If capture is not working yet, open WebOn and click **Create test task**. If that task appears, the task list and local storage are working and the issue is isolated to browser page capture/context-menu permissions.

## Use

1. Right-click any normal webpage, with or without selected text.
2. Choose **Add selection to task list** to capture selected text, page context, and a screenshot.
3. Choose **Add manual task** to open a blank modal with no screenshot or page context.
4. Saved capture tasks include selected text when present, page title, URL, creation timestamp, and visible-page screenshot.

The quick-add modal closes automatically after 30 seconds if it is not saved. When the task name is changed, the original selected text is still preserved in the notes.

On the WebOn task page, tasks can be filtered by all, to-do, or done; sorted by manual order, creation date, or due date; and switched between ascending and descending order when date sorting is active. **Nuke list** asks for confirmation before clearing all local tasks and screenshots.

## Local Storage and Backups

- Tasks and screenshot records are stored locally in IndexedDB.
- On first task-page launch, WebOn suggests `webon-data.json` as the default backup filename.
- Where supported, **Choose save file** uses the File System Access API and writes a JSON backup to the selected local file.
- **Export JSON** downloads a full backup.
- **Import JSON** restores tasks and screenshot records from a backup.
- No cloud service, server, or login is required.

## External Imports

WebOn can import read-only local copies from:

- Microsoft To Do via Microsoft Graph `Tasks.Read`.
- Jira Cloud via a JQL search and Atlassian API token.

These imports are manual read-only pulls. WebOn does not write back to external systems.

For Microsoft To Do, paste a Microsoft Graph access token with `Tasks.Read`.
Jira Cloud does not expose a public REST endpoint for a user's exact notification inbox. WebOn uses a notification-like JQL preset instead: assigned to you, reported or created by you, watched by you, or voted by you, with unresolved issues ordered by latest update. You can edit the JQL before importing. Imported Jira tasks use Jira's issue creation date as their WebOn creation date. After a successful Jira import, WebOn stores the Jira site, email, API token, and JQL locally in IndexedDB so **Refresh Jira** can re-run the saved import. These saved credentials are not included in JSON backups.

## Development

Install TypeScript if you want to rebuild the JavaScript from `src/`:

```sh
npm install
npm run build
```

Check the loadable JavaScript syntax:

```sh
npm run check:js
```

No backend is needed for v1.
