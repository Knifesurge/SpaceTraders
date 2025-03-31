import express from "express";
import cors from "cors";

import { SystemsApi, WaypointTraitSymbol } from "spacetraders-sdk";
import config from "../data/config.js";
import { getWaypointTrait } from "../utils/utils.js";

const systemsApi = new SystemsApi(config);

const router = express.Router();
const corsOptions = {
  origin: "https://api.spacetraders.io/",
  methods: ["GET", "POST", "PATCH", "OPTIONS"],
};

// GET all systems
router.get("/", cors(corsOptions), async (req, res) => {
  const response = await systemsApi.getSystems();
  console.log(response.data);
  res.type("json").send(JSON.stringify(response.data, null, 2));
});

// GET specific system by ID
router.get("/:systemId", cors(corsOptions), async (req, res) => {
  const response = await systemsApi.getSystem(req.params.systemId);
  console.log(response.data);
  res.type("json").send(JSON.stringify(response.data, null, 2));
});

// GET all waypoints in a specific system
router.get("/:systemId/waypoints", cors(corsOptions), async (req, res) => {
  // Capture the possible query parameters
  const { page, limit, type, traits } = req.query;
  // Perform a reverse lookup on WaypointTraitSymbol
  const traitKey = Object.keys(WaypointTraitSymbol).find(
    (key) => WaypointTraitSymbol[key] === traits.toUpperCase()
  );
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
  console.log(JSON.stringify(response.data, null, 2));
  res.type("json").send(JSON.stringify(response.data, null, 2));
});

// GET specific waypoint by ID in a specific system
router.get(
  "/:systemId/waypoints/:waypointId",
  cors(corsOptions),
  async (req, res) => {
    const response = await systemsApi.getWaypoint(
      req.params.systemId,
      req.params.waypointId
    );
    console.log(response.data);
    res.type("json").send(JSON.stringify(response.data, null, 2));
  }
);

// GET shipyard information for a specific waypoint in a specific system
router.get(
  "/:systemId/waypoints/:waypointId/shipyard",
  cors(corsOptions),
  async (req, res) => {
    const response = await systemsApi.getShipyard(
      req.params.systemId,
      req.params.waypointId
    );
    console.log(response.data);
    res.type("json").send(JSON.stringify(response.data, null, 2));
  }
);
export default router;
