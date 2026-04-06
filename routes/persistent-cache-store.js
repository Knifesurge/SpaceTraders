import fs from "fs";
import path from "path";

const CACHE_DIR = path.resolve(process.cwd(), "data", "cache");

const ensureCacheDir = () => {
  fs.mkdirSync(CACHE_DIR, { recursive: true });
};

export const loadPersistentCache = (fileName, fallbackValue) => {
  try {
    const filePath = path.join(CACHE_DIR, fileName);
    if (!fs.existsSync(filePath)) {
      return fallbackValue;
    }

    const raw = fs.readFileSync(filePath, "utf8");
    if (!raw.trim()) {
      return fallbackValue;
    }

    return JSON.parse(raw);
  } catch {
    return fallbackValue;
  }
};

export const savePersistentCache = (fileName, payload) => {
  try {
    ensureCacheDir();
    const filePath = path.join(CACHE_DIR, fileName);
    fs.writeFileSync(filePath, JSON.stringify(payload, null, 2), "utf8");
  } catch {
    // Persistence is best-effort; runtime cache remains authoritative.
  }
};
