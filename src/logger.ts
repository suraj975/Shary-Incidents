import fs from "fs";
import path from "path";

export type Logger = {
  info: (message: string) => void;
  warn: (message: string) => void;
  error: (message: string) => void;
};

function ensureDir(dirPath: string): void {
  if (!fs.existsSync(dirPath)) {
    fs.mkdirSync(dirPath, { recursive: true });
  }
}

function timestamp(): string {
  return new Date().toISOString();
}

export function initLogger(logDir: string, logFileName: string): Logger {
  ensureDir(logDir);
  const logFilePath = path.join(logDir, logFileName);

  function write(level: string, message: string): void {
    const line = `[${timestamp()}] [${level}] ${message}`;
    console.log(line);
    fs.appendFileSync(logFilePath, `${line}\n`, "utf8");
  }

  return {
    info: (message: string) => write("INFO", message),
    warn: (message: string) => write("WARN", message),
    error: (message: string) => write("ERROR", message)
  };
}
