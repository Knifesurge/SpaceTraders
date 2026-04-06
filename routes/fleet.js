import express from "express";
import cors from "cors";
import { DateTime } from "luxon";

import { FleetApi, SystemsApi, ShipType } from "spacetraders-sdk";
import config from "../data/config.js";
import { asyncHandler, sendSuccess } from "./http.js";
import { cacheMarketData } from "./market-cache.js";
import { hasVisitedWaypoint, markWaypointVisited } from "./visited-waypoint-cache.js";
import {
  cachePurchasedShipMetadata,
  getAllMyShipsCached,
  getShipDisplayMetadata,
  inferShipRoleFromType,
  invalidateMyShipsCache,
} from "./ship-cache.js";

const router = express.Router();
const fleetApi = new FleetApi(config);
const systemsApi = new SystemsApi(config);
const corsOptions = {
  origin: "https://api.spacetraders.io/",
  methods: ["GET", "POST", "PATCH", "OPTIONS"],
};
const waypointCacheBySystem = new Map();
const shipyardPurchaseCacheBySystem = new Map();

export const invalidateFleetCaches = () => {
  waypointCacheBySystem.clear();
  shipyardPurchaseCacheBySystem.clear();
};

router.use("/my/ships", (req, res, next) => {
  if (["POST", "PATCH", "PUT", "DELETE"].includes(req.method)) {
    invalidateMyShipsCache();
  }
  next();
});

const getCachedWaypointsForSystem = async (systemSymbol) => {
  const cacheEntry = waypointCacheBySystem.get(systemSymbol);

  if (cacheEntry) {
    return cacheEntry;
  }

  const waypoints = [];
  const pageSize = 20;
  let page = 1;
  let fetched = 0;
  let total = Number.POSITIVE_INFINITY;

  while (fetched < total) {
    const waypointResponse = await systemsApi.getSystemWaypoints(systemSymbol, page, pageSize);
    const pageData = waypointResponse.data.data || [];
    const meta = waypointResponse.data.meta;
    total = Number(meta?.total || pageData.length || 0);

    waypoints.push(...pageData.map((waypoint) => ({
      symbol: waypoint.symbol,
      systemSymbol: waypoint.systemSymbol,
      type: waypoint.type,
      x: waypoint.x,
      y: waypoint.y,
      orbitals: waypoint.orbitals.map((orbital) => orbital.symbol),
      traits: (waypoint.traits || []).map((trait) => trait.symbol),
    })));

    fetched += pageData.length;

    if (pageData.length === 0 || pageData.length < pageSize) {
      break;
    }

    page += 1;
  }

  waypointCacheBySystem.set(systemSymbol, waypoints);

  return waypoints;
};

const formatShipTypeLabel = (shipType) => (
  String(shipType || "").replace(/^SHIP_/, "").replace(/_/g, " ")
);

const getCachedShipyardPurchaseDataForSystem = async (systemSymbol) => {
  const cacheEntry = shipyardPurchaseCacheBySystem.get(systemSymbol);
  if (cacheEntry) {
    return cacheEntry;
  }

  const waypoints = await getCachedWaypointsForSystem(systemSymbol);
  const shipyardWaypoints = waypoints.filter((waypoint) => (
    (waypoint.traits || []).includes("SHIPYARD")
  ));

  const shipyardPurchaseRows = [];
  for (const waypoint of shipyardWaypoints) {
    try {
      const shipyardResponse = await systemsApi.getShipyard(systemSymbol, waypoint.symbol);
      const availableShipTypes = (shipyardResponse.data?.data?.shipTypes || [])
        .map((shipType) => shipType.type)
        .filter(Boolean);

      if (availableShipTypes.length) {
        shipyardPurchaseRows.push({
          waypointSymbol: waypoint.symbol,
          systemSymbol,
          shipTypes: [...new Set(availableShipTypes)].sort((a, b) => a.localeCompare(b)),
        });
      }
    } catch (error) {
      // Skip inaccessible shipyards and continue building purchase options.
    }
  }

  shipyardPurchaseRows.sort((a, b) => {
    if (a.systemSymbol !== b.systemSymbol) {
      return a.systemSymbol.localeCompare(b.systemSymbol);
    }
    return a.waypointSymbol.localeCompare(b.waypointSymbol);
  });

  shipyardPurchaseCacheBySystem.set(systemSymbol, shipyardPurchaseRows);
  return shipyardPurchaseRows;
};

