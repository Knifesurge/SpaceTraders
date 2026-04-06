import { loadPersistentCache, savePersistentCache } from "./persistent-cache-store.js";
import { markShipWaypointsVisited } from "./visited-waypoint-cache.js";

const SHIP_CACHE_TTL_MS = 10 * 1000;
const SHIP_PAGE_SIZE = 20;
const SHIP_METADATA_CACHE_FILE = "ship-metadata-cache.json";

let myShipsCache = {
  cachedAt: 0,
  ships: null,
};

const shipMetadataBySymbol = new Map();

const normalizeOptionalString = (value) => {
  const normalized = String(value || "").trim();
  return normalized || undefined;
};

const getPurchaseShipSymbol = (purchaseData) => (
  normalizeOptionalString(purchaseData?.ship?.symbol)
);

const hydrateShipMetadataCache = () => {
  const persistedEntries = loadPersistentCache(SHIP_METADATA_CACHE_FILE, []);
  const safeEntries = Array.isArray(persistedEntries) ? persistedEntries : [];

  for (const entry of safeEntries) {
    const shipSymbol = normalizeOptionalString(entry?.shipSymbol);
    if (!shipSymbol) {
      continue;
    }

    const shipType = normalizeOptionalString(entry?.shipType);
    const role = normalizeOptionalString(entry?.role);
    if (!shipType && !role) {
      continue;
    }

    shipMetadataBySymbol.set(shipSymbol, {
      ...(shipType ? { shipType } : {}),
      ...(role ? { role } : {}),
    });
  }
};

const persistShipMetadataCache = () => {
  const serialized = [...shipMetadataBySymbol.entries()]
    .map(([shipSymbol, metadata]) => ({
      shipSymbol,
      shipType: normalizeOptionalString(metadata?.shipType) || null,
      role: normalizeOptionalString(metadata?.role) || null,
    }))
    .sort((a, b) => a.shipSymbol.localeCompare(b.shipSymbol));

  savePersistentCache(SHIP_METADATA_CACHE_FILE, serialized);
};

hydrateShipMetadataCache();

export const cachePurchasedShipMetadata = (purchaseData) => {
  const shipSymbol = getPurchaseShipSymbol(purchaseData);
  if (!shipSymbol) {
    return;
  }

  const shipType = normalizeOptionalString(
    purchaseData?.transaction?.shipType || purchaseData?.ship?.frame?.symbol
  );
  const role = normalizeOptionalString(purchaseData?.ship?.registration?.role);

  if (!shipType && !role) {
    return;
  }

  const existing = shipMetadataBySymbol.get(shipSymbol) || {};
  shipMetadataBySymbol.set(shipSymbol, {
    ...existing,
    ...(shipType ? { shipType } : {}),
    ...(role ? { role } : {}),
  });
  persistShipMetadataCache();
};

export const getShipDisplayMetadata = (ship) => {
  const symbol = normalizeOptionalString(ship?.symbol);
  const cached = symbol ? (shipMetadataBySymbol.get(symbol) || {}) : {};

  const shipType = normalizeOptionalString(
    cached.shipType || ship?.frame?.symbol
  );
  const role = normalizeOptionalString(
    ship?.registration?.role || cached.role
  );

  return {
    shipType,
    role,
  };
};

export const inferShipRoleFromType = (shipType) => {
  const normalizedType = normalizeOptionalString(shipType);
  if (!normalizedType) {
    return undefined;
  }

  if (normalizedType.includes("MINING")) {
    return "EXCAVATOR";
  }
  if (normalizedType.includes("SURVEY")) {
    return "SURVEYOR";
  }
  if (normalizedType.includes("SIPHON")) {
    return "EXCAVATOR";
  }
  if (normalizedType.includes("FREIGHTER") || normalizedType.includes("HAULER")) {
    return "HAULER";
  }
  if (normalizedType.includes("COMMAND")) {
    return "COMMAND";
  }
  if (normalizedType.includes("SHUTTLE")) {
    return "TRANSPORT";
  }
  if (normalizedType.includes("FIGHTER") || normalizedType.includes("INTERCEPTOR")) {
    return "PATROL";
  }

  return undefined;
};

export const invalidateMyShipsCache = () => {
  myShipsCache = {
    cachedAt: 0,
    ships: null,
  };
};

const fetchAllMyShips = async (fleetApi) => {
  let page = 1;
  const allShips = [];

  while (true) {
    const response = await fleetApi.getMyShips(page, SHIP_PAGE_SIZE);
    const ships = response.data?.data || [];
    allShips.push(...ships);

    if (ships.length < SHIP_PAGE_SIZE) {
      break;
    }

    page += 1;
  }

  return allShips;
};

export const getAllMyShipsCached = async (fleetApi, options = {}) => {
  const { forceRefresh = false } = options;
  const now = Date.now();

  if (!forceRefresh && myShipsCache.ships && now - myShipsCache.cachedAt < SHIP_CACHE_TTL_MS) {
    return myShipsCache.ships;
  }

  const ships = await fetchAllMyShips(fleetApi);
  markShipWaypointsVisited(ships);
  myShipsCache = {
    cachedAt: now,
    ships,
  };

  return ships;
};
