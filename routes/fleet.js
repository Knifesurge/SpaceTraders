import express from "express";
import cors from "cors";
import { DateTime } from "luxon";

import { FleetApi, SystemsApi, ShipType } from "spacetraders-sdk";
import config from "../data/config.js";
import { asyncHandler, sendSuccess } from "./http.js";

const router = express.Router();
const fleetApi = new FleetApi(config);
const systemsApi = new SystemsApi(config);
const corsOptions = {
  origin: "https://api.spacetraders.io/",
  methods: ["GET", "POST", "PATCH", "OPTIONS"],
};

// GET all owned ships
router.get("/my/ships", cors(corsOptions), asyncHandler(async (req, res) => {
  const response = await fleetApi.getMyShips();
  const properShips = [];
  const ships = response.data.data;

  for (const ship of ships) {
    const shipData = {
      symbol: ship.symbol,
      type: ship.frame.symbol,
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
      orbitingExtractable: true,
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

// GET a specific ship
router.get("/my/ships/:shipSymbol", cors(corsOptions), asyncHandler(async (req, res) => {
  const response = await fleetApi.getMyShip(req.params.shipSymbol);
  sendSuccess(req, res, {
    view: "response",
    locals: response.data,
  });
}));

// GET the cargo of a specific ship
router.get(
  "/my/ships/:shipSymbol/cargo",
  cors(corsOptions),
  asyncHandler(async (req, res) => {
    const responseData = req.session.responseData;
    delete req.session.responseData;

    const response = await fleetApi.getMyShipCargo(req.params.shipSymbol);
    sendSuccess(req, res, {
      view: "shipCargo",
      locals: {
        data: response.data.data,
        shipSymbol: req.params.shipSymbol,
        jettisonData: responseData,
      },
    });
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

    res.redirect(`/fleet/my/ships/${shipSymbol}/cargo`);
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
  res.redirect("/fleet/my/ships/");
}));

// GET the ship navigation form
router.get("/my/ships/navigate", cors(corsOptions), asyncHandler(async (req, res) => {
  const myShipResponse = await fleetApi.getMyShips();
  const shipData = [];
  for (const ship of myShipResponse.data.data) {
    shipData.push({
      symbol: ship.symbol,
      systemSymbol: ship.nav.systemSymbol,
    });
  }

  const currentSystems = [...new Set(shipData.map((ship) => ship.systemSymbol))];
  const waypointData = [];
  for (const system of currentSystems) {
    const waypointResponse = await systemsApi.getSystemWaypoints(system);
    for (const waypoint of waypointResponse.data.data) {
      waypointData.push({
        symbol: waypoint.symbol,
        systemSymbol: waypoint.systemSymbol,
        type: waypoint.type,
        orbitals: waypoint.orbitals.map((orbital) => orbital.symbol),
      });
    }
  }

  sendSuccess(req, res, {
    view: "shipNavigationForm",
    locals: {
      ships: shipData || [],
      waypoints: waypointData || [],
    },
  });
}));

// Legacy POST to navigate a ship to a waypoint
router.post("/my/ships/navigate/submit", cors(corsOptions), asyncHandler(async (req, res) => {
  const { shipSymbol, waypointSymbol } = req.body;
  const response = await fleetApi.navigateShip(shipSymbol, { waypointSymbol });

  sendSuccess(req, res, {
    view: "response",
    locals: { data: response.data },
  });
}));

// Canonical navigate endpoint while keeping legacy /navigate/submit route.
router.post(
  "/my/ships/:shipSymbol/navigate",
  cors(corsOptions),
  asyncHandler(async (req, res) => {
    const { waypointSymbol } = req.body;
    const response = await fleetApi.navigateShip(req.params.shipSymbol, {
      waypointSymbol,
    });
    sendSuccess(req, res, { data: response.data });
  })
);

const shipPurchaseOptions = Object.values(ShipType).map((value) => ({
  value,
  label: value.replace(/^SHIP_/, "").replace(/_/g, " "),
}));

// GET ship purchase form
router.get("/my/ships/purchase", cors(corsOptions), asyncHandler(async (req, res) => {
  sendSuccess(req, res, {
    view: "shipPurchaseForm",
    locals: { shipPurchaseOptions },
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

  sendSuccess(req, res, {
    view: "response",
    locals: { data: response.data },
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
    sendSuccess(req, res, { data: response.data });
  })
);

// Canonical dock endpoint while keeping legacy /my/ships/dock route.
router.post(
  "/my/ships/:shipSymbol/dock",
  cors(corsOptions),
  asyncHandler(async (req, res) => {
    const response = await fleetApi.dockShip(req.params.shipSymbol);
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
