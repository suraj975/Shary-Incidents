function normalizeText(value) {
  if (!value) return "";
  return value.replace(/\s+/g, " ").trim();
}

function getRowText(row, columnKey) {
  const cell = row.querySelector(`.row-cell[data-column-key="${columnKey}"]`);
  return normalizeText(cell ? cell.textContent : "");
}

function getRowLink(row, columnKey) {
  const cell = row.querySelector(`.row-cell[data-column-key="${columnKey}"] a`);
  if (!cell) return "";
  const href = cell.getAttribute("href");
  if (!href) return "";
  if (href.startsWith("http")) return href;
  return new URL(href, window.location.origin).toString();
}

function scrapeListRows() {
  const findTableInDocument = (doc) => {
    if (!doc) return null;
    const direct = doc.querySelector("table.now-list-table");
    if (direct) return direct;
    return null;
  };

  const findTableDeep = (root) => {
    const direct = root.querySelector?.("table.now-list-table");
    if (direct) return direct;
    const nodes = root.querySelectorAll ? root.querySelectorAll("*") : [];
    for (const el of nodes) {
      if (el.shadowRoot) {
        const found = findTableDeep(el.shadowRoot);
        if (found) return found;
      }
    }
    return null;
  };

  let table = findTableDeep(document);
  if (!table) {
    const iframes = Array.from(document.querySelectorAll("iframe"));
    for (const iframe of iframes) {
      try {
        const found = findTableDeep(iframe.contentDocument);
        if (found) {
          table = found;
          break;
        }
      } catch (error) {
        // Cross-origin iframe
      }
    }
  }
  if (!table) return [];

  const headerCells = Array.from(table.querySelectorAll("thead th[data-column-key]"));
  const columns = headerCells.map((th) => {
    const key = th.getAttribute("data-column-key") || "";
    const labelEl = th.querySelector(".header-cell-button-label");
    const label = normalizeText(labelEl ? labelEl.textContent : key);
    return { key, label };
  });

  const rows = Array.from(table.querySelectorAll("tbody tr.now-list-table-row"));
  const mapped = rows.map((row) => {
    const record = {};
    for (const col of columns) {
      record[col.label] = getRowText(row, col.key);
    }
    const state = getRowText(row, "state");
    return {
      ...record,
      state,
      linkUrl: getRowLink(row, "number")
    };
  });

  return mapped.filter((row) => (row.state || "").toLowerCase() !== "resolved");
}

function findDetailContainer(selectors) {
  // Default to ServiceNow activity stream.
  const defaults = {
    mainContainer: "#sn_form_inline_stream_entries"
  };

  const resolved = { ...defaults, ...(selectors || {}) };
  let container = document.querySelector(resolved.mainContainer);
  if (!container) {
    // Try same-origin iframes (ServiceNow often uses gsft_main)
    const iframes = Array.from(document.querySelectorAll("iframe"));
    for (const iframe of iframes) {
      try {
        const doc = iframe.contentDocument;
        if (!doc) continue;
        const found = doc.querySelector(resolved.mainContainer);
        if (found) {
          container = found;
          break;
        }
      } catch (error) {
        // Cross-origin or inaccessible; ignore
      }
    }
  }
  if (!container) {
    // Common ServiceNow main frame id/name.
    const mainFrame = document.querySelector("iframe#gsft_main, iframe[name='gsft_main']");
    if (mainFrame) {
      try {
        const doc = mainFrame.contentDocument;
        if (doc) {
          const found = doc.querySelector(resolved.mainContainer);
          if (found) container = found;
        }
      } catch (error) {
        // ignore
      }
    }
  }
  return container;
}

function scrapeDetailPage(selectors, container) {
  if (!container) {
    return { error: "Detail container not found" };
  }

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

  return {
    activity
  };
}

chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  if (message?.type === "GET_LIST_ROWS") {
    try {
      const rows = scrapeListRows();
      sendResponse({ ok: true, rows });
    } catch (error) {
      sendResponse({ ok: false, error: String(error) });
    }
    return true;
  }

  if (message?.type === "GET_DETAIL") {
    (async () => {
      try {
        const selectors = message.selectors || null;
        let container = null;
        const start = Date.now();
        while (Date.now() - start < 20000) {
          container = findDetailContainer(selectors);
          if (container) break;
          await new Promise((r) => setTimeout(r, 500));
        }
        if (!container) {
          sendResponse({ ok: false, error: "Detail container not found after wait" });
          return;
        }
        const detail = scrapeDetailPage(selectors, container);
        if (detail.error) {
          sendResponse({ ok: false, error: detail.error });
        } else {
          sendResponse({ ok: true, detail });
        }
      } catch (error) {
        sendResponse({ ok: false, error: String(error) });
      }
    })();
    return true;
  }

  return false;
});