const navigateShipWithAutoOrbit = async (shipSymbol, waypointSymbol) => {
  const navResponse = await fleetApi.getShipNav(shipSymbol);
  const shipStatus = String(navResponse.data?.data?.status || "").toUpperCase();

  if (shipStatus === "DOCKED") {
    await fleetApi.orbitShip(shipSymbol);
  }

  return fleetApi.navigateShip(shipSymbol, { waypointSymbol });
};

const refreshMarketCacheForDockedShip = async (shipSymbol) => {
  try {
    const shipResponse = await fleetApi.getMyShip(shipSymbol);
    const ship = shipResponse.data?.data;
    const shipStatus = String(ship?.nav?.status || "").toUpperCase();

    if (shipStatus !== "DOCKED") {
      return;
    }

    const systemSymbol = String(ship?.nav?.systemSymbol || "").trim();
    const waypointSymbol = String(ship?.nav?.waypointSymbol || "").trim();
    if (!systemSymbol || !waypointSymbol) {
      return null;
    }

    const marketResponse = await systemsApi.getMarket(systemSymbol, waypointSymbol);
    return cacheMarketData(marketResponse.data?.data || {}, { systemSymbol, waypointSymbol });
  } catch {
    // Best-effort cache update only; do not block dock flow.
    return null;
  }
};

const queueMarketCacheToast = (req, cacheResult, waypointSymbol) => {
  if (!req?.session || !cacheResult || cacheResult.changeType === "unchanged") {
    return;
  }

  const actionLabel = cacheResult.changeType === "added" ? "Added" : "Updated";
  req.session.appToast = {
    message: `${actionLabel} market data for ${waypointSymbol}`,
  };
};

const isShipExtractCapable = (ship, displayMetadata = {}) => {
  const shipType = String(displayMetadata.shipType || ship?.frame?.symbol || "").toUpperCase();
  const mountSymbols = (ship?.mounts || [])
    .map((mount) => String(mount?.symbol || "").toUpperCase())
    .filter(Boolean);

  // Prefer concrete capability markers over inferred role labels.
  if (shipType.includes("MINING_DRONE") || shipType.includes("SIPHON_DRONE")) {
    return true;
  }

  return mountSymbols.some((symbol) => (
    symbol.includes("MOUNT_MINING_LASER") || symbol.includes("MOUNT_GAS_SIPHON")
  ));
};

// GET all owned ships
router.get("/my/ships", cors(corsOptions), asyncHandler(async (req, res) => {
  const ships = await getAllMyShipsCached(fleetApi, { forceRefresh: true });
  const properShips = [];

  for (const ship of ships) {
    const displayMetadata = getShipDisplayMetadata(ship);
    const inferredRole = (
      displayMetadata.role
      || inferShipRoleFromType(displayMetadata.shipType)
      || "UNASSIGNED"
    );
    const shipData = {
      symbol: ship.symbol,
      type: displayMetadata.shipType || ship.frame.symbol,
      role: inferredRole,
      cooldownRemaining: ship.cooldown.remainingSeconds,
      currentFuel: ship.fuel.current,
      maxFuel: ship.fuel.capacity,
      currentCargo: ship.cargo.units,
      maxCargo: ship.cargo.capacity,
      systemSymbol: ship.nav.systemSymbol,
      waypointSymbol: ship.nav.waypointSymbol,
      status: ship.nav.status,
      origin: ship.nav.route.origin,
      destination: ship.nav.route.destination,
      arrival: ship.nav.route.arrival,
      orbitingExtractable: isShipExtractCapable(ship, displayMetadata),
    };

    const arrival = DateTime.fromISO(ship.nav.route.arrival);
    if (arrival.diffNow().milliseconds >= 0) {
      const diff = arrival.diffNow(["hours", "minutes", "seconds"]);
      shipData.timeRemaining = diff.toFormat("hh:mm:ss");
    } else {
      shipData.timeRemaining = "Arrived";
    }

    properShips.push(shipData);
  }

  sendSuccess(req, res, {
    view: "shipStatus",
    locals: { ships: properShips || [] },
  });
}));

