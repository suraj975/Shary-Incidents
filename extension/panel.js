const statusEl = document.getElementById("status");
const listEl = document.getElementById("incident-list");
const summaryEl = document.getElementById("summary-view");
const jsonEl = document.getElementById("json-view");
const serverUrlEl = document.getElementById("server-url");
const tabSummary = document.getElementById("tab-summary");
const tabJson = document.getElementById("tab-json");
const summaryPane = document.getElementById("summary-pane");
const jsonPane = document.getElementById("json-pane");

const btnLoad = document.getElementById("btn-load");
const btnScrape = document.getElementById("btn-scrape");
const btnClear = document.getElementById("btn-clear");
const btnDownload = document.getElementById("btn-download");
const btnSummarize = document.getElementById("btn-summarize");
const fileInput = document.getElementById("file-input");

let incidents = [];
let summaries = [];
let activeIndex = -1;

function setStatus(text, isError = false) {
  statusEl.textContent = text;
  statusEl.style.color = isError ? "#ff6b6b" : "#9aa3b2";
}

function renderList() {
  listEl.innerHTML = "";
  incidents.forEach((item, index) => {
    const entry = document.createElement("div");
    const isAlert = isOlderThanThreeDays(item.Opened || item.opened_at || "");
    entry.className = "item" + (isAlert ? " alert" : "") + (index === activeIndex ? " active" : "");
    const title = document.createElement("div");
    title.className = "item-title";
    title.textContent = item.Number || item.number || `Incident ${index + 1}`;
    const meta = document.createElement("div");
    meta.className = "item-meta";
    meta.textContent = `${item.State || item.state || "Unknown"} | ${item.Opened || ""}`;
    entry.appendChild(title);
    entry.appendChild(meta);
    entry.addEventListener("click", () => {
      activeIndex = index;
      renderList();
      renderDetail();
    });
    listEl.appendChild(entry);
  });
}

function renderDetail() {
  if (activeIndex < 0 || activeIndex >= incidents.length) {
    summaryEl.textContent = "";
    jsonEl.textContent = "";
    return;
  }
  const incident = incidents[activeIndex];
  if (incident.summaryStructured) {
    summaryEl.innerHTML = renderStructuredSummary(incident.summaryStructured, incident);
  } else {
    const summaryItem = summaries.find((s) => s.number === (incident.Number || incident.number || ""));
    summaryEl.textContent = summaryItem?.summary || "No summary yet.";
  }
  jsonEl.innerHTML = buildDetailsHtml(incident);
}

function renderStructuredSummary(summary, incident) {
  const badges = buildBadges(incident, summary);
  const timelineItems = (summary.key_timeline || [])
    .map((item) => `<li>${escapeHtml(item)}</li>`)
    .join("");
  const evidenceItems = (summary.evidence || [])
    .map((item) => `<li>${escapeHtml(item)}</li>`)
    .join("");
  const attachmentItems = (summary.attachments || [])
    .map((item) => `<li>${linkify(item)}</li>`)
    .join("");

  return `
    <div class="summary-header">
      <div class="summary-title">${escapeHtml(summary.title || incident.Number || "")}</div>
      <div class="badges">${badges}</div>
    </div>
    <details open class="section">
      <summary>What happened</summary>
      <div class="section-body">${escapeHtml(summary.what_happened || "No details.")}</div>
    </details>
    <details open class="section">
      <summary>Key timeline</summary>
      <ul class="section-list">${timelineItems || "<li>No timeline available.</li>"}</ul>
    </details>
    <details class="section">
      <summary>Current application state</summary>
      <div class="section-body">${formatCurrentState(summary.current_application_state || {})}</div>
    </details>
    <details class="section">
      <summary>Evidence</summary>
      <ul class="section-list">${evidenceItems || "<li>No evidence listed.</li>"}</ul>
    </details>
    <details class="section">
      <summary>Attachments</summary>
      <ul class="section-list">${attachmentItems || "<li>No attachments.</li>"}</ul>
    </details>
  `;
}

