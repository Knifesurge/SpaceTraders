import express from "express";
import cors from "cors";

import { FleetApi, SystemsApi, WaypointTraitSymbol } from "spacetraders-sdk";
import config from "../data/config.js";
import { asyncHandler, sendSuccess } from "./http.js";
import { getAllMyShipsCached } from "./ship-cache.js";

const systemsApi = new SystemsApi(config);
const fleetApi = new FleetApi(config);

const router = express.Router();
const corsOptions = {
  origin: "https://api.spacetraders.io/",
  methods: ["GET", "POST", "PATCH", "OPTIONS"],
};

const getAllSystemWaypoints = async (systemSymbol) => {
  const pageSize = 20;
  let page = 1;
  const allWaypoints = [];

  while (true) {
    const response = await systemsApi.getSystemWaypoints(systemSymbol, page, pageSize);
    const waypoints = response.data?.data || [];
    allWaypoints.push(...waypoints);

    if (waypoints.length < pageSize) {
      break;
    }

    page += 1;
  }

  return allWaypoints;
};

const normalizeSymbol = (value) => (typeof value === "string" ? value.trim().toUpperCase() : "");

// GET all systems
router.get("/", cors(corsOptions), asyncHandler(async (req, res) => {
  const page = req.query.page ? Number(req.query.page) : undefined;
  const limit = req.query.limit ? Number(req.query.limit) : undefined;
  const response = await systemsApi.getSystems(page, limit);
  sendSuccess(req, res, { data: response.data });
}));

