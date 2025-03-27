import express from "express";
import cors from "cors";

import { ContractsApi } from "spacetraders-sdk";

import config from "../data/config.js";

const router = express.Router();
const corsOptions = {
  origin: "https://api.spacetraders.io/",
  methods: ["GET", "POST", "PATCH", "OPTIONS"],
};

router.get("/", cors(corsOptions), async (req, res) => {
  const contractsApi = new ContractsApi(config);
  const response = await contractsApi.getContracts();
  console.log(response.data);
  res.type("json").send(JSON.stringify(response.data, null, 2));
});

export default router;
