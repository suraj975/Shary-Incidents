import { Site1Row } from "./site1";
import { Site2Result } from "./site2";

export type Summary = {
  applicationId: string | null;
  applicationNo: string;
  presaleNo: string;
  chassisNo: string;
  site1Status: string;
  site1Time: string;
  site2Status: string | null;
  delta: "changed" | "not changed" | "unknown";
  action: string;
  summaryText: string;
};

function normalizeStatus(value: string | null): string {
  return (value || "").trim().toLowerCase();
}

function isExpiredOrBlocked(status: string): boolean {
  const normalized = status.toLowerCase();
  return (
    normalized.includes("expired") ||
    normalized.includes("cancellation not allowed") ||
    normalized.includes("cannot cancel")
  );
}

export function buildSummary(site1: Site1Row, site2?: Site2Result): Summary {
  const applicationId = site1.applicationId || null;
  const site1Status = site1.site1Status;
  const site1Time = site1.applicationTime;

  if (!applicationId) {
    const action = "ApplicationId missing; operator manual check required.";
    const summaryText = `Identifiers: ApplicationId N/A, ApplicationNo ${site1.applicationNo || "N/A"}, PresaleNo ${site1.presaleNo || "N/A"}, ChassisNo ${site1.chassisNo || "N/A"}. Site 1: ${site1Status || "N/A"} at ${site1Time || "N/A"}. Site 2: skipped. Delta: unknown. Action: ${action}`;
    return {
      applicationId,
      applicationNo: site1.applicationNo,
      presaleNo: site1.presaleNo,
      chassisNo: site1.chassisNo,
      site1Status,
      site1Time,
      site2Status: null,
      delta: "unknown",
      action,
      summaryText
    };
  }

  if (!site2 || site2.notFound) {
    const action = "Site 2 record not found; operator manual check required (possible mismatch/sync/env issue).";
    const summaryText = `Identifiers: ApplicationId ${applicationId}, ApplicationNo ${site1.applicationNo || "N/A"}, PresaleNo ${site1.presaleNo || "N/A"}, ChassisNo ${site1.chassisNo || "N/A"}. Site 1: ${site1Status || "N/A"} at ${site1Time || "N/A"}. Site 2: not found. Delta: unknown. Action: ${action}`;
    return {
      applicationId,
      applicationNo: site1.applicationNo,
      presaleNo: site1.presaleNo,
      chassisNo: site1.chassisNo,
      site1Status,
      site1Time,
      site2Status: null,
      delta: "unknown",
      action,
      summaryText
    };
  }

  const site2Status = site2.site2Status || "";
  const delta = normalizeStatus(site1Status) === normalizeStatus(site2Status) ? "not changed" : "changed";

  let action = "No action required.";
  if (isExpiredOrBlocked(site2Status)) {
    action = "User may not be able to cancel; operator intervention required.";
  } else if (delta === "changed") {
    action = "Status changed; operator should review latest status on Site 2.";
  }

  const summaryText = `Identifiers: ApplicationId ${applicationId}, ApplicationNo ${site1.applicationNo || "N/A"}, PresaleNo ${site1.presaleNo || "N/A"}, ChassisNo ${site1.chassisNo || "N/A"}. Site 1: ${site1Status || "N/A"} at ${site1Time || "N/A"}. Site 2: ${site2Status || "N/A"}. Delta: ${delta}. Action: ${action}`;

  return {
    applicationId,
    applicationNo: site1.applicationNo,
    presaleNo: site1.presaleNo,
    chassisNo: site1.chassisNo,
    site1Status,
    site1Time,
    site2Status,
    delta,
    action,
    summaryText
  };
}
