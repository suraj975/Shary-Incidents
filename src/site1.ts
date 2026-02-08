import { Page } from "playwright";
import { Logger } from "./logger";
import {
  byLabel,
  normalizeText,
  safeClick,
  safeFill,
  waitForTable,
} from "./utils/selectors";

export type Site1Row = {
  applicationTime: string;
  applicationNo: string;
  presaleNo: string;
  sellerEmiratesId: string;
  sellerTrafficFileNumber: string;
  sellerName: string;
  buyerEmiratesId: string;
  buyerTrafficFileNumber: string;
  buyerName: string;
  chassisNo: string;
  vehicleMake: string;
  vehicleModel: string;
  manufactureYear: string;
  withPlates: string;
  withRenewal: string;
  saleAmount: string;
  site1Status: string;
  applicationId: string | null;
};

export type Site1SearchFilters = {
  from: string;
  to: string;
  applicationNo?: string;
  presaleNo?: string;
  emiratesId?: string;
  trafficNo?: string;
  chassisNo?: string;
  status?: string;
};

const SITE1_SELECTORS = {
  // Update these selectors to match the actual UI elements in Site 1.
  usernameInput: "input[name='username']",
  passwordInput: "input[name='password']",
  loginButton: "button[type='submit']",
  searchButton: "button:has-text('Search')",
  table: "[data-testid='results-table']",
  tableRow: "[data-testid^='row-']",
};

export async function loginSite1(page: Page, logger: Logger): Promise<void> {
  logger.info("Site1: logging in");
  // Editable selectors below (placeholder).
  await page.waitForSelector(SITE1_SELECTORS.usernameInput, { timeout: 90000 });
  await page.fill(
    SITE1_SELECTORS.usernameInput,
    process.env.SITE1_USERNAME || "",
  );
  await page.fill(
    SITE1_SELECTORS.passwordInput,
    process.env.SITE1_PASSWORD || "",
  );
  await page.click(SITE1_SELECTORS.loginButton);
}

export async function searchSite1(
  page: Page,
  filters: Site1SearchFilters,
  logger: Logger,
): Promise<Site1Row[]> {
  logger.info("Site1: filling search form");

  // Prefer label-based selectors where possible. Update label text as needed.
  const fromInput = await byLabel(page, "From");
  const toInput = await byLabel(page, "To");
  await safeFill(fromInput, filters.from);
  await safeFill(toInput, filters.to);

  if (filters.applicationNo) {
    const locator = await byLabel(page, "Application No");
    await safeFill(locator, filters.applicationNo);
  }

  if (filters.presaleNo) {
    const locator = await byLabel(page, "Presale No");
    await safeFill(locator, filters.presaleNo);
  }

  if (filters.emiratesId) {
    const locator = await byLabel(page, "Emirates ID");
    await safeFill(locator, filters.emiratesId);
  }

  if (filters.trafficNo) {
    const locator = await byLabel(page, "Traffic No");
    await safeFill(locator, filters.trafficNo);
  }

  if (filters.chassisNo) {
    const locator = await byLabel(page, "Chassis No");
    await safeFill(locator, filters.chassisNo);
  }

  if (filters.status) {
    const locator = await byLabel(page, "Status");
    await safeFill(locator, filters.status);
  }

  await safeClick(page.locator(SITE1_SELECTORS.searchButton));
  await waitForTable(page, SITE1_SELECTORS.table, SITE1_SELECTORS.tableRow);

  logger.info("Site1: scraping results table");

  const dataTestIds = await page
    .locator(
      "[data-testid^='row-'][data-testid*='-column-'][data-testid$='-content']",
    )
    .evaluateAll((elements) =>
      elements.map((el) => el.getAttribute("data-testid") || ""),
    );

  const rowIds = new Set<string>();
  for (const id of dataTestIds) {
    const match = id.match(/^row-(\d+)-column-/);
    if (match) {
      rowIds.add(match[1]);
    }
  }

  const rows: Site1Row[] = [];
  const rowIdList = Array.from(rowIds).sort((a, b) => Number(a) - Number(b));

  for (const rowId of rowIdList) {
    const cell = async (columnKey: string): Promise<string> => {
      const locator = page.locator(
        `[data-testid="row-${rowId}-column-${columnKey}-content"]`,
      );
      if ((await locator.count()) === 0) return "";
      const text = await locator.first().textContent();
      return normalizeText(text);
    };

    const applicationId = await cell("application-id");

    rows.push({
      applicationTime: await cell("application-time"),
      applicationNo: await cell("application-no"),
      presaleNo: await cell("presale-no"),
      sellerEmiratesId: await cell("seller-emirates-id"),
      sellerTrafficFileNumber: await cell("seller-traffic-file-number"),
      sellerName: await cell("seller-name"),
      buyerEmiratesId: await cell("buyer-emirates-id"),
      buyerTrafficFileNumber: await cell("buyer-traffic-file-number"),
      buyerName: await cell("buyer-name"),
      chassisNo: await cell("chassis-no"),
      vehicleMake: await cell("vehicle-make"),
      vehicleModel: await cell("vehicle-model"),
      manufactureYear: await cell("manufacture-year"),
      withPlates: await cell("with-plates"),
      withRenewal: await cell("with-renewal"),
      saleAmount: await cell("sale-amount"),
      site1Status: await cell("status"),
      applicationId: applicationId ? applicationId : null,
    });
  }

  return rows;
}
