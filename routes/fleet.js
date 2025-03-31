import express from "express";
import cors from "cors";

import { FleetApi } from "spacetraders-sdk";
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

export default router;
