import express from "express";
import cors from "cors";
import { AgentsApi, Configuration } from "spacetraders-sdk";
import config from "../data/config.js";
import { asyncHandler, sendSuccess } from "./http.js";

const router = express.Router();
const corsOptions = {
  origin: "https://api.spacetraders.io/",
  methods: ["GET", "POST", "PATCH", "OPTIONS"],
};

const agentToken = process.env.AGENT_TOKEN;
const agentsApi = new AgentsApi(config);

router.get("/", cors(corsOptions), asyncHandler(async (req, res) => {
  const page = req.query.page ? Number(req.query.page) : undefined;
  const limit = req.query.limit ? Number(req.query.limit) : undefined;
  const response = await agentsApi.getAgents(page, limit);
  sendSuccess(req, res, { data: response.data });
}));

router.get("/my/agent", cors(corsOptions), asyncHandler(async (req, res) => {
  const response = await agentsApi.getMyAgent();
  sendSuccess(req, res, { data: response.data });
}));

router.get("/:agentSymbol", cors(corsOptions), asyncHandler(async (req, res) => {
  const response = await agentsApi.getAgent(req.params.agentSymbol);
  sendSuccess(req, res, { data: response.data });
}));

export default router;
