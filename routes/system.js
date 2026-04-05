import express from "express";
import cors from "cors";

import { SystemsApi, WaypointTraitSymbol } from "spacetraders-sdk";
import config from "../data/config.js";
import { asyncHandler, sendSuccess } from "./http.js";

const systemsApi = new SystemsApi(config);

const router = express.Router();
const corsOptions = {
  origin: "https://api.spacetraders.io/",
  methods: ["GET", "POST", "PATCH", "OPTIONS"],
};

// GET all systems
router.get("/", cors(corsOptions), asyncHandler(async (req, res) => {
  const page = req.query.page ? Number(req.query.page) : undefined;
  const limit = req.query.limit ? Number(req.query.limit) : undefined;
  const response = await systemsApi.getSystems(page, limit);
  sendSuccess(req, res, { data: response.data });
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
