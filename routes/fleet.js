import express from "express";
import cors from "cors";
import { DateTime, Duration } from "luxon";

import { FleetApi, SystemsApi, ShipType } from "spacetraders-sdk";
import config from "../data/config.js";

const router = express.Router();
const fleetApi = new FleetApi(config);
const systemsApi = new SystemsApi(config);
const corsOptions = {
  origin: "https://api.spacetraders.io/",
  methods: ["GET", "POST", "PATCH", "OPTIONS"],
};

// GET all owned ships
router.get("/my/ships", cors(corsOptions), async (req, res) => {
  const response = await fleetApi.getMyShips();
  //console.log(response.data);
  const properShips = [];
  const ships = response.data.data;
  for (const ship of ships) {
    const shipData = {
      symbol: ship.symbol,
      type: ship.frame.symbol,
      systemSymbol: ship.nav.systemSymbol,
      waypointSymbol: ship.nav.waypointSymbol,
      status: ship.nav.status,
      origin: ship.nav.route.origin,
      destination: ship.nav.route.destination,
    };
    const arrival = DateTime.fromISO(ship.nav.route.arrival);
    const departure = DateTime.fromISO(ship.nav.route.departureTime);
    if (arrival.diffNow().milliseconds >= 0) {
      const diff = arrival.diffNow(["hours", "minutes", "seconds"]);
      const timeRemaining = diff.toFormat("hh:mm:ss");
      shipData.timeRemaining = timeRemaining;
    } else {
      shipData.timeRemaining = "Arrived";
    }
    properShips.push(shipData);
  }
  res.render("shipStatus", {
    ships: properShips ? properShips : [],
  });
  //res.type("json").send(JSON.stringify(response.data, null, 2));
});

router.post("/my/ships/orbit", cors(corsOptions), async (req, res) => {
  const { shipSymbol } = req.body;
  const response = await fleetApi.orbitShip(shipSymbol);
  res.redirect("/fleet/my/ships/");
});

router.post("/my/ships/dock", cors(corsOptions), async (req, res) => {
  const { shipSymbol } = req.body;
  const response = await fleetApi.dockShip(shipSymbol);
  res.redirect("/fleet/my/ships/");
});

router.get("/my/ships/navigate", cors(corsOptions), async (req, res) => {
  // Get all owned ships and their current systems
  const myShipResponse = await fleetApi.getMyShips();
  const shipData = [];
  //console.log("==> Ships:");
  //console.dir(myShipResponse.data.data, { depth: null });
  for (const ship of myShipResponse.data.data) {
    shipData.push({
      symbol: ship.symbol,
      systemSymbol: ship.nav.systemSymbol,
    });
  }
  //console.dir(shipData, { depth: null });
  //console.log("==> Systems:");
  // Only add unique systems so we don't make duplicate API calls
  const currentSystems = [
    ...new Set(shipData.map((ship) => ship.systemSymbol)),
  ];
  //console.dir(currentSystems, { depth: null });
  // Get all waypoints in the current systems
  const waypointData = [];
  for (const system of currentSystems) {
    const waypointResponse = await systemsApi.getSystemWaypoints(system);
    //console.dir(waypointResponse.data, { depth: null });
    for (const waypoint of waypointResponse.data.data) {
      waypointData.push({
        symbol: waypoint.symbol,
        systemSymbol: waypoint.systemSymbol,
        type: waypoint.type,
        orbitals: waypoint.orbitals.map((orbital) => orbital.symbol),
      });
    }
  }
  //console.dir(waypointData, { depth: null });
  res.render("shipNavigationForm", {
    ships: shipData ? shipData : [],
    waypoints: waypointData ? waypointData : [],
  });
});

router.post("/my/ships/navigate/submit", async (req, res) => {
  console.log("==> Request:");
  console.dir(req.body, { depth: 2 });
  const { shipSymbol, waypointSymbol } = req.body;
  console.log(`==> Ship Symbol: ${shipSymbol}`);
  console.log(`==> Waypoint Symbol: ${waypointSymbol}`);
  const response = await fleetApi.navigateShip(shipSymbol, { waypointSymbol });
  res.render("response", { data: response.data });
});

const shipPurchaseOptions = Object.values(ShipType).map((value) => ({
  value,
  label: value.replace(/^SHIP_/, "").replace(/_/g, " "),
}));

// GET ship purchase form
router.get("/my/ships/purchase", cors(corsOptions), async (req, res) => {
  res.render("shipPurchaseForm", { shipPurchaseOptions });
});

// POST to purchase a new ship from specific waypoint
router.post("/my/ships/purchaseship", async (req, res) => {
  const { waypointSymbol, shipType } = req.body;
  const shipTypeKey = Object.keys(ShipType).find(
    (key) => ShipType[key] === shipType.toUpperCase()
  );
  const properShipType = shipTypeKey ? ShipType[shipTypeKey] : undefined;
  const purchaseRequest = {
    shipType: properShipType,
    waypointSymbol: waypointSymbol,
  };
  const response = await fleetApi.purchaseShip(purchaseRequest);
  res.render("response", { data: response.data });
});

export default router;