// GET a specific ship (ship IDs/symbols always contain a dash, e.g. AGENT-1)
router.get("/my/ships/:shipId([^/]*-[^/]*)", cors(corsOptions), asyncHandler(async (req, res) => {
  const responseData = req.session.responseData;
  delete req.session.responseData;
  const shipId = req.params.shipId;

  const [shipResponse, cargoResponse] = await Promise.all([
    fleetApi.getMyShip(shipId),
    fleetApi.getMyShipCargo(shipId),
  ]);
  const ship = shipResponse.data.data;
  markWaypointVisited(ship?.nav?.waypointSymbol);
  const displayMetadata = getShipDisplayMetadata(ship);
  const inferredRole = (
    displayMetadata.role
    || inferShipRoleFromType(displayMetadata.shipType)
    || "UNASSIGNED"
  );
  const canExtractResources = (
    String(ship?.nav?.status || "").toUpperCase() !== "DOCKED"
    && isShipExtractCapable(ship, displayMetadata)
  );

  sendSuccess(req, res, {
    view: "shipDetail",
    locals: {
      ship,
      shipDisplay: {
        type: displayMetadata.shipType || ship?.frame?.symbol || "UNKNOWN",
        role: inferredRole,
      },
      canExtractResources,
      cargo: cargoResponse.data.data,
      jettisonData: responseData,
    },
  });
}));

// GET the cargo of a specific ship
router.get(
  "/my/ships/:shipSymbol/cargo",
  cors(corsOptions),
  asyncHandler(async (req, res) => {
    res.redirect(`/fleet/my/ships/${req.params.shipSymbol}#cargo`);
  })
);

// POST to jettison cargo from a ship
router.post(
  "/my/ships/:shipSymbol/jettison",
  cors(corsOptions),
  asyncHandler(async (req, res) => {
    const { shipSymbol, cargoSymbol, cargoUnits } = req.body;
    const data = { symbol: cargoSymbol, units: cargoUnits };
    await fleetApi.jettison(shipSymbol, data);

    req.session.responseData = {
      cargoSymbol,
      cargoUnits,
    };

    res.redirect(`/fleet/my/ships/${shipSymbol}#cargo`);
  })
);

// POST to refuel a ship
router.post(
  "/my/ships/:shipSymbol/refuel",
  cors(corsOptions),
  asyncHandler(async (req, res) => {
    const { shipSymbol } = req.body;
    const { units, fromCargo } = req.params;
    const properFuelAmt = units ? units : undefined;

    await fleetApi.refuelShip(shipSymbol, {
      units: properFuelAmt,
      fromCargo,
    });

    res.redirect("/fleet/my/ships/");
  })
);

// POST to extract resources
router.post(
  "/my/ships/:shipSymbol/extract",
  cors(corsOptions),
  asyncHandler(async (req, res) => {
    const { shipSymbol } = req.body;

    const cooldownResponse = await fleetApi.getShipCooldown(shipSymbol);
    if (cooldownResponse.status === 204) {
      const surveyData = {
        signature: "",
        symbol: "",
        deposits: [{ symbol: "" }],
        expiration: "",
        size: "SMALL",
      };

      const response = await fleetApi.extractResources(shipSymbol, {
        surveyData,
      });

      return sendSuccess(req, res, {
        view: "extract",
        locals: {
          shipSymbol: response.data.data.cooldown.shipSymbol,
          data: response.data.data,
          extract: true,
        },
      });
    }

    return sendSuccess(req, res, {
      view: "extract",
      locals: {
        shipSymbol: cooldownResponse.data.data.shipSymbol,
        data: cooldownResponse.data.data,
        extract: false,
      },
    });
  })
);

