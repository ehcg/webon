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
6. Click the extension icon to open the task list.

## Use

1. Select text on any normal webpage.
2. Right-click the selection.
3. Choose **Add selection to task list** to edit the task before saving, or **Add task directly** to save immediately.
4. The task captures the selected text, page title, URL, creation timestamp, and visible-page screenshot.

The quick-add modal closes automatically after 30 seconds if it is not saved. When the task name is changed, the original selected text is still preserved in the notes.

## Local Storage and Backups

- Tasks and screenshot records are stored locally in IndexedDB.
- On first task-page launch, WebOn suggests `webon-data.json` as the default backup filename.
- Where supported, **Choose save file** uses the File System Access API and writes a JSON backup to the selected local file.
- **Export JSON** downloads a full backup.
- **Import JSON** restores tasks and screenshot records from a backup.
- No cloud service, server, or login is required.

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
