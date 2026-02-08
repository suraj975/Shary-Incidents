const output = document.getElementById("output");
const scrapeBtn = document.getElementById("scrapeNow");
const openPanelBtn = document.getElementById("openPanel");
const resetBtn = document.getElementById("resetStorage");
const downloadJsonBtn = document.getElementById("downloadJson");
let storedIncidents = [];

function downloadFile(filename, content, mimeType) {
  const url = `data:${mimeType};charset=utf-8,` + encodeURIComponent(content);
  chrome.downloads.download({
    url,
    filename,
    conflictAction: "overwrite",
    saveAs: false
  });
}

function setStatus(text) {
  output.value = text;
}

scrapeBtn.addEventListener("click", async () => {
  setStatus("Scraping... keep this open");
  const startResponse = await chrome.runtime.sendMessage({ type: "START_SCRAPE" });
  if (!startResponse?.ok) {
    setStatus(startResponse?.error || "Failed to start scrape");
  }
});

openPanelBtn.addEventListener("click", async () => {
  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  if (tab?.id) {
    await chrome.sidePanel.open({ tabId: tab.id });
  }
  setStatus("Side panel opened.");
});

resetBtn.addEventListener("click", async () => {
  await chrome.storage.local.set({ incidentsJson: [], incidentSummaries: [] });
  storedIncidents = [];
  setStatus("Storage cleared.");
});

downloadJsonBtn.addEventListener("click", () => {
  if (!storedIncidents.length) {
    setStatus("No incidents in storage.");
    return;
  }
  downloadFile("site1_details.json", JSON.stringify(storedIncidents, null, 2), "application/json");
});

chrome.runtime.onMessage.addListener((message) => {
  if (message?.type === "SCRAPE_PROGRESS") {
    const { current, total, currentNumber } = message;
    const suffix = currentNumber ? ` (${currentNumber})` : "";
    setStatus(`Scraping ${current}/${total}${suffix}... keep this open`);
  }
  if (message?.type === "SCRAPE_DONE") {
    storedIncidents = message.results || [];
    chrome.storage.local.set({ incidentsJson: storedIncidents });
    setStatus(`Scrape done. Stored ${storedIncidents.length} incidents.`);
  }
  if (message?.type === "SUMMARIES_DONE") {
    storedIncidents = Array.isArray(message.incidents) ? message.incidents : storedIncidents;
    chrome.storage.local.set({
      incidentsJson: storedIncidents,
      incidentSummaries: message.summaries || []
    });
    setStatus("Summaries updated.");
  }
  if (message?.type === "SUMMARIES_ERROR") {
    setStatus(message.error || "Summary failed");
  }
  if (message?.type === "SCRAPE_ERROR") {
    setStatus(message.error || "Scrape failed");
  }
});

(async () => {
  const data = await chrome.storage.local.get(["incidentsJson"]);
  storedIncidents = Array.isArray(data.incidentsJson) ? data.incidentsJson : [];
  if (storedIncidents.length) {
    setStatus(`Loaded ${storedIncidents.length} incidents from storage.`);
  } else {
    setStatus("No incidents in storage.");
  }
})();
