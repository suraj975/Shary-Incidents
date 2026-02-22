import admin from "firebase-admin";

const STORAGE_BUCKET =
  process.env.FIREBASE_STORAGE_BUCKET || "shary-incidents.appspot.com";
const PROJECT_ID =
  process.env.FIREBASE_PROJECT_ID || process.env.GOOGLE_CLOUD_PROJECT || "";

let firestoreInstance: admin.firestore.Firestore | null = null;
let firestoreSettingsApplied = false;

function getCredential() {
  if (process.env.FIREBASE_SERVICE_ACCOUNT) {
    const parsed = JSON.parse(process.env.FIREBASE_SERVICE_ACCOUNT);
    return admin.credential.cert(parsed);
  }
  if (process.env.FIREBASE_SERVICE_ACCOUNT_BASE64) {
    const json = Buffer.from(
      process.env.FIREBASE_SERVICE_ACCOUNT_BASE64,
      "base64"
    ).toString("utf8");
    const parsed = JSON.parse(json);
    return admin.credential.cert(parsed);
  }
  return admin.credential.applicationDefault();
}

export function initAdminApp() {
  if (admin.apps.length) return admin.app();
  return admin.initializeApp({
    credential: getCredential(),
    storageBucket: STORAGE_BUCKET,
    projectId: PROJECT_ID || undefined,
  });
}

export function getFirestore() {
  if (firestoreInstance) return firestoreInstance;
  initAdminApp();
  const firestore = admin.firestore();
  if (!firestoreSettingsApplied) {
    try {
      firestore.settings({ ignoreUndefinedProperties: true });
    } catch (error: any) {
      // If Firestore was touched before settings(), skip to avoid initialization error.
      const msg = String(error?.message || "");
      if (!msg.includes("settings() once")) {
        throw error;
      }
    }
    firestoreSettingsApplied = true;
  }
  firestoreInstance = firestore;
  return firestoreInstance;
}

export function getBucket() {
  initAdminApp();
  return admin.storage().bucket();
}
