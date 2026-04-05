import express from "express";
import cors from "cors";

import { GlobalApi } from "spacetraders-sdk";

import config from "../data/config.js";
import { asyncHandler, sendSuccess } from "./http.js";

const globalApi = new GlobalApi(config);

const router = express.Router();
const corsOptions = {
  origin: "https://api.spacetraders.io/",
  methods: ["GET", "POST", "PATCH", "OPTIONS"],
};

// GET game/server status payload from SpaceTraders
router.get("/status", cors(corsOptions), asyncHandler(async (req, res) => {
  const response = await globalApi.getStatus();
  sendSuccess(req, res, { data: response.data });
}));

router.get("/status/view", cors(corsOptions), asyncHandler(async (req, res) => {
  const response = await globalApi.getStatus();
  sendSuccess(req, res, {
    view: "globalStatus",
    locals: {
      title: "Global Status",
      data: response.data,
    },
  });
}));

// POST register a new agent
router.post("/register", cors(corsOptions), asyncHandler(async (req, res) => {
  const response = await globalApi.register(req.body);
  sendSuccess(req, res, { data: response.data });
}));

export default router;
