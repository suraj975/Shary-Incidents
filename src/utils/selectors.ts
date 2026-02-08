import { Locator, Page } from "playwright";

export async function byLabel(page: Page, labelText: string): Promise<Locator> {
  // Prefer getByLabel for accessible label -> input mapping.
  const locator = page.getByLabel(labelText, { exact: false });
  return locator;
}

export async function safeFill(locator: Locator, value: string): Promise<void> {
  const count = await locator.count();
  if (count === 0) {
    throw new Error("safeFill: locator not found");
  }
  await locator.fill(value);
}

export async function safeClick(locator: Locator): Promise<void> {
  const count = await locator.count();
  if (count === 0) {
    throw new Error("safeClick: locator not found");
  }
  await locator.click();
}

export async function waitForTable(
  page: Page,
  tableSelector: string,
  rowSelector: string,
): Promise<void> {
  await page.waitForSelector(tableSelector, {
    state: "visible",
    timeout: 90000,
  });
  await page.waitForSelector(rowSelector, {
    state: "attached",
    timeout: 90000,
  });
}

export function normalizeText(value: string | null): string {
  if (!value) return "";
  return value.replace(/\s+/g, " ").trim();
}
