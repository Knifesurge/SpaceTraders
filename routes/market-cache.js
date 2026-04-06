import { loadPersistentCache, savePersistentCache } from "./persistent-cache-store.js";

const marketCacheByWaypoint = new Map();
const MARKET_CACHE_FILE = "market-cache.json";

const normalizeSymbol = (value) => (typeof value === "string" ? value.trim().toUpperCase() : "");

const normalizeSymbolItems = (items) => {
  const safeItems = Array.isArray(items) ? items : [];
  const bySymbol = new Map();

  for (const item of safeItems) {
    const symbol = normalizeSymbol(item?.symbol);
    if (!symbol) {
      continue;
    }

    bySymbol.set(symbol, {
      ...(bySymbol.get(symbol) || {}),
      ...item,
      symbol,
    });
  }

  return [...bySymbol.values()].sort((a, b) => a.symbol.localeCompare(b.symbol));
};

const mergeTradeGoods = (cachedGoods = [], liveGoods = []) => {
  const bySymbol = new Map();

  for (const item of normalizeSymbolItems(cachedGoods)) {
    bySymbol.set(item.symbol, item);
  }

  for (const item of normalizeSymbolItems(liveGoods)) {
    bySymbol.set(item.symbol, {
      ...(bySymbol.get(item.symbol) || {}),
      ...item,
      symbol: item.symbol,
    });
  }

  return [...bySymbol.values()].sort((a, b) => a.symbol.localeCompare(b.symbol));
};

const resolveWaypointSymbol = (marketData, fallbackWaypointSymbol = "") => (
  normalizeSymbol(marketData?.symbol) || normalizeSymbol(fallbackWaypointSymbol)
);

const resolveSystemSymbol = (marketData, fallbackSystemSymbol = "") => (
  normalizeSymbol(marketData?.systemSymbol) || normalizeSymbol(fallbackSystemSymbol)
);

const buildComparableMarketPayload = (entry = {}) => JSON.stringify({
  waypointSymbol: normalizeSymbol(entry?.waypointSymbol),
  systemSymbol: normalizeSymbol(entry?.systemSymbol),
  exports: normalizeSymbolItems(entry?.exports || []),
  imports: normalizeSymbolItems(entry?.imports || []),
  exchange: normalizeSymbolItems(entry?.exchange || []),
  tradeGoods: normalizeSymbolItems(entry?.tradeGoods || []),
  transactions: Array.isArray(entry?.transactions) ? entry.transactions : [],
});

const hydrateMarketCache = () => {
  const persistedEntries = loadPersistentCache(MARKET_CACHE_FILE, []);
  const safeEntries = Array.isArray(persistedEntries) ? persistedEntries : [];

  for (const entry of safeEntries) {
    const waypointSymbol = normalizeSymbol(entry?.waypointSymbol);
    if (!waypointSymbol) {
      continue;
    }

    marketCacheByWaypoint.set(waypointSymbol, {
      cachedAt: Number(entry?.cachedAt || 0),
      waypointSymbol,
      systemSymbol: resolveSystemSymbol(entry, entry?.systemSymbol),
      exports: normalizeSymbolItems(entry?.exports || []),
      imports: normalizeSymbolItems(entry?.imports || []),
      exchange: normalizeSymbolItems(entry?.exchange || []),
      tradeGoods: normalizeSymbolItems(entry?.tradeGoods || []),
      transactions: Array.isArray(entry?.transactions) ? entry.transactions : [],
    });
  }
};

const persistMarketCache = () => {
  savePersistentCache(MARKET_CACHE_FILE, [...marketCacheByWaypoint.values()]);
};

hydrateMarketCache();

export const getCachedMarketData = (waypointSymbol) => {
  const key = normalizeSymbol(waypointSymbol);
  if (!key) {
    return null;
  }

  return marketCacheByWaypoint.get(key) || null;
};

export const cacheMarketData = (marketData, options = {}) => {
  if (!marketData || typeof marketData !== "object") {
    return null;
  }

  const waypointSymbol = resolveWaypointSymbol(marketData, options.waypointSymbol);
  if (!waypointSymbol) {
    return null;
  }

  const existing = getCachedMarketData(waypointSymbol) || null;
  const systemSymbol = resolveSystemSymbol(marketData, options.systemSymbol) || existing.systemSymbol || "";

  const nextEntry = {
    cachedAt: Date.now(),
    waypointSymbol,
    systemSymbol,
    exports: normalizeSymbolItems(marketData.exports || existing.exports || []),
    imports: normalizeSymbolItems(marketData.imports || existing.imports || []),
    exchange: normalizeSymbolItems(marketData.exchange || existing.exchange || []),
    tradeGoods: mergeTradeGoods(existing.tradeGoods || [], marketData.tradeGoods || []),
    transactions: Array.isArray(marketData.transactions) ? marketData.transactions : (existing.transactions || []),
  };

  const changeType = !existing
    ? "added"
    : (buildComparableMarketPayload(existing) === buildComparableMarketPayload(nextEntry)
      ? "unchanged"
      : "updated");

  marketCacheByWaypoint.set(waypointSymbol, nextEntry);
  persistMarketCache();
  return {
    entry: nextEntry,
    changeType,
  };
};

export const mergeMarketWithCache = (liveMarketData, options = {}) => {
  const waypointSymbol = resolveWaypointSymbol(liveMarketData, options.waypointSymbol);
  const cached = getCachedMarketData(waypointSymbol);
  const live = (liveMarketData && typeof liveMarketData === "object") ? liveMarketData : {};

  return {
    symbol: waypointSymbol || cached?.waypointSymbol || "",
    systemSymbol: resolveSystemSymbol(live, options.systemSymbol) || cached?.systemSymbol || "",
    exports: normalizeSymbolItems([...(cached?.exports || []), ...(live.exports || [])]),
    imports: normalizeSymbolItems([...(cached?.imports || []), ...(live.imports || [])]),
    exchange: normalizeSymbolItems([...(cached?.exchange || []), ...(live.exchange || [])]),
    tradeGoods: mergeTradeGoods(cached?.tradeGoods || [], live.tradeGoods || []),
    transactions: Array.isArray(live.transactions)
      ? live.transactions
      : (cached?.transactions || []),
  };
};
