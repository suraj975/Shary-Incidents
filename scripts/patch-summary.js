#!/usr/bin/env node
/**
 * Patch a Firestore incident document with summary / summaryStructured fields.
 *
 * Usage examples:
 *   node scripts/patch-summary.js --id INC2661768 --summary-file ./summary.txt
 *   node scripts/patch-summary.js --id INC2661768 --summary "Short text" --structured-file ./structured.json
 *
 * Expects Firebase env in .env (FIREBASE_SERVICE_ACCOUNT_BASE64 or FIREBASE_SERVICE_ACCOUNT, FIREBASE_STORAGE_BUCKET).
 */

const fs = require("fs");
const path = require("path");
const dotenv = require("dotenv");
const admin = require("firebase-admin");
const { Storage } = require("@google-cloud/storage");

// Load env from project root
const envPath = path.resolve(__dirname, "..", ".env");
if (fs.existsSync(envPath)) dotenv.config({ path: envPath });

function parseArgs() {
  const args = process.argv.slice(2);
  const out = {};
  for (let i = 0; i < args.length; i++) {
    const a = args[i];
    if (a === "--id") out.id = args[++i];
    else if (a === "--summary") out.summary = args[++i];
    else if (a === "--summary-file") out.summaryFile = args[++i];
    else if (a === "--structured-file") out.structuredFile = args[++i];
    else if (a === "--clear") out.clear = true;
    else if (a === "--help" || a === "-h") out.help = true;
  }
  return out;
}

function usage() {
  console.log(
    `Usage: node scripts/patch-summary.js --id <INC123> [--summary "text" | --summary-file file.txt] [--structured-file structured.json] [--clear]\n` +
      `--clear will remove summary and summaryStructured.\n`
  );
}

function getCredential() {
  if (process.env.FIREBASE_SERVICE_ACCOUNT) {
    return admin.credential.cert(JSON.parse(process.env.FIREBASE_SERVICE_ACCOUNT));
  }
  if (process.env.FIREBASE_SERVICE_ACCOUNT_BASE64) {
    const json = Buffer.from(process.env.FIREBASE_SERVICE_ACCOUNT_BASE64, "base64").toString("utf8");
    return admin.credential.cert(JSON.parse(json));
  }
  throw new Error("Missing FIREBASE_SERVICE_ACCOUNT or FIREBASE_SERVICE_ACCOUNT_BASE64");
}

async function main() {
  const args = parseArgs();
  if (args.help || !args.id) {
    usage();
    process.exit(args.help ? 0 : 1);
  }

  let summary = args.summary || "";
  if (args.summaryFile) summary = fs.readFileSync(args.summaryFile, "utf8");
  let summaryStructured = undefined;
  if (args.structuredFile) summaryStructured = JSON.parse(fs.readFileSync(args.structuredFile, "utf8"));

  // Firestore per-field limit is 1,048,487 bytes. Be safe at ~900k.
  const MAX_FIELD_BYTES = 900_000;
  const summaryBytes = Buffer.byteLength(summary, "utf8");
  if (!args.clear && summaryBytes > MAX_FIELD_BYTES) {
    const truncated = summary.slice(0, MAX_FIELD_BYTES - 1000); // trim a bit more
    console.warn(
      `Summary is ${summaryBytes} bytes, truncating to ${Buffer.byteLength(truncated, "utf8")} to fit Firestore limits.`
    );
    summary = truncated;
  }

  const docId = String(args.id).replace(/[^A-Za-z0-9_-]/g, "_");

  admin.initializeApp({
    credential: getCredential(),
    storageBucket: process.env.FIREBASE_STORAGE_BUCKET,
    projectId: process.env.FIREBASE_PROJECT_ID || process.env.GOOGLE_CLOUD_PROJECT,
  });
  const db = admin.firestore();
  try {
    db.settings({ ignoreUndefinedProperties: true });
  } catch (e) {
    // ignore if already set
  }

  const payloadBase = args.clear
    ? { summary: admin.firestore.FieldValue.delete(), summaryStructured: admin.firestore.FieldValue.delete(), summaryLink: admin.firestore.FieldValue.delete() }
    : { summary, summaryStructured: summaryStructured ?? null, updatedAt: Date.now() };

  let payload = payloadBase;

  // If the whole doc would exceed 1MB, upload the full summary to Storage and store only a short preview + link.
  if (!args.clear && summaryBytes > MAX_FIELD_BYTES * 0.9) {
    const bucketName = process.env.FIREBASE_STORAGE_BUCKET;
    if (!bucketName) throw new Error("FIREBASE_STORAGE_BUCKET required for large summary upload.");
    const storage = new Storage({
      credentials: JSON.parse(
        process.env.FIREBASE_SERVICE_ACCOUNT ||
          Buffer.from(process.env.FIREBASE_SERVICE_ACCOUNT_BASE64, "base64").toString("utf8")
      ),
      projectId: process.env.FIREBASE_PROJECT_ID || process.env.GOOGLE_CLOUD_PROJECT,
    });
    const bucket = storage.bucket(bucketName);
    const objectPath = `summaries/${docId}.txt`;
    await bucket.file(objectPath).save(summary, { contentType: "text/plain", resumable: false });
    const [signedUrl] = await bucket
      .file(objectPath)
      .getSignedUrl({ action: "read", expires: "2099-12-31" });

    const previewLimit = 20_000; // ~20 KB, well under the limit
    const preview = summary.slice(0, previewLimit);

    payload = {
      ...payloadBase,
      summary: preview,
      summaryLink: signedUrl,
      summaryTruncated: true,
    };
    console.warn(
      `Summary stored in Storage at ${objectPath}; Firestore kept preview (${Buffer.byteLength(
        preview,
        "utf8"
      )} bytes) and link.`
    );
  }

  await db.collection("incidents").doc(docId).set(payload, { merge: true });
  console.log(`Updated ${docId} with ${args.clear ? "cleared summary" : "summary fields set"}.`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
