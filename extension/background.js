let runState = {
  running: false,
  results: [],
  startedAt: 0
};

const STALE_RUN_MS = 2 * 60 * 1000;
const ADMIN_BASE_URL = "https://admin.sharyuae.ae/reports/applications-report";
const LLM_SERVER_URL = "http://localhost:8787/summarize";
const ATTACHMENT_MAX_BYTES = 8 * 1024 * 1024; // 8MB safety cap per attachment
const ATTACHMENT_RETRIES = 2;

function downloadJson(results) {
  const payload = JSON.stringify(results, null, 2);
  const url = "data:application/json;charset=utf-8," + encodeURIComponent(payload);
  chrome.downloads.download({
    url,
    filename: "site1_details.json",
    conflictAction: "overwrite",
    saveAs: false
  });
}

function arrayBufferToBase64(buffer) {
  let binary = "";
  const bytes = new Uint8Array(buffer);
  const chunkSize = 0x8000; // keep call stack safe
  for (let i = 0; i < bytes.length; i += chunkSize) {
    const chunk = bytes.subarray(i, i + chunkSize);
    binary += String.fromCharCode.apply(null, chunk);
  }
  return btoa(binary);
}

async function fetchAttachmentData(attachment) {
  const url = attachment.href;
  if (!url) throw new Error("Missing attachment URL");
  let lastError = null;
  for (let i = 0; i <= ATTACHMENT_RETRIES; i += 1) {
    try {
      const response = await fetch(url, { credentials: "include" });
      if (!response.ok) throw new Error(`HTTP ${response.status}`);

      const arrayBuffer = await response.arrayBuffer();
      if (arrayBuffer.byteLength > ATTACHMENT_MAX_BYTES) {
        throw new Error(`Attachment too large (${arrayBuffer.byteLength} bytes)`);
      }

      const contentType = response.headers.get("content-type") || "";
      const base64 = arrayBufferToBase64(arrayBuffer);

      return {
        fileName: attachment.fileName || "",
        url,
        contentType,
        sizeBytes: arrayBuffer.byteLength,
        base64
      };
    } catch (error) {
      lastError = error;
      await sleep(300);
    }
  }
  throw lastError || new Error("Attachment fetch failed");
}

