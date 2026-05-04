(function initializePopup() {
  const chromeApi = (globalThis as { chrome?: any }).chrome;
  const openListButton = getElement<HTMLButtonElement>("openListButton");
  const copyLinkButton = getElement<HTMLButtonElement>("copyLinkButton");
  const taskListLink = getElement<HTMLElement>("taskListLink");
  const statusElement = getElement<HTMLElement>("status");

  const appUrl = chromeApi.runtime.getURL("app.html");
  taskListLink.textContent = appUrl;

  openListButton.addEventListener("click", () => {
    chromeApi.tabs.create({ url: appUrl });
    window.close();
  });

  copyLinkButton.addEventListener("click", () => {
    void copyLink();
  });

  async function copyLink(): Promise<void> {
    try {
      await navigator.clipboard.writeText(appUrl);
      statusElement.textContent = "Copied.";
    } catch {
      statusElement.textContent = appUrl;
    }
  }

  function getElement<T extends HTMLElement>(id: string): T {
    const element = document.getElementById(id);
    if (!element) {
      throw new Error(`Missing popup element: ${id}`);
    }
    return element as T;
  }
})();
