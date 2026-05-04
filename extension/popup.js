"use strict";
(function initializePopup() {
    const chromeApi = globalThis.chrome;
    const openListButton = getElement("openListButton");
    const copyLinkButton = getElement("copyLinkButton");
    const taskListLink = getElement("taskListLink");
    const statusElement = getElement("status");
    const appUrl = chromeApi.runtime.getURL("app.html");
    taskListLink.textContent = appUrl;
    openListButton.addEventListener("click", () => {
        chromeApi.tabs.create({ url: appUrl });
        window.close();
    });
    copyLinkButton.addEventListener("click", () => {
        void copyLink();
    });
    async function copyLink() {
        try {
            await navigator.clipboard.writeText(appUrl);
            statusElement.textContent = "Copied.";
        }
        catch {
            statusElement.textContent = appUrl;
        }
    }
    function getElement(id) {
        const element = document.getElementById(id);
        if (!element) {
            throw new Error(`Missing popup element: ${id}`);
        }
        return element;
    }
})();