// Legacy POST to put a ship into orbit
router.post("/my/ships/orbit", cors(corsOptions), asyncHandler(async (req, res) => {
  const { shipSymbol } = req.body;
  await fleetApi.orbitShip(shipSymbol);
  res.redirect("/fleet/my/ships/");
}));

// Legacy POST to dock a ship
router.post("/my/ships/dock", cors(corsOptions), asyncHandler(async (req, res) => {
  const { shipSymbol } = req.body;
  await fleetApi.dockShip(shipSymbol);
  const cacheResult = await refreshMarketCacheForDockedShip(shipSymbol);
  if (cacheResult?.entry?.waypointSymbol) {
    queueMarketCacheToast(req, cacheResult, cacheResult.entry.waypointSymbol);
  }
  res.redirect("/fleet/my/ships/");
}));

// GET the ship navigation form
router.get("/my/ships/navigate", cors(corsOptions), asyncHandler(async (req, res) => {
  const preselectedShipSymbol = String(req.query.shipSymbol || "").trim().toUpperCase();
  const preselectedWaypointSymbol = String(req.query.waypointSymbol || "").trim().toUpperCase();
  const preselectedSystemSymbol = String(req.query.systemSymbol || "").trim().toUpperCase();
  const myShips = await getAllMyShipsCached(fleetApi);
  const shipData = [];
  for (const ship of myShips) {
    shipData.push({
      symbol: ship.symbol,
      systemSymbol: ship.nav.systemSymbol,
      waypointSymbol: ship.nav.waypointSymbol,
      flightMode: ship.nav.flightMode,
      engineSpeed: ship.engine.speed,
    });
  }

  const currentSystems = [...new Set(shipData.map((ship) => ship.systemSymbol))];
  const waypointData = [];
  for (const system of currentSystems) {
    const cachedWaypoints = await getCachedWaypointsForSystem(system);
    for (const waypoint of cachedWaypoints) {
      waypointData.push({
        ...waypoint,
        visited: hasVisitedWaypoint(waypoint.symbol),
      });
    }
  }

  sendSuccess(req, res, {
    view: "shipNavigationForm",
    locals: {
      ships: shipData || [],
      waypoints: waypointData || [],
      preselectedShipSymbol,
      preselectedWaypointSymbol,
      preselectedSystemSymbol,
    },
  });
}));

// Legacy POST to navigate a ship to a waypoint
router.post("/my/ships/navigate/submit", cors(corsOptions), asyncHandler(async (req, res) => {
  const { shipSymbol, waypointSymbol } = req.body;
  const response = await navigateShipWithAutoOrbit(shipSymbol, waypointSymbol);
  const navigationData = response.data?.data || response.data || {};

  sendSuccess(req, res, {
    view: "shipNavigationResult",
    locals: {
      shipSymbol,
      requestedWaypointSymbol: waypointSymbol,
      data: navigationData,
    },
  });
}));

// Canonical navigate endpoint while keeping legacy /navigate/submit route.
router.post(
  "/my/ships/:shipSymbol/navigate",
  cors(corsOptions),
  asyncHandler(async (req, res) => {
    const { waypointSymbol } = req.body;
    const response = await navigateShipWithAutoOrbit(req.params.shipSymbol, waypointSymbol);
    sendSuccess(req, res, { data: response.data });
  })
);

