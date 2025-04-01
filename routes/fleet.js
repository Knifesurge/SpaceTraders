import express from "express";
import cors from "cors";

import { FleetApi, ShipType } from "spacetraders-sdk";
import config from "../data/config.js";

const router = express.Router();
const fleetApi = new FleetApi(config);
const corsOptions = {
  origin: "https://api.spacetraders.io/",
  methods: ["GET", "POST", "PATCH", "OPTIONS"],
};

// GET all owned ships
router.get("/my/ships", cors(corsOptions), async (req, res) => {
  const response = await fleetApi.getMyShips();
  console.log(response.data);
  res.type("json").send(JSON.stringify(response.data, null, 2));
});

router.get("/my/ships/navigate", cors(corsOptions), async (req, res) => {
  const myShipResponse = await fleetApi.getMyShips();
  const waypointResponse = await fetch("localhost:3000/systems/waypoints", {
    method: "GET",
    headers: {
      "Content-Type": "application/json",
    },
  });
  const shipSymbols = myShipResponse.data.map((ship) => ship.symbol);
  res.render("shipNavigationForm", { ships: shipSymbols });
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
  console.log(`==> ${req.body}`);
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
