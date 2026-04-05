import express from "express";
import cors from "cors";

import { DataApi } from "spacetraders-sdk";

import config from "../data/config.js";
import { asyncHandler, sendSuccess } from "./http.js";

const dataApi = new DataApi(config);

const router = express.Router();
const corsOptions = {
  origin: "https://api.spacetraders.io/",
  methods: ["GET", "POST", "PATCH", "OPTIONS"],
};

// GET supply chain data
router.get("/supply-chain", cors(corsOptions), asyncHandler(async (req, res) => {
  const response = await dataApi.getSupplyChain();
  sendSuccess(req, res, { data: response.data });
}));

export default router;