// GET ship purchase form
router.get("/my/ships/purchase", cors(corsOptions), asyncHandler(async (req, res) => {
  const myShips = await getAllMyShipsCached(fleetApi);
  const currentSystems = [...new Set(myShips.map((ship) => ship.nav.systemSymbol))];

  const purchaseWaypoints = [];
  for (const systemSymbol of currentSystems) {
    const shipyardPurchaseRows = await getCachedShipyardPurchaseDataForSystem(systemSymbol);
    purchaseWaypoints.push(...shipyardPurchaseRows);
  }

  const purchaseWaypointOptions = purchaseWaypoints.map((waypoint) => ({
    waypointSymbol: waypoint.waypointSymbol,
    systemSymbol: waypoint.systemSymbol,
    shipTypes: waypoint.shipTypes.map((shipType) => ({
      value: shipType,
      label: formatShipTypeLabel(shipType),
    })),
  }));

  sendSuccess(req, res, {
    view: "shipPurchaseForm",
    locals: {
      purchaseWaypoints: purchaseWaypointOptions,
      hasPurchaseOptions: purchaseWaypointOptions.length > 0,
    },
  });
}));

// Legacy POST to purchase a new ship from specific waypoint
router.post("/my/ships/purchaseship", cors(corsOptions), asyncHandler(async (req, res) => {
  const { waypointSymbol, shipType } = req.body;
  const shipTypeKey = Object.keys(ShipType).find(
    (key) => ShipType[key] === shipType.toUpperCase()
  );
  const properShipType = shipTypeKey ? ShipType[shipTypeKey] : undefined;
  const purchaseRequest = {
    shipType: properShipType,
    waypointSymbol,
  };
  const response = await fleetApi.purchaseShip(purchaseRequest);
  const purchaseData = response.data?.data || null;
  cachePurchasedShipMetadata(purchaseData);

  sendSuccess(req, res, {
    view: "shipPurchaseResult",
    locals: { data: purchaseData || response.data },
  });
}));

// Canonical purchase endpoint while keeping legacy /purchaseship route.
router.post(
  "/my/ships/purchase",
  cors(corsOptions),
  asyncHandler(async (req, res) => {
    const { waypointSymbol, shipType } = req.body;
    const shipTypeKey = Object.keys(ShipType).find(
      (key) => ShipType[key] === shipType.toUpperCase()
    );
    const properShipType = shipTypeKey ? ShipType[shipTypeKey] : undefined;
    const purchaseRequest = {
      shipType: properShipType,
      waypointSymbol,
    };
    const response = await fleetApi.purchaseShip(purchaseRequest);
    cachePurchasedShipMetadata(response.data?.data || null);
    sendSuccess(req, res, { data: response.data });
  })
);

// Canonical dock endpoint while keeping legacy /my/ships/dock route.
router.post(
  "/my/ships/:shipSymbol/dock",
  cors(corsOptions),
  asyncHandler(async (req, res) => {
    const shipSymbol = req.params.shipSymbol;
    const response = await fleetApi.dockShip(shipSymbol);
    const cacheResult = await refreshMarketCacheForDockedShip(shipSymbol);
    if (cacheResult?.entry?.waypointSymbol) {
      queueMarketCacheToast(req, cacheResult, cacheResult.entry.waypointSymbol);
    }
    sendSuccess(req, res, { data: response.data });
  })
);

// Canonical orbit endpoint while keeping legacy /my/ships/orbit route.
router.post(
  "/my/ships/:shipSymbol/orbit",
  cors(corsOptions),
  asyncHandler(async (req, res) => {
    const response = await fleetApi.orbitShip(req.params.shipSymbol);
    sendSuccess(req, res, { data: response.data });
  })
);

// POST create chart for a ship at its current waypoint
router.post("/my/ships/:shipSymbol/chart", cors(corsOptions), asyncHandler(async (req, res) => {
  const response = await fleetApi.createChart(req.params.shipSymbol);
  sendSuccess(req, res, { data: response.data });
}));

// POST scan nearby ships
router.post(
  "/my/ships/:shipSymbol/scan/ships",
  cors(corsOptions),
  asyncHandler(async (req, res) => {
    const response = await fleetApi.createShipShipScan(req.params.shipSymbol);
    sendSuccess(req, res, { data: response.data });
  })
);