async function collectAttachmentsFromDetail(detail) {
  if (!detail?.activity || !Array.isArray(detail.activity)) return [];

  const attachments = detail.activity
    .map((entry) => entry?.attachment)
    .filter((att) => att && att.href);

  if (!attachments.length) return [];

  const results = await Promise.allSettled(attachments.map((att) => fetchAttachmentData(att)));
  return results.map((res, index) => {
    const source = attachments[index];
    if (res.status === "fulfilled") return res.value;
    return {
      fileName: source.fileName || "",
      url: source.href,
      error: String(res.reason || "Unknown error")
    };
  });
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function formatDateRangeLastTwoMonths() {
  const end = new Date();
  end.setHours(23, 59, 0, 0);
  const start = new Date(end);
  start.setMonth(start.getMonth() - 2);
  start.setHours(0, 0, 0, 0);
  const pad = (value) => String(value).padStart(2, "0");
  const fmt = (date, time) =>
    `${pad(date.getDate())}/${pad(date.getMonth() + 1)}/${date.getFullYear()} ${time}`;
  return `${fmt(start, "00:00")} - ${fmt(end, "23:59")}`;
}

function extractKeysFromDetail(detail) {
  if (!detail?.activity || !Array.isArray(detail.activity)) return {};
  const parts = [];
  for (const entry of detail.activity) {
    if (entry?.text) parts.push(entry.text);
    if (Array.isArray(entry?.records)) {
      for (const record of entry.records) {
        if (record?.key || record?.value) {
          parts.push(`${record?.key || ""} ${record?.value || ""}`.trim());
        }
      }
    }
  }
  const combined = parts.join(" ").replace(/\s+/g, " ");
  const unescaped = combined.replace(/\\\"/g, "\"").replace(/\\\\/g, "\\");

  const findMatch = (regex) => {
    const match = unescaped.match(regex) || combined.match(regex);
    return match ? match[1] : "";
  };

  const findMatchAny = (regexes) => {
    for (const regex of regexes) {
      const value = findMatch(regex);
      if (value) return value;
    }
    return "";
  };

  const extractFromPayloads = () => {
    const payloadRegex = /payload"\s*:\s*"(\\{.+?\\})"/gi;
    const results = [];
    let match = null;
    while ((match = payloadRegex.exec(combined)) !== null) {
      const raw = match[1];
      const cleaned = raw.replace(/\\\"/g, "\"").replace(/\\\\/g, "\\");
      try {
        results.push(JSON.parse(cleaned));
      } catch (error) {
        // ignore parse errors
      }
    }
    return results;
  };

  const applicationId = findMatchAny([
    /(?:applicationId|ApplicationId|ApplicationID)\s*[:=]\s*"?(\d{4,})"?/i,
    /ApplicationId\\?["']?\s*[:=]\s*\\?"?(\d{4,})/i
  ]);
  const emiratesId = findMatchAny([
    /(?:emiratesId|EmiratesId|EmiratesID)\s*[:=]\s*"?(\d{5,})"?/i,
    /EmiratesId\\?["']?\s*[:=]\s*\\?"?(\d{5,})/i
  ]);
  const refKey = findMatchAny([
    /RefKey\s*[:=]\s*"?(\d{3,})"?/i,
    /RefKey\\?["']?\s*[:=]\s*\\?"?(\d{3,})/i
  ]);
  const presaleNoRaw = findMatchAny([
    /presaleNo\s*[:=]\s*"?(\d{3,})"?/i,
    /presaleNo\\?["']?\s*[:=]\s*\\?"?(\d{3,})/i
  ]);
  const presaleNo = refKey || presaleNoRaw;
  const sellerChassisNo = findMatchAny([
    /sellerChassisNo\s*[:=]\s*"?([A-Za-z0-9]+)"?/i,
    /sellerChassisNo\\?["']?\s*[:=]\s*\\?"?([A-Za-z0-9]+)/i
  ]);
  const chassisNo = sellerChassisNo || findMatchAny([
    /(?:chassisNo|ChassisNo)\s*[:=]\s*"?([A-Za-z0-9]+)"?/i,
    /(?:chassisNo|ChassisNo)\\?["']?\s*[:=]\s*\\?"?([A-Za-z0-9]+)/i
  ]);

  const payloads = extractFromPayloads();
  let parsedApplicationId = "";
  let parsedEmiratesId = "";
  let parsedPresaleNo = "";
  let parsedChassisNo = "";
  for (const payload of payloads) {
    if (!parsedApplicationId) parsedApplicationId = String(payload.applicationId || payload.ApplicationId || payload.ApplicationID || "");
    if (!parsedEmiratesId) parsedEmiratesId = String(payload.emiratesId || payload.EmiratesId || payload.EmiratesID || "");
    if (!parsedPresaleNo) parsedPresaleNo = String(payload.RefKey || payload.presaleNo || payload.preAppSerialNo || payload.PresaleNo || "");
    if (!parsedChassisNo) parsedChassisNo = String(payload.sellerChassisNo || payload.chassisNo || payload.ChassisNo || "");
  }

  return {
    applicationId: applicationId || parsedApplicationId,
    emiratesId: emiratesId || parsedEmiratesId,
    presaleNo: presaleNo || parsedPresaleNo,
    chassisNo: chassisNo || parsedChassisNo
  };
}

async function waitForTabComplete(tabId, timeoutMs = 15000) {
  return new Promise((resolve, reject) => {
    const listener = (id, info) => {
      if (id === tabId && info.status === "complete") {
        chrome.tabs.onUpdated.removeListener(listener);
        resolve();
      }
    };
    chrome.tabs.onUpdated.addListener(listener);
    setTimeout(() => {
      chrome.tabs.onUpdated.removeListener(listener);
      reject(new Error("Tab load timeout"));
    }, timeoutMs);
  });
}

async function withTimeout(promise, timeoutMs, label) {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => {
      reject(new Error(`${label} timeout`));
    }, timeoutMs);
    promise
      .then((res) => {
        clearTimeout(timer);
        resolve(res);
      })
      .catch((err) => {
        clearTimeout(timer);
        reject(err);
      });
  });
}

async function injectContentScript(tabId) {
  await chrome.scripting.executeScript({
    target: { tabId, allFrames: true },
    files: ["content.js"]
  });
}

async function scrapeDetailViaExecute(tabId, selectors) {
  const runExec = async (allFrames) => {
    return chrome.scripting.executeScript({
      target: allFrames ? { tabId, allFrames: true } : { tabId },
      args: [selectors || null],
      func: (selectorsArg) => {
      const normalizeText = (value) => {
        if (!value) return "";
        return value.replace(/\s+/g, " ").trim();
      };

      const findDetailContainer = (selectors) => {
        const defaults = { mainContainer: "#sn_form_inline_stream_entries" };
        const resolved = { ...defaults, ...(selectors || {}) };
        let container = document.querySelector(resolved.mainContainer);
        if (container) return container;
        const mainFrame = document.querySelector("iframe#gsft_main, iframe[name='gsft_main']");
        if (mainFrame) {
          try {
            const doc = mainFrame.contentDocument;
            if (doc) {
              const found = doc.querySelector(resolved.mainContainer);
              if (found) return found;
            }
          } catch (error) {
            // ignore
          }
        }
        return null;
      };

      const scrapeDetailPage = (container) => {
        if (!container) return { error: "Detail container not found" };
        const entries = Array.from(container.querySelectorAll("li.h-card"));
        const activity = entries.map((entry) => {
          const timeWrap = entry.querySelector(".sn-card-component-time");
          const typeEl = timeWrap ? timeWrap.querySelector("span") : null;
          const timeEl = entry.querySelector(".date-calendar");
          const byEl = entry.querySelector(".sn-card-component-createdby");
          const bodyEl = entry.querySelector(".sn-widget-textblock-body");
          const recordRows = Array.from(entry.querySelectorAll(".sn-widget-list-table li"));
          const records = recordRows
            .map((li) => {
              const cells = Array.from(li.querySelectorAll(".sn-widget-list-table-cell"));
              const key = normalizeText(cells[0]?.textContent || "");
              const value = normalizeText(cells[1]?.textContent || "");
              if (!key && !value) return null;
              return { key, value };
            })
            .filter(Boolean);
          const attachmentLink = entry.querySelector(".sn-card-component_attachment a.stream-action");
          const attachment = attachmentLink
            ? {
                href: new URL(attachmentLink.getAttribute("href") || "", window.location.origin).toString(),
                fileName: attachmentLink.getAttribute("file-name") || "",
                size: attachmentLink.getAttribute("size") || ""
              }
            : null;
          return {
            type: normalizeText(typeEl ? typeEl.textContent : ""),
            time: normalizeText(timeEl ? timeEl.textContent : ""),
            by: normalizeText(byEl ? byEl.textContent : ""),
            text: normalizeText(bodyEl ? bodyEl.textContent : ""),
            records,
            attachment
          };
        });
        return { activity };
      };

      const container = findDetailContainer(selectorsArg);
      if (!container) return { ok: false, error: "Detail container not found" };
      const detail = scrapeDetailPage(container);
      if (detail.error) return { ok: false, error: detail.error };
      return { ok: true, detail };
      }
    });
  };

  let execResults = await runExec(false);
  for (const item of execResults) {
    if (item?.result?.ok) return { ok: true, detail: item.result.detail };
  }

  execResults = await runExec(true);
  for (const item of execResults) {
    if (item?.result?.ok) return { ok: true, detail: item.result.detail };
  }

  const firstError = execResults.map((r) => r?.result?.error).find(Boolean);
  return { ok: false, error: firstError || "Detail not found in frames" };
}

async function scrapeAdminApplication(keys) {
  if (!keys || (!keys.applicationId && !keys.presaleNo && !keys.emiratesId && !keys.chassisNo)) {
    return { ok: false, error: "No admin lookup keys found" };
  }

  let adminTab;
  try {
    adminTab = await withTimeout(
      chrome.tabs.create({ url: ADMIN_BASE_URL, active: false }),
      5000,
      "Open admin tab"
    );
  } catch (error) {
    return { ok: false, error: "Failed to open admin tab" };
  }

  try {
    await withTimeout(waitForTabComplete(adminTab.id, 20000), 25000, "Admin tab load");
    await withTimeout(waitForTabUrl(adminTab.id, "https://admin.sharyuae.ae/"), 10000, "Admin URL check");
    await sleep(1000);
    const dateRange = formatDateRangeLastTwoMonths();

    const execResults = await withTimeout(
      chrome.scripting.executeScript({
        target: { tabId: adminTab.id },
        args: [{ ...keys, dateRange }],
        func: async (payload) => {
          const normalizeText = (value) => (value || "").replace(/\s+/g, " ").trim();
          const setInputValue = (input, value) => {
            if (!input) return false;
            const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")?.set;
            if (setter) {
              setter.call(input, String(value));
            } else {
              input.value = String(value);
            }
            input.dispatchEvent(new Event("input", { bubbles: true }));
            input.dispatchEvent(new Event("change", { bubbles: true }));
            input.dispatchEvent(new Event("blur", { bubbles: true }));
            return true;
          };

          const findInputByPlaceholder = (text) => {
            const inputs = Array.from(document.querySelectorAll("input"));
            return inputs.find((input) => (input.getAttribute("placeholder") || "").includes(text));
          };

          const findInputByLabel = (labelText) => {
            const labels = Array.from(document.querySelectorAll("label"));
            const label = labels.find((l) => normalizeText(l.textContent).startsWith(labelText));
            if (!label) return null;
            const container = label.closest("div");
            if (!container) return null;
            return container.parentElement?.querySelector("input") || container.querySelector("input");
          };

          const dateInput =
            findInputByPlaceholder("From DD/MM/YYYY") ||
            findInputByLabel("Request Date");
          setInputValue(dateInput, payload.dateRange);

          const applicationInput =
            findInputByPlaceholder("Enter Application No.") ||
            findInputByLabel("Application No.");
          const presaleInput =
            findInputByPlaceholder("Enter Presale No") ||
            findInputByLabel("Presale No.");
          const emiratesInput =
            findInputByPlaceholder("Enter Emirates ID") ||
            findInputByLabel("Emirates ID No");
          const chassisInput =
            findInputByPlaceholder("Enter Chassis No") ||
            findInputByLabel("Chassis No");

          const clearInput = (input) => setInputValue(input, "");
          clearInput(applicationInput);
          clearInput(presaleInput);
          clearInput(emiratesInput);
          clearInput(chassisInput);

          const primaryKey =
            payload.applicationId ||
            payload.presaleNo ||
            payload.emiratesId ||
            payload.chassisNo ||
            "";

          if (primaryKey && payload.applicationId) setInputValue(applicationInput, payload.applicationId);
          else if (primaryKey && payload.presaleNo) setInputValue(presaleInput, payload.presaleNo);
          else if (primaryKey && payload.emiratesId) setInputValue(emiratesInput, payload.emiratesId);
          else if (primaryKey && payload.chassisNo) setInputValue(chassisInput, payload.chassisNo);

          const searchButton = Array.from(document.querySelectorAll("button"))
            .find((btn) => normalizeText(btn.textContent) === "Search");
          const waitForEnabledSearch = () =>
            new Promise((resolve) => {
              const start = Date.now();
              const timer = setInterval(() => {
                const dateValue = normalizeText(dateInput?.value || "");
                const ready =
                  dateValue === normalizeText(payload.dateRange) &&
                  searchButton &&
                  !searchButton.disabled;
                if (ready) {
                  clearInterval(timer);
                  resolve(true);
                  return;
                }
                if (Date.now() - start > 8000) {
                  clearInterval(timer);
                  resolve(false);
                }
              }, 300);
            });

          const searchReady = await waitForEnabledSearch();
          if (!searchReady) {
            // Retry date once, then re-check.
            setInputValue(dateInput, payload.dateRange);
            await new Promise((r) => setTimeout(r, 300));
            if (!searchButton || searchButton.disabled) {
              return { ok: false, error: "Search disabled" };
            }
          }

          if (searchButton && !searchButton.disabled) {
            searchButton.click();
          }

          const waitForResults = () => new Promise((resolve) => {
            const start = Date.now();
            const timer = setInterval(() => {
              const table = document.querySelector(".table.w-full");
              const row = table?.querySelector(".table-row.dg_TableRowEven, .table-row.dg_TableRowOdd");
              if (table && row) {
                clearInterval(timer);
                resolve({ table, row });
                return;
              }
              if (Date.now() - start > 15000) {
                clearInterval(timer);
                resolve(null);
              }
            }, 500);
          });

          const result = await waitForResults();
          if (!result) return { ok: false, error: "Admin results not found" };

          const headerRow = result.table.querySelector(".table-row");
          const headerCells = headerRow
            ? Array.from(headerRow.querySelectorAll(".table-cell"))
                .map((cell) => normalizeText(cell.textContent))
                .filter(Boolean)
            : [];
          const dataCells = Array.from(result.row.querySelectorAll(".table-cell"))
            .map((cell) => normalizeText(cell.textContent));
          const applicationData = {};
          headerCells.forEach((header, index) => {
            applicationData[header] = dataCells[index] || "";
          });
          return { ok: true, applicationData };
        }
      }),
      20000,
      "Admin scrape"
    );

    const result = execResults?.[0]?.result;
    if (!result?.ok) {
      return { ok: false, error: result?.error || "Admin scrape failed" };
    }
    return { ok: true, applicationData: result.applicationData };
  } catch (error) {
    return { ok: false, error: String(error) };
  } finally {
    try {
      await chrome.tabs.remove(adminTab.id);
    } catch (error) {
      // ignore
    }
  }
}

async function summarizeWithLocalServer(incidents) {
  try {
    const response = await fetch(LLM_SERVER_URL, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ incidents })
    });
    if (!response.ok) {
      return { ok: false, error: await response.text() };
    }
    const data = await response.json();
    return { ok: true, summaries: Array.isArray(data.summaries) ? data.summaries : [] };
  } catch (error) {
    const message =
      String(error) === "TypeError: Failed to fetch"
        ? `LLM server unreachable at ${LLM_SERVER_URL}. Run \`npm run llm-server\` or update LLM_SERVER_URL.`
        : String(error);
    return { ok: false, error: message };
  }
}

function mergeSummariesIntoIncidents(incidents, summaries) {
  const byNumber = new Map();
  for (const item of summaries || []) {
    if (item?.number) byNumber.set(item.number, item);
  }
  return incidents.map((incident) => {
    const number = incident.Number || incident.number || "";
    const summaryObj = byNumber.get(number);
    if (!summaryObj) return incident;
    return { ...incident, summary: summaryObj.summary || "", summaryStructured: summaryObj.structured || null };
  });
}

function attachFetchedFiles(resultRow, attachments) {
  if (!attachments || !attachments.length) return resultRow;
  const successful = attachments.filter((a) => !a.error);
  const failed = attachments.filter((a) => a.error);
  const withAttachments = { ...resultRow };
  if (successful.length) withAttachments.attachments = successful;
  if (failed.length) withAttachments.attachmentErrors = failed;
  return withAttachments;
}

async function sendMessageWithRetry(tabId, message, retries = 15) {
  for (let i = 0; i < retries; i += 1) {
    try {
      const response = await chrome.tabs.sendMessage(tabId, message);
      if (response) return response;
    } catch (error) {
      // content script may not be ready yet
    }
    await sleep(300);
  }
  throw new Error("Failed to reach content script on tab " + tabId);
}

async function waitForTabUrl(tabId, prefix, retries = 20) {
  for (let i = 0; i < retries; i += 1) {
    const tab = await chrome.tabs.get(tabId);
    if (tab?.url && tab.url.startsWith(prefix)) return tab.url;
    await sleep(300);
  }
  throw new Error("Tab did not reach expected URL prefix: " + prefix);
}

chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  if (message?.type === "START_SCRAPE") {
    const now = Date.now();
    if (runState.running && now - runState.startedAt < STALE_RUN_MS) {
      sendResponse({ ok: false, error: "Scrape already running" });
      return true;
    }
    if (runState.running && now - runState.startedAt >= STALE_RUN_MS) {
      runState = { running: false, results: [], startedAt: 0 };
    }
    runState = { running: true, results: [], startedAt: now };

    (async () => {
      try {
        const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
        if (!tab?.id) throw new Error("No active tab found");

        await injectContentScript(tab.id);
        await sleep(300);
        const listResponse = await sendMessageWithRetry(tab.id, { type: "GET_LIST_ROWS" });
        if (!listResponse?.ok) throw new Error(listResponse?.error || "Failed to read list rows");

        const rows = listResponse.rows || [];
        chrome.runtime.sendMessage({ type: "SCRAPE_PROGRESS", current: 0, total: rows.length });
        for (let i = 0; i < rows.length; i += 1) {
          const row = rows[i];
          chrome.runtime.sendMessage({
            type: "SCRAPE_PROGRESS",
            current: i + 1,
            total: rows.length,
            currentNumber: row.Number || row.number || ""
          });
          if (!row.linkUrl) {
            runState.results.push({ ...row, detailError: "Missing link URL" });
            continue;
          }

          const processRow = async () => {
            let detailTab;
            let detailPayload = null;
            let detailError = null;
            try {
              detailTab = await withTimeout(
                chrome.tabs.create({ url: row.linkUrl, active: false }),
                5000,
                "Open tab"
              );
            } catch (error) {
              runState.results.push({ ...row, detailError: "Failed to open detail tab" });
              return;
            }

            try {
              await withTimeout(waitForTabComplete(detailTab.id, 15000), 20000, "Tab load");
              await withTimeout(waitForTabUrl(detailTab.id, "https://esm.gov.ae/"), 10000, "URL check");
              await sleep(1200);
              const detailResponse = await withTimeout(
                scrapeDetailViaExecute(detailTab.id, message.selectors || null),
                10000,
                "Detail scrape"
              );

              if (!detailResponse?.ok) {
                detailError = detailResponse?.error || "Detail scrape failed";
              } else {
                detailPayload = detailResponse.detail;
              }
            } catch (error) {
              detailError = String(error);
            } finally {
              try {
                await chrome.tabs.remove(detailTab.id);
              } catch (error) {
                // ignore
              }
            }

            const resultRow = { ...row };
            if (detailPayload) resultRow.detail = detailPayload;
            if (detailError) resultRow.detailError = detailError;

            if (detailPayload) {
              const attachments = await collectAttachmentsFromDetail(detailPayload);
              const withAttachments = attachFetchedFiles(resultRow, attachments);
              Object.assign(resultRow, withAttachments);
            }

            if (detailPayload) {
              const keys = extractKeysFromDetail(detailPayload);
              resultRow.applicationKeys = keys;
              if (keys.applicationId || keys.presaleNo || keys.emiratesId || keys.chassisNo) {
                const adminResponse = await scrapeAdminApplication(keys);
                if (adminResponse.ok) {
                  resultRow.applicationData = adminResponse.applicationData;
                } else {
                  resultRow.applicationError = adminResponse.error;
                }
              } else {
                resultRow.applicationError = "No admin lookup keys found";
              }
            }

            runState.results.push(resultRow);
          };

          await withTimeout(processRow(), 60000, "Row processing");
        }

        runState.running = false;
        chrome.storage.local.set({ incidentsJson: runState.results });
        chrome.runtime.sendMessage({ type: "SCRAPE_DONE", results: runState.results });
        downloadJson(runState.results);

        const summaryResponse = await summarizeWithLocalServer(runState.results);
        if (summaryResponse.ok) {
          const merged = mergeSummariesIntoIncidents(runState.results, summaryResponse.summaries);
          runState.results = merged;
          chrome.storage.local.set({
            incidentsJson: merged,
            incidentSummaries: summaryResponse.summaries
          });
          chrome.runtime.sendMessage({
            type: "SUMMARIES_DONE",
            summaries: summaryResponse.summaries,
            incidents: merged
          });
        } else {
          chrome.runtime.sendMessage({ type: "SUMMARIES_ERROR", error: summaryResponse.error });
        }
      } catch (error) {
        runState.running = false;
        chrome.runtime.sendMessage({ type: "SCRAPE_ERROR", error: String(error) });
      }
    })();

    sendResponse({ ok: true });
    return true;
  }

  if (message?.type === "GET_RESULTS") {
    sendResponse({ ok: true, running: runState.running, results: runState.results });
    return true;
  }

  if (message?.type === "RESET_STATE") {
    runState = { running: false, results: [], startedAt: 0 };
    chrome.storage.local.set({ incidentsJson: [], incidentSummaries: [] });
    sendResponse({ ok: true });
    return true;
  }

  return false;
});