// GET card-based waypoint overview for a system where the player currently has ships.
router.get("/current/view", cors(corsOptions), asyncHandler(async (req, res) => {
  const myShips = await getAllMyShipsCached(fleetApi);

  const systemsInFleet = [...new Set(myShips.map((ship) => normalizeSymbol(ship.nav.systemSymbol)))];
  const requestedSystem = typeof req.query.system === "string"
    ? normalizeSymbol(req.query.system)
    : null;
  const selectedSystem = (
    requestedSystem && systemsInFleet.includes(requestedSystem)
  )
    ? requestedSystem
    : systemsInFleet[0];

  if (!selectedSystem) {
    return sendSuccess(req, res, {
      view: "systemCurrentWaypoints",
      locals: {
        title: "Current System Waypoints",
        systemSymbol: null,
        systemsInFleet,
        selectedSystem: null,
        currentWaypointSymbol: null,
        waypoints: [],
        debugData: {
          selectedSystem: null,
          shipWaypointSymbols: [],
          listedWaypointSymbols: [],
          unmatchedShipWaypointSymbols: [],
        },
      },
    });
  }

  const anchorShip = myShips.find((ship) => normalizeSymbol(ship.nav.systemSymbol) === selectedSystem) || myShips[0];
  const currentWaypointSymbol = normalizeSymbol(anchorShip?.nav.waypointSymbol);

  const sourceWaypoints = await getAllSystemWaypoints(selectedSystem);
  const currentWaypoint = sourceWaypoints.find(
    (waypoint) => normalizeSymbol(waypoint.symbol) === currentWaypointSymbol
  );
  const shipsInSelectedSystem = myShips.filter(
    (ship) => normalizeSymbol(ship.nav.systemSymbol) === selectedSystem
  );

  const shipsByWaypoint = new Map();
  for (const ship of shipsInSelectedSystem) {
    const waypointSymbol = normalizeSymbol(ship.nav.waypointSymbol);
    if (!shipsByWaypoint.has(waypointSymbol)) {
      shipsByWaypoint.set(waypointSymbol, []);
    }
    shipsByWaypoint.get(waypointSymbol).push({
      symbol: ship.symbol,
      status: ship.nav.status,
    });
  }

  const hasTrait = (waypoint, traitSymbol) => (
    (waypoint.traits || []).some((trait) => trait.symbol === traitSymbol)
  );

  const waypoints = sourceWaypoints.map((waypoint) => {
    const dx = currentWaypoint ? waypoint.x - currentWaypoint.x : 0;
    const dy = currentWaypoint ? waypoint.y - currentWaypoint.y : 0;
    const distanceFromCurrent = currentWaypoint
      ? Math.sqrt((dx * dx) + (dy * dy))
      : null;

    const hasMarketplace = hasTrait(waypoint, "MARKETPLACE");
    const hasShipyard = hasTrait(waypoint, "SHIPYARD");
    const hasFuelStation = hasTrait(waypoint, "FUEL_STATION");
    const isUncharted = hasTrait(waypoint, "UNCHARTED");
    const isJumpGate = waypoint.type === "JUMP_GATE";

    const highlights = [];
    if (hasMarketplace) highlights.push("Marketplace");
    if (hasShipyard) highlights.push("Shipyard");
    if (hasFuelStation) highlights.push("Fuel Station");
    if (isJumpGate) highlights.push("Jump Gate");
    if (waypoint.isUnderConstruction) highlights.push("Construction Site");
    if (isUncharted) highlights.push("Uncharted");

    const waypointSymbol = normalizeSymbol(waypoint.symbol);
    const shipsAtWaypoint = shipsByWaypoint.get(waypointSymbol) || [];
    const dockedShips = shipsAtWaypoint
      .filter((ship) => ship.status === "DOCKED")
      .map((ship) => ship.symbol);
    const orbitingShips = shipsAtWaypoint
      .filter((ship) => ship.status === "IN_ORBIT")
      .map((ship) => ship.symbol);

    return {
      symbol: waypoint.symbol,
      type: waypoint.type,
      x: waypoint.x,
      y: waypoint.y,
      orbitalsCount: (waypoint.orbitals || []).length,
      traits: (waypoint.traits || []).map((trait) => trait.symbol),
      highlights,
      isUnderConstruction: waypoint.isUnderConstruction,
      hasMarketplace,
      hasShipyard,
      isJumpGate,
      distanceFromCurrent,
      isCurrent: waypointSymbol === currentWaypointSymbol,
      shipsAtWaypoint,
      dockedShips,
      orbitingShips,
    };
  });

  // If ship waypoint symbols are not present in listed waypoints, surface them anyway.
  for (const [missingWaypointSymbol, shipsAtWaypoint] of shipsByWaypoint.entries()) {
    const alreadyPresent = waypoints.some(
      (waypoint) => normalizeSymbol(waypoint.symbol) === missingWaypointSymbol
    );

    if (!alreadyPresent) {
      const dockedShips = shipsAtWaypoint
        .filter((ship) => ship.status === "DOCKED")
        .map((ship) => ship.symbol);
      const orbitingShips = shipsAtWaypoint
        .filter((ship) => ship.status === "IN_ORBIT")
        .map((ship) => ship.symbol);

      waypoints.push({
        symbol: missingWaypointSymbol,
        type: "UNKNOWN",
        x: "?",
        y: "?",
        orbitalsCount: 0,
        traits: [],
        highlights: ["Ship Presence", "Not in waypoint listing"],
        isUnderConstruction: false,
        hasMarketplace: false,
        hasShipyard: false,
        isJumpGate: false,
        distanceFromCurrent: null,
        isCurrent: missingWaypointSymbol === currentWaypointSymbol,
        shipsAtWaypoint,
        dockedShips,
        orbitingShips,
      });
    }
  }

  waypoints.sort((a, b) => {
    if (a.isCurrent) return -1;
    if (b.isCurrent) return 1;
    if (b.highlights.length !== a.highlights.length) {
      return b.highlights.length - a.highlights.length;
    }
    return a.symbol.localeCompare(b.symbol);
  });

  const shipWaypointSymbols = [...shipsByWaypoint.keys()].sort();
  const listedWaypointSymbols = sourceWaypoints
    .map((waypoint) => normalizeSymbol(waypoint.symbol))
    .sort();
  const listedWaypointSet = new Set(listedWaypointSymbols);
  const unmatchedShipWaypointSymbols = shipWaypointSymbols
    .filter((symbol) => !listedWaypointSet.has(symbol))
    .sort();

  return sendSuccess(req, res, {
    view: "systemCurrentWaypoints",
    locals: {
      title: "Current System Waypoints",
      systemSymbol: selectedSystem,
      systemsInFleet,
      selectedSystem,
      currentWaypointSymbol,
      waypoints,
      debugData: {
        selectedSystem,
        shipWaypointSymbols,
        listedWaypointSymbols,
        unmatchedShipWaypointSymbols,
      },
    },
  });
}));

// GET specific system by ID
router.get("/:systemId", cors(corsOptions), asyncHandler(async (req, res) => {
  const response = await systemsApi.getSystem(req.params.systemId);
  sendSuccess(req, res, { data: response.data });
}));