// POST scan nearby systems
router.post(
  "/my/ships/:shipSymbol/scan/systems",
  cors(corsOptions),
  asyncHandler(async (req, res) => {
    const response = await fleetApi.createShipSystemScan(req.params.shipSymbol);
    sendSuccess(req, res, { data: response.data });
  })
);

// POST scan nearby waypoints
router.post(
  "/my/ships/:shipSymbol/scan/waypoints",
  cors(corsOptions),
  asyncHandler(async (req, res) => {
    const response = await fleetApi.createShipWaypointScan(req.params.shipSymbol);
    sendSuccess(req, res, { data: response.data });
  })
);

// POST create survey from ship location
router.post(
  "/my/ships/:shipSymbol/survey",
  cors(corsOptions),
  asyncHandler(async (req, res) => {
    const response = await fleetApi.createSurvey(req.params.shipSymbol);
    sendSuccess(req, res, { data: response.data });
  })
);

// POST extract using survey payload
router.post(
  "/my/ships/:shipSymbol/extract/survey",
  cors(corsOptions),
  asyncHandler(async (req, res) => {
    const response = await fleetApi.extractResourcesWithSurvey(
      req.params.shipSymbol,
      req.body
    );
    sendSuccess(req, res, { data: response.data });
  })
);

// GET current cooldown for ship
router.get(
  "/my/ships/:shipSymbol/cooldown",
  cors(corsOptions),
  asyncHandler(async (req, res) => {
    const response = await fleetApi.getShipCooldown(req.params.shipSymbol);
    sendSuccess(req, res, { data: response.data });
  })
);

// GET current navigation state for ship
router.get("/my/ships/:shipSymbol/nav", cors(corsOptions), asyncHandler(async (req, res) => {
  const response = await fleetApi.getShipNav(req.params.shipSymbol);
  sendSuccess(req, res, { data: response.data });
}));

// PATCH ship flight mode/nav config
router.patch(
  "/my/ships/:shipSymbol/nav",
  cors(corsOptions),
  asyncHandler(async (req, res) => {
    const response = await fleetApi.patchShipNav(req.params.shipSymbol, req.body);
    sendSuccess(req, res, { data: response.data });
  })
);

// POST jump ship to linked jump gate waypoint
router.post(
  "/my/ships/:shipSymbol/jump",
  cors(corsOptions),
  asyncHandler(async (req, res) => {
    const response = await fleetApi.jumpShip(req.params.shipSymbol, req.body);
    sendSuccess(req, res, { data: response.data });
  })
);

// POST warp ship to destination waypoint
router.post(
  "/my/ships/:shipSymbol/warp",
  cors(corsOptions),
  asyncHandler(async (req, res) => {
    const response = await fleetApi.warpShip(req.params.shipSymbol, req.body);
    sendSuccess(req, res, { data: response.data });
  })
);

// POST negotiate a contract while docked
router.post(
  "/my/ships/:shipSymbol/negotiate/contract",
  cors(corsOptions),
  asyncHandler(async (req, res) => {
    const response = await fleetApi.negotiateContract(req.params.shipSymbol);
    sendSuccess(req, res, { data: response.data });
  })
);

// POST purchase cargo from current market
router.post(
  "/my/ships/:shipSymbol/cargo/purchase",
  cors(corsOptions),
  asyncHandler(async (req, res) => {
    const response = await fleetApi.purchaseCargo(req.params.shipSymbol, req.body);
    sendSuccess(req, res, { data: response.data });
  })
);

// POST sell cargo to current market
router.post(
  "/my/ships/:shipSymbol/cargo/sell",
  cors(corsOptions),
  asyncHandler(async (req, res) => {
    const response = await fleetApi.sellCargo(req.params.shipSymbol, req.body);
    sendSuccess(req, res, { data: response.data });
  })
);

