import express from "express";
import cors from "cors";
import { AgentsApi, Configuration } from "spacetraders-sdk";
import config from "../data/config.js";

const router = express.Router();
const corsOptions = {
  origin: "https://api.spacetraders.io/",
  methods: ["GET", "POST", "PATCH", "OPTIONS"],
};

const agentToken = process.env.AGENT_TOKEN;
const agentsApi = new AgentsApi(config);

router.get("/my/agent", cors(corsOptions), async (req, res) => {
  const response = await agentsApi.getMyAgent();
  console.log(response.data);
  res.type("json").send(JSON.stringify(response.data, null, 2));
});

export default router;
