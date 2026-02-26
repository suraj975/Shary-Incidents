const normalizeKey = (key: string) =>
  key.toLowerCase().replace(/[^a-z0-9]/g, "");

// Treat seller/buyer names and Emirates IDs as sensitive; remove them before showing or exporting.
export function isSensitiveFieldKey(key: string): boolean {
  const k = normalizeKey(key);
  return (
    k.includes("emiratesid") ||
    k.includes("selleremirates") ||
    k.includes("buyeremirates") ||
    k.includes("sellername") ||
    k.includes("buyername")
  );
}

export function redactSensitiveFields<T>(value: T): T {
  const visit = (val: any): any => {
    if (Array.isArray(val)) return val.map(visit);
    if (val && typeof val === "object") {
      const entries = Object.entries(val as Record<string, any>)
        .filter(([key]) => !isSensitiveFieldKey(key))
        .map(([key, v]) => [key, visit(v)] as const);
      return Object.fromEntries(entries);
    }
    return val;
  };

  return visit(value);
}

export function splitSensitiveFields<T>(value: T): {
  sanitized: T;
  sensitive: any;
} {
  const visit = (val: any): { sanitized: any; sensitive: any } => {
    if (Array.isArray(val)) {
      const sanitizedArr: any[] = [];
      const sensitiveArr: any[] = [];
      val.forEach((item) => {
        const { sanitized, sensitive } = visit(item);
        sanitizedArr.push(sanitized);
        sensitiveArr.push(sensitive);
      });
      return { sanitized: sanitizedArr, sensitive: sensitiveArr };
    }
    if (val && typeof val === "object") {
      const sanitizedObj: Record<string, any> = {};
      const sensitiveObj: Record<string, any> = {};
      Object.entries(val as Record<string, any>).forEach(([key, v]) => {
        const { sanitized, sensitive } = visit(v);
        if (isSensitiveFieldKey(key)) {
          sensitiveObj[key] = sanitized;
        } else {
          sanitizedObj[key] = sanitized;
          if (sensitive !== undefined) {
            sensitiveObj[key] = sensitive;
          }
        }
      });
      // Remove empty sensitive containers
      const hasSensitive = Object.values(sensitiveObj).some(
        (v) =>
          v !== undefined &&
          !(typeof v === "object" && Object.keys(v || {}).length === 0),
      );
      return {
        sanitized: sanitizedObj,
        sensitive: hasSensitive ? sensitiveObj : undefined,
      };
    }
    return { sanitized: val, sensitive: undefined };
  };

  return visit(value);
}