function formatCurrentState(state) {
  const rows = [
    ["Status", state.status || ""],
    ["Application ID", state.application_id || ""],
    ["Presale No", state.presale_no || ""],
    ["Emirates ID", state.emirates_id || ""],
    ["Chassis No", state.chassis_no || ""],
    ["Details", state.details || ""]
  ]
    .filter(([, value]) => value)
    .map(
      ([key, value]) =>
        `<div class="detail-key">${escapeHtml(key)}</div><div class="detail-value">${escapeHtml(String(value))}</div>`
    )
    .join("");
  return `<div class="details-grid">${rows || "<div class='detail-value'>No state data.</div>"}</div>`;
}

function buildBadges(incident, summary) {
  const badges = [];
  const state = incident.State || incident.state || "";
  const priority = incident.Priority || "";
  const appStatus = summary.current_application_state?.status || "";
  if (state) badges.push(`<span class="badge">${escapeHtml(state)}</span>`);
  if (priority) badges.push(`<span class="badge warning">${escapeHtml(priority)}</span>`);
  if (appStatus) badges.push(`<span class="badge info">${escapeHtml(appStatus)}</span>`);
  return badges.join("");
}

function buildDetailsHtml(incident) {
  const keys = incident.applicationKeys || {};
  const app = incident.applicationData || {};
  const items = [
    ["Number", incident.Number || incident.number || ""],
    ["State", incident.State || incident.state || ""],
    ["Opened", incident.Opened || incident.opened_at || ""],
    ["Reported For", incident["Reported For"] || ""],
    ["Assignment Group", incident["Assignment Group"] || ""],
    ["ApplicationId", keys.applicationId || ""],
    ["EmiratesId", keys.emiratesId || ""],
    ["Presale No", keys.presaleNo || ""],
    ["Chassis No", keys.chassisNo || ""]
  ];

  const appItems = Object.keys(app).slice(0, 12).map((key) => [key, app[key]]);

  const rows = [...items, ...appItems]
    .filter(([, value]) => value !== null && value !== undefined && String(value).trim() !== "")
    .map(
      ([key, value]) =>
        `<div class="detail-key">${escapeHtml(String(key))}</div><div class="detail-value">${escapeHtml(String(value))}</div>`
    )
    .join("");

  return `<div class="details-grid">${rows || "<div class='detail-value'>No details available.</div>"}</div>`;
}

function escapeHtml(value) {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#039;");
}

function linkify(value) {
  const text = escapeHtml(value);
  const urlMatch = value.match(/https?:\/\/\S+/);
  if (!urlMatch) return text;
  const url = escapeHtml(urlMatch[0]);
  const label = url.length > 48 ? `${url.slice(0, 48)}…` : url;
  return `${text.replace(
    url,
    `<a href="${url}" target="_blank" rel="noreferrer">${label}</a>`
  )}`;
}

function isOlderThanThreeDays(dateText) {
  if (!dateText) return false;
  const parsed = new Date(dateText.replace(" ", "T"));
  if (Number.isNaN(parsed.getTime())) return false;
  const now = Date.now();
  const diffDays = (now - parsed.getTime()) / (1000 * 60 * 60 * 24);
  return diffDays > 3;
}

function setActiveTab(tab) {
  if (tab === "summary") {
    tabSummary.classList.add("active");
    tabJson.classList.remove("active");
    summaryPane.classList.add("active");
    jsonPane.classList.remove("active");
  } else {
    tabJson.classList.add("active");
    tabSummary.classList.remove("active");
    jsonPane.classList.add("active");
    summaryPane.classList.remove("active");
  }
}

tabSummary.addEventListener("click", () => setActiveTab("summary"));
tabJson.addEventListener("click", () => setActiveTab("json"));

async function loadFromStorage() {
  const data = await chrome.storage.local.get(["incidentsJson", "incidentSummaries"]);
  incidents = Array.isArray(data.incidentsJson) ? data.incidentsJson : [];
  summaries = Array.isArray(data.incidentSummaries) ? data.incidentSummaries : [];
  activeIndex = incidents.length ? 0 : -1;
  renderList();
  renderDetail();
  setStatus(incidents.length ? `Loaded ${incidents.length} incidents.` : "No incidents in storage.");
}

async function saveToStorage() {
  await chrome.storage.local.set({
    incidentsJson: incidents,
    incidentSummaries: summaries
  });
}