// POST transfer cargo from this ship to another ship
router.post(
  "/my/ships/:shipSymbol/cargo/transfer",
  cors(corsOptions),
  asyncHandler(async (req, res) => {
    const response = await fleetApi.transferCargo(req.params.shipSymbol, req.body);
    sendSuccess(req, res, { data: response.data });
  })
);

// POST siphon resources from gas giant location
router.post(
  "/my/ships/:shipSymbol/siphon",
  cors(corsOptions),
  asyncHandler(async (req, res) => {
    const response = await fleetApi.siphonResources(req.params.shipSymbol);
    sendSuccess(req, res, { data: response.data });
  })
);

// POST refine cargo into refined goods
router.post(
  "/my/ships/:shipSymbol/refine",
  cors(corsOptions),
  asyncHandler(async (req, res) => {
    const response = await fleetApi.shipRefine(req.params.shipSymbol, req.body);
    sendSuccess(req, res, { data: response.data });
  })
);

// GET available mounts and mount state
router.get(
  "/my/ships/:shipSymbol/mounts",
  cors(corsOptions),
  asyncHandler(async (req, res) => {
    const response = await fleetApi.getMounts(req.params.shipSymbol);
    sendSuccess(req, res, { data: response.data });
  })
);

// POST install a mount
router.post(
  "/my/ships/:shipSymbol/mounts/install",
  cors(corsOptions),
  asyncHandler(async (req, res) => {
    const response = await fleetApi.installMount(req.params.shipSymbol, req.body);
    sendSuccess(req, res, { data: response.data });
  })
);

// POST remove a mount
router.post(
  "/my/ships/:shipSymbol/mounts/remove",
  cors(corsOptions),
  asyncHandler(async (req, res) => {
    const response = await fleetApi.removeMount(req.params.shipSymbol, req.body);
    sendSuccess(req, res, { data: response.data });
  })
);

// GET ship modules and available upgrades
router.get(
  "/my/ships/:shipSymbol/modules",
  cors(corsOptions),
  asyncHandler(async (req, res) => {
    const response = await fleetApi.getShipModules(req.params.shipSymbol);
    sendSuccess(req, res, { data: response.data });
  })
);

// POST install ship module
router.post(
  "/my/ships/:shipSymbol/modules/install",
  cors(corsOptions),
  asyncHandler(async (req, res) => {
    const response = await fleetApi.installShipModule(req.params.shipSymbol, req.body);
    sendSuccess(req, res, { data: response.data });
  })
);

// POST remove ship module
router.post(
  "/my/ships/:shipSymbol/modules/remove",
  cors(corsOptions),
  asyncHandler(async (req, res) => {
    const response = await fleetApi.removeShipModule(req.params.shipSymbol, req.body);
    sendSuccess(req, res, { data: response.data });
  })
);

// GET repair quote
router.get(
  "/my/ships/:shipSymbol/repair",
  cors(corsOptions),
  asyncHandler(async (req, res) => {
    const response = await fleetApi.getRepairShip(req.params.shipSymbol);
    sendSuccess(req, res, { data: response.data });
  })
);

// POST perform repair
router.post(
  "/my/ships/:shipSymbol/repair",
  cors(corsOptions),
  asyncHandler(async (req, res) => {
    const response = await fleetApi.repairShip(req.params.shipSymbol);
    sendSuccess(req, res, { data: response.data });
  })
);

// GET scrap quote
router.get(
  "/my/ships/:shipSymbol/scrap",
  cors(corsOptions),
  asyncHandler(async (req, res) => {
    const response = await fleetApi.getScrapShip(req.params.shipSymbol);
    sendSuccess(req, res, { data: response.data });
  })
);

// POST scrap ship
router.post(
  "/my/ships/:shipSymbol/scrap",
  cors(corsOptions),
  asyncHandler(async (req, res) => {
    const response = await fleetApi.scrapShip(req.params.shipSymbol);
    sendSuccess(req, res, { data: response.data });
  })
);

export default router;
