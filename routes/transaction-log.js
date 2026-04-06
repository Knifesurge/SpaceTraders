import { loadPersistentCache, savePersistentCache } from "./persistent-cache-store.js";

const TRANSACTION_LOG_FILE = "transaction-log.json";
const MAX_TRANSACTIONS = 500;

const normalizeAmount = (value) => {
  const amount = Number(value);
  if (!Number.isFinite(amount)) {
    return 0;
  }
  return Math.trunc(amount);
};

const normalizeDetails = (details) => {
  if (!details || typeof details !== "object") {
    return {};
  }

  const clean = {};
  for (const [key, value] of Object.entries(details)) {
    if (value === undefined || value === null || value === "") {
      continue;
    }
    clean[key] = value;
  }

  return clean;
};

export const getTransactionLog = () => {
  const entries = loadPersistentCache(TRANSACTION_LOG_FILE, []);
  return Array.isArray(entries) ? entries : [];
};

export const appendTransactionLogEntry = (entry) => {
  const entries = getTransactionLog();
  const normalizedEntry = {
    id: `${Date.now()}-${Math.random().toString(16).slice(2, 10)}`,
    occurredAt: new Date().toISOString(),
    action: String(entry?.action || "UNKNOWN").trim().toUpperCase(),
    endpoint: String(entry?.endpoint || "").trim(),
    method: String(entry?.method || "POST").trim().toUpperCase(),
    shipSymbol: String(entry?.shipSymbol || "").trim().toUpperCase(),
    waypointSymbol: String(entry?.waypointSymbol || "").trim().toUpperCase(),
    creditsBefore: normalizeAmount(entry?.creditsBefore),
    creditsAfter: normalizeAmount(entry?.creditsAfter),
    creditsDelta: normalizeAmount(entry?.creditsAfter) - normalizeAmount(entry?.creditsBefore),
    details: normalizeDetails(entry?.details),
  };

  entries.unshift(normalizedEntry);
  if (entries.length > MAX_TRANSACTIONS) {
    entries.length = MAX_TRANSACTIONS;
  }

  savePersistentCache(TRANSACTION_LOG_FILE, entries);
  return normalizedEntry;
};
