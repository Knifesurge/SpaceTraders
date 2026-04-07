import { loadPersistentCache, savePersistentCache } from "./persistent-cache-store.js";

const visitedWaypointsByAgent = new Map();
const VISITED_WAYPOINTS_FILE = "visited-waypoints.json";

const normalizeSymbol = (value) => (typeof value === "string" ? value.trim().toUpperCase() : "");

const getActiveAgentKey = () => {
  const token = String(process.env.AGENT_TOKEN || "").trim();
  return token || "anonymous-agent";
};

const getVisitedMapForAgent = (agentKey = getActiveAgentKey()) => {
  if (!visitedWaypointsByAgent.has(agentKey)) {
    visitedWaypointsByAgent.set(agentKey, new Map());
  }

  return visitedWaypointsByAgent.get(agentKey);
};

const hydrateVisitedWaypointCache = () => {
  const persistedAgents = loadPersistentCache(VISITED_WAYPOINTS_FILE, {});
  const safeAgents = persistedAgents && typeof persistedAgents === "object" ? persistedAgents : {};

  for (const [agentKey, visitedEntries] of Object.entries(safeAgents)) {
    const visitedMap = new Map();
    const safeEntries = Array.isArray(visitedEntries) ? visitedEntries : [];

    for (const entry of safeEntries) {
      const symbol = normalizeSymbol(entry?.symbol);
      if (!symbol) {
        continue;
      }

      visitedMap.set(symbol, {
        symbol,
        visitedAt: Number(entry?.visitedAt || 0),
      });
    }

    visitedWaypointsByAgent.set(agentKey, visitedMap);
  }
};

const persistVisitedWaypointCache = () => {
  const serialized = {};
  for (const [agentKey, visitedMap] of visitedWaypointsByAgent.entries()) {
    serialized[agentKey] = [...visitedMap.values()].sort((a, b) => a.symbol.localeCompare(b.symbol));
  }

  savePersistentCache(VISITED_WAYPOINTS_FILE, serialized);
};

hydrateVisitedWaypointCache();

export const markWaypointVisited = (waypointSymbol, options = {}) => {
  const symbol = normalizeSymbol(waypointSymbol);
  if (!symbol) {
    return;
  }

  const agentKey = options.agentKey || getActiveAgentKey();
  const visitedMap = getVisitedMapForAgent(agentKey);
  if (visitedMap.has(symbol)) {
    return;
  }

  visitedMap.set(symbol, {
    symbol,
    visitedAt: Date.now(),
  });
  persistVisitedWaypointCache();
};

export const markShipWaypointsVisited = (ships, options = {}) => {
  const safeShips = Array.isArray(ships) ? ships : [];
  for (const ship of safeShips) {
    markWaypointVisited(ship?.nav?.waypointSymbol, options);
  }
};

export const hasVisitedWaypoint = (waypointSymbol, options = {}) => {
  const symbol = normalizeSymbol(waypointSymbol);
  if (!symbol) {
    return false;
  }

  const agentKey = options.agentKey || getActiveAgentKey();
  return getVisitedMapForAgent(agentKey).has(symbol);
};

export const getVisitedWaypointSymbols = (options = {}) => {
  const agentKey = options.agentKey || getActiveAgentKey();
  return [...getVisitedMapForAgent(agentKey).keys()].sort((a, b) => a.localeCompare(b));
};
