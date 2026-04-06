import express from "express";
import cors from "cors";

import { Configuration, FactionsApi } from "spacetraders-sdk";

import config from "../data/config.js";
import { asyncHandler, sendSuccess } from "./http.js";

const publicConfig = new Configuration({
  basePath: config.basePath,
});

const factionsApi = new FactionsApi(publicConfig);

const router = express.Router();
const corsOptions = {
  origin: "https://api.spacetraders.io/",
  methods: ["GET", "POST", "PATCH", "OPTIONS"],
};

// GET all factions
router.get("/", cors(corsOptions), asyncHandler(async (req, res) => {
  const page = req.query.page ? Number(req.query.page) : undefined;
  const limit = req.query.limit ? Number(req.query.limit) : undefined;
  const response = await factionsApi.getFactions(page, limit);
  sendSuccess(req, res, { data: response.data });
}));

// GET a specific faction
router.get("/:factionSymbol", cors(corsOptions), asyncHandler(async (req, res) => {
  const response = await factionsApi.getFaction(req.params.factionSymbol);
  sendSuccess(req, res, { data: response.data });
}));

export default router;
