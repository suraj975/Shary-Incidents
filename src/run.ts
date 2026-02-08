import fs from "fs";
import path from "path";
import { chromium } from "playwright";
import dotenv from "dotenv";
import { getConfig, EnvName } from "./config";
import { initLogger } from "./logger";
import { Site1Row, loginSite1, searchSite1 } from "./site1";
import { Site2Result, loginSite2, searchSite2 } from "./site2";
import { buildSummary, Summary } from "./summary";

dotenv.config();

type CliOptions = {
  from?: string;
  to?: string;
  applicationNo?: string;
  presaleNo?: string;
  emiratesId?: string;
  trafficNo?: string;
  chassisNo?: string;
  status?: string;
  headless: boolean;
  maxRows: number;
  outDir: string;
  env: EnvName;
};

function parseArgs(argv: string[]): CliOptions {
  const options: CliOptions = {
    headless: true,
    maxRows: 0,
    outDir: "./out",
    env: "uat"
  };

  for (let i = 2; i < argv.length; i += 1) {
    const key = argv[i];
    const value = argv[i + 1];

    if (!key.startsWith("--")) continue;
    const flag = key.replace(/^--/, "");

    switch (flag) {
      case "from":
        options.from = value;
        i += 1;
        break;
      case "to":
        options.to = value;
        i += 1;
        break;
      case "applicationNo":
        options.applicationNo = value;
        i += 1;
        break;
      case "presaleNo":
        options.presaleNo = value;
        i += 1;
        break;
      case "emiratesId":
        options.emiratesId = value;
        i += 1;
        break;
      case "trafficNo":
        options.trafficNo = value;
        i += 1;
        break;
      case "chassisNo":
        options.chassisNo = value;
        i += 1;
        break;
      case "status":
        options.status = value;
        i += 1;
        break;
      case "headless":
        options.headless = value ? value.toLowerCase() === "true" : true;
        i += 1;
        break;
      case "maxRows":
        options.maxRows = value ? Number(value) : 0;
        i += 1;
        break;
      case "outDir":
        options.outDir = value || "./out";
        i += 1;
        break;
      case "env":
        options.env = (value || "uat") as EnvName;
        i += 1;
        break;
      default:
        break;
    }
  }

  return options;
}

function ensureDir(dirPath: string): void {
  if (!fs.existsSync(dirPath)) {
    fs.mkdirSync(dirPath, { recursive: true });
  }
}

function writeJson(filePath: string, data: unknown): void {
  fs.writeFileSync(filePath, JSON.stringify(data, null, 2), "utf8");
}

function writeText(filePath: string, data: string): void {
  fs.writeFileSync(filePath, data, "utf8");
}

function toCsv(rows: Array<Record<string, string>>): string {
  if (rows.length === 0) return "";
  const headers = Object.keys(rows[0]);
  const escape = (value: string): string => {
    const safe = value.replace(/"/g, '""');
    if (safe.includes(",") || safe.includes("\n")) {
      return `"${safe}"`;
    }
    return safe;
  };
  const lines = [headers.join(",")];
  for (const row of rows) {
    lines.push(headers.map((h) => escape(row[h] || "")).join(","));
  }
  return lines.join("\n");
}

async function main(): Promise<void> {
  const options = parseArgs(process.argv);

  if (!options.from || !options.to) {
    throw new Error("Mandatory date range missing. Use --from DD/MM/YYYY and --to DD/MM/YYYY before running.");
  }

  const artifactsDir = path.resolve("./artifacts");
  const screenshotsDir = path.join(artifactsDir, "screenshots");
  const logsDir = path.join(artifactsDir, "logs");
  ensureDir(screenshotsDir);
  ensureDir(logsDir);

  const logger = initLogger(logsDir, `run-${Date.now()}.log`);

  const outDir = path.resolve(options.outDir);
  const outRawDir = path.join(outDir, "raw");
  const outReportDir = path.join(outDir, "report");
  ensureDir(outRawDir);
  ensureDir(outReportDir);

  const config = getConfig(options.env);
  logger.info(`Using env ${options.env} with Site1 ${config.site1Url} and Site2 ${config.site2Url}`);

  const userDataDir = path.resolve("./artifacts/user-data");
  ensureDir(userDataDir);
  const context = await chromium.launchPersistentContext(userDataDir, {
    headless: options.headless
  });
  const page1 = await context.newPage();

  const errors: Array<Record<string, string>> = [];
  const site2Results: Site2Result[] = [];
  let site1Rows: Site1Row[] = [];

  try {
    logger.info("Navigating to Site 1");
    await page1.goto(config.site1Url, { waitUntil: "domcontentloaded" });
    await loginSite1(page1, logger);

    site1Rows = await searchSite1(
      page1,
      {
        from: options.from,
        to: options.to,
        applicationNo: options.applicationNo,
        presaleNo: options.presaleNo,
        emiratesId: options.emiratesId,
        trafficNo: options.trafficNo,
        chassisNo: options.chassisNo,
        status: options.status
      },
      logger
    );
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    logger.error(`Site1 failed: ${message}`);
    await page1.screenshot({
      path: path.join(screenshotsDir, `site1_error_${Date.now()}.png`),
      fullPage: true
    });
    await context.close();
    throw error;
  }

  const rowsToProcess = options.maxRows > 0 ? site1Rows.slice(0, options.maxRows) : site1Rows;

  const page2 = await context.newPage();
  let site2Ready = false;

  for (const row of rowsToProcess) {
    if (!row.applicationId) {
      site2Results.push({ applicationId: "", site2Status: "", notFound: true });
      continue;
    }

    try {
      if (!site2Ready) {
        logger.info("Navigating to Site 2");
        await page2.goto(config.site2Url, { waitUntil: "domcontentloaded" });
        await loginSite2(page2, logger);
        site2Ready = true;
      }

      const result = await searchSite2(page2, row.applicationId, options.from, options.to, logger);
      site2Results.push(result);
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      logger.error(`Site2 lookup failed for ${row.applicationId}: ${message}`);
      errors.push({
        applicationNo: row.applicationNo || "",
        applicationId: row.applicationId || "",
        stage: "site2",
        message
      });
      await page2.screenshot({
        path: path.join(screenshotsDir, `site2_error_${row.applicationId}_${Date.now()}.png`),
        fullPage: true
      });
    }
  }

  await context.close();

  const summaries: Summary[] = [];
  for (const row of rowsToProcess) {
    const site2 = site2Results.find((r) => r.applicationId === row.applicationId) || undefined;
    summaries.push(buildSummary(row, site2));
  }

  writeJson(path.join(outRawDir, "site1.json"), site1Rows);
  writeJson(path.join(outRawDir, "site2.json"), site2Results);

  writeJson(path.join(outReportDir, "summaries.json"), summaries);

  const summaryText = summaries.map((s) => `- ${s.summaryText}`).join("\n");
  writeText(path.join(outReportDir, "summaries.md"), summaryText);

  const errorCsv = toCsv(errors);
  writeText(path.join(outReportDir, "errors.csv"), errorCsv);

  logger.info("Run complete");
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