btnLoad.addEventListener("click", () => {
  loadFromStorage();
});

btnScrape.addEventListener("click", async () => {
  setStatus("Scraping... keep this open");
  const response = await chrome.runtime.sendMessage({ type: "START_SCRAPE" });
  if (!response?.ok) {
    setStatus(response?.error || "Failed to start scrape", true);
  }
});

btnClear.addEventListener("click", async () => {
  incidents = [];
  summaries = [];
  activeIndex = -1;
  await saveToStorage();
  renderList();
  renderDetail();
  setStatus("Cleared.");
});

btnDownload.addEventListener("click", () => {
  if (!incidents.length) {
    setStatus("No incidents to download.", true);
    return;
  }
  const payload = JSON.stringify(incidents, null, 2);
  const url = "data:application/json;charset=utf-8," + encodeURIComponent(payload);
  chrome.downloads.download({
    url,
    filename: "site1_details.json",
    conflictAction: "overwrite",
    saveAs: false
  });
  setStatus("Downloaded site1_details.json");
});

fileInput.addEventListener("change", async (event) => {
  const file = event.target.files?.[0];
  if (!file) return;
  const text = await file.text();
  try {
    const parsed = JSON.parse(text);
    if (!Array.isArray(parsed)) {
      setStatus("JSON must be an array of incidents.", true);
      return;
    }
    incidents = parsed;
    summaries = [];
    activeIndex = incidents.length ? 0 : -1;
    await saveToStorage();
    renderList();
    renderDetail();
    setStatus(`Imported ${incidents.length} incidents.`);
  } catch (error) {
    setStatus("Invalid JSON file.", true);
  }
});

btnSummarize.addEventListener("click", async () => {
  if (!incidents.length) {
    setStatus("No incidents to summarize.", true);
    return;
  }
  const serverUrl = serverUrlEl.value.trim();
  if (!serverUrl) {
    setStatus("Missing server URL.", true);
    return;
  }
  setStatus("Summarizing...");
  try {
    const response = await fetch(serverUrl, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ incidents })
    });
    if (!response.ok) {
      const text = await response.text();
      throw new Error(text || "Server error");
    }
    const data = await response.json();
    summaries = Array.isArray(data.summaries) ? data.summaries : [];
    const byNumber = new Map();
    for (const item of summaries) {
      if (item?.number) byNumber.set(item.number, item);
    }
    incidents = incidents.map((incident) => {
      const number = incident.Number || incident.number || "";
      const summaryObj = byNumber.get(number);
      if (!summaryObj) return incident;
      return {
        ...incident,
        summary: summaryObj.summary || "",
        summaryStructured: summaryObj.structured || null
      };
    });
    await saveToStorage();
    renderDetail();
    setStatus(`Summaries updated (${summaries.length}).`);
  } catch (error) {
    setStatus(String(error), true);
  }
});

chrome.runtime.onMessage.addListener((message) => {
  if (message?.type === "SCRAPE_PROGRESS") {
    const { current, total, currentNumber } = message;
    const suffix = currentNumber ? ` (${currentNumber})` : "";
    setStatus(`Scraping ${current}/${total}${suffix}... keep this open`);
  }
  if (message?.type === "SCRAPE_DONE") {
    incidents = message.results || [];
    summaries = [];
    chrome.storage.local.set({ incidentsJson: incidents });
    activeIndex = incidents.length ? 0 : -1;
    renderList();
    renderDetail();
    setStatus(`Scrape done. Stored ${incidents.length} incidents.`);
  }
  if (message?.type === "SUMMARIES_DONE") {
    summaries = Array.isArray(message.summaries) ? message.summaries : [];
    incidents = Array.isArray(message.incidents) ? message.incidents : incidents;
    chrome.storage.local.set({ incidentsJson: incidents, incidentSummaries: summaries });
    renderList();
    renderDetail();
    setStatus(`Summaries updated (${summaries.length}).`);
  }
  if (message?.type === "SUMMARIES_ERROR") {
    setStatus(message.error || "Summary failed", true);
  }
  if (message?.type === "SCRAPE_ERROR") {
    setStatus(message.error || "Scrape failed", true);
  }
});

loadFromStorage();
