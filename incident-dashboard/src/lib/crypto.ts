import crypto from "crypto";

const KEY_ENV = "ADMIN_DATA_KEY";

function getKey(): Buffer | null {
  const raw = process.env[KEY_ENV];
  if (!raw) return null;
  try {
    if (raw.length === 64) return Buffer.from(raw, "hex");
    return Buffer.from(raw, "base64");
  } catch {
    return null;
  }
}

export function encryptJson(payload: any): { cipher: string; iv: string } | null {
  const key = getKey();
  if (!key || key.length !== 32) return null; // require AES-256
  const iv = crypto.randomBytes(12);
  const cipher = crypto.createCipheriv("aes-256-gcm", key, iv);
  const json = JSON.stringify(payload);
  const enc = Buffer.concat([cipher.update(json, "utf8"), cipher.final()]);
  const tag = cipher.getAuthTag();
  return {
    iv: iv.toString("base64"),
    cipher: Buffer.concat([enc, tag]).toString("base64"),
  };
}

export function decryptJson(blob: { cipher: string; iv: string }): any | null {
  const key = getKey();
  if (!key || key.length !== 32) return null;
  const iv = Buffer.from(blob.iv, "base64");
  const data = Buffer.from(blob.cipher, "base64");
  const enc = data.slice(0, data.length - 16);
  const tag = data.slice(data.length - 16);
  const decipher = crypto.createDecipheriv("aes-256-gcm", key, iv);
  decipher.setAuthTag(tag);
  const dec = Buffer.concat([decipher.update(enc), decipher.final()]);
  return JSON.parse(dec.toString("utf8"));
}