// GET all waypoints in a specific system
router.get("/:systemId/waypoints", cors(corsOptions), asyncHandler(async (req, res) => {
  // Capture the possible query parameters
  const { page, limit, type, traits } = req.query;
  // Perform a reverse lookup on WaypointTraitSymbol
  const traitKey = traits
    ? Object.keys(WaypointTraitSymbol).find(
        (key) => WaypointTraitSymbol[key] === traits.toUpperCase()
      )
    : undefined;
  const trait = traitKey
    ? { traits: WaypointTraitSymbol[traitKey] }
    : undefined;
  const response = await systemsApi.getSystemWaypoints(
    req.params.systemId,
    page,
    limit,
    type,
    trait
  );
  sendSuccess(req, res, { data: response.data });
}));

// GET specific waypoint by ID in a specific system
router.get(
  "/:systemId/waypoints/:waypointId",
  cors(corsOptions),
  asyncHandler(async (req, res) => {
    const response = await systemsApi.getWaypoint(
      req.params.systemId,
      req.params.waypointId
    );
    sendSuccess(req, res, { data: response.data });
  })
);

// GET shipyard information for a specific waypoint in a specific system
router.get(
  "/:systemId/waypoints/:waypointId/shipyard",
  cors(corsOptions),
  asyncHandler(async (req, res) => {
    const response = await systemsApi.getShipyard(
      req.params.systemId,
      req.params.waypointId
    );
    sendSuccess(req, res, { data: response.data });
  })
);

// GET market information for a specific waypoint in a specific system
router.get(
  "/:systemId/waypoints/:waypointId/market",
  cors(corsOptions),
  asyncHandler(async (req, res) => {
    const response = await systemsApi.getMarket(
      req.params.systemId,
      req.params.waypointId
    );
    sendSuccess(req, res, { data: response.data });
  })
);

router.get(
  "/:systemId/waypoints/:waypointId/market/view",
  cors(corsOptions),
  asyncHandler(async (req, res) => {
    const response = await systemsApi.getMarket(
      req.params.systemId,
      req.params.waypointId
    );
    sendSuccess(req, res, {
      view: "systemMarket",
      locals: {
        title: "Market",
        systemSymbol: req.params.systemId,
        waypointSymbol: req.params.waypointId,
        data: response.data.data,
      },
    });
  })
);

// GET jump gate information for a specific waypoint in a specific system
router.get(
  "/:systemId/waypoints/:waypointId/jump-gate",
  cors(corsOptions),
  asyncHandler(async (req, res) => {
    const response = await systemsApi.getJumpGate(
      req.params.systemId,
      req.params.waypointId
    );
    sendSuccess(req, res, { data: response.data });
  })
);

router.get(
  "/:systemId/waypoints/:waypointId/jump-gate/view",
  cors(corsOptions),
  asyncHandler(async (req, res) => {
    const response = await systemsApi.getJumpGate(
      req.params.systemId,
      req.params.waypointId
    );
    sendSuccess(req, res, {
      view: "systemJumpGate",
      locals: {
        title: "Jump Gate",
        systemSymbol: req.params.systemId,
        waypointSymbol: req.params.waypointId,
        data: response.data.data,
      },
    });
  })
);

// GET construction site information for a specific waypoint in a specific system
router.get(
  "/:systemId/waypoints/:waypointId/construction",
  cors(corsOptions),
  asyncHandler(async (req, res) => {
    const response = await systemsApi.getConstruction(
      req.params.systemId,
      req.params.waypointId
    );
    sendSuccess(req, res, { data: response.data });
  })
);

router.get(
  "/:systemId/waypoints/:waypointId/construction/view",
  cors(corsOptions),
  asyncHandler(async (req, res) => {
    const response = await systemsApi.getConstruction(
      req.params.systemId,
      req.params.waypointId
    );
    sendSuccess(req, res, {
      view: "systemConstruction",
      locals: {
        title: "Construction",
        systemSymbol: req.params.systemId,
        waypointSymbol: req.params.waypointId,
        data: response.data.data,
      },
    });
  })
);

// POST supply materials to a construction site
router.post(
  "/:systemId/waypoints/:waypointId/construction/supply",
  cors(corsOptions),
  asyncHandler(async (req, res) => {
    const response = await systemsApi.supplyConstruction(
      req.params.systemId,
      req.params.waypointId,
      req.body
    );
    sendSuccess(req, res, { data: response.data });
  })
);
export default router;
