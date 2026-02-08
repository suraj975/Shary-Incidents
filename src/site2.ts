import { Page } from "playwright";
import { Logger } from "./logger";
import {
  byLabel,
  normalizeText,
  safeClick,
  safeFill,
  waitForTable,
} from "./utils/selectors";

export type Site2Result = {
  applicationId: string;
  site2Status: string;
  raw?: Record<string, string>;
  notFound?: boolean;
};

const SITE2_SELECTORS = {
  // Update these selectors to match the actual UI elements in Site 2.
  usernameInput: "input[name='username']",
  passwordInput: "input[name='password']",
  loginButton: "button[type='submit']",
  searchButton: "button:has-text('Search')",
  table: "[data-testid='results-table']",
  tableRow: "[data-testid^='row-']",
  dateRangeInput: "input[name='requestDateRange']",
};

export async function loginSite2(page: Page, logger: Logger): Promise<void> {
  logger.info("Site2: logging in");
  // Editable selectors below (placeholder).
  await page.waitForSelector(SITE2_SELECTORS.usernameInput, { timeout: 90000 });
  await page.fill(
    SITE2_SELECTORS.usernameInput,
    process.env.SITE2_USERNAME || "",
  );
  await page.fill(
    SITE2_SELECTORS.passwordInput,
    process.env.SITE2_PASSWORD || "",
  );
  await page.click(SITE2_SELECTORS.loginButton);
}

export async function setDateRangeSite2(
  page: Page,
  from: string,
  to: string,
  logger: Logger,
): Promise<void> {
  // Try normal fill first. If readonly, fallback to eval and dispatch events.
  const input = page.locator(SITE2_SELECTORS.dateRangeInput);
  if ((await input.count()) === 0) {
    logger.warn(
      "Site2: date range input not found by selector; trying label lookup",
    );
    const byLabelInput = await byLabel(page, "Request Date");
    await safeFill(byLabelInput, `${from} - ${to}`);
    return;
  }

  try {
    await input.fill(`${from} - ${to}`);
  } catch (error) {
    logger.warn("Site2: date range input is readonly; using fallback setValue");
    await page.evaluate(
      ({ selector, value }) => {
        const el = document.querySelector<HTMLInputElement>(selector);
        if (!el) return;
        el.removeAttribute("readonly");
        el.value = value;
        el.dispatchEvent(new Event("input", { bubbles: true }));
        el.dispatchEvent(new Event("change", { bubbles: true }));
      },
      { selector: SITE2_SELECTORS.dateRangeInput, value: `${from} - ${to}` },
    );
  }
}

export async function searchSite2(
  page: Page,
  applicationId: string,
  from: string,
  to: string,
  logger: Logger,
): Promise<Site2Result> {
  logger.info(`Site2: searching ApplicationId ${applicationId}`);

  await setDateRangeSite2(page, from, to, logger);

  const applicationIdInput = await byLabel(page, "ApplicationId");
  await safeFill(applicationIdInput, applicationId);

  await safeClick(page.locator(SITE2_SELECTORS.searchButton));
  await waitForTable(page, SITE2_SELECTORS.table, SITE2_SELECTORS.tableRow);

  const rowCount = await page.locator(SITE2_SELECTORS.tableRow).count();
  if (rowCount === 0) {
    return { applicationId, site2Status: "", notFound: true };
  }

  const statusCell = page.locator(
    "[data-testid^='row-'][data-testid*='-column-status-'][data-testid$='-content']",
  );
  const statusText = normalizeText(await statusCell.first().textContent());

  return {
    applicationId,
    site2Status: statusText,
    raw: {
      status: statusText,
    },
  };
}
