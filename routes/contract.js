import express from "express";
import cors from "cors";

import { ContractsApi } from "spacetraders-sdk";

import config from "../data/config.js";
import { asyncHandler, sendSuccess } from "./http.js";

const contractsApi = new ContractsApi(config);

const router = express.Router();
const corsOptions = {
  origin: "https://api.spacetraders.io/",
  methods: ["GET", "POST", "PATCH", "OPTIONS"],
};

router.get("/", cors(corsOptions), asyncHandler(async (req, res) => {
  const page = req.query.page ? Number(req.query.page) : undefined;
  const limit = req.query.limit ? Number(req.query.limit) : undefined;
  const response = await contractsApi.getContracts(page, limit);
  sendSuccess(req, res, { data: response.data });
}));

router.get("/view", cors(corsOptions), asyncHandler(async (req, res) => {
  const page = req.query.page ? Number(req.query.page) : undefined;
  const limit = req.query.limit ? Number(req.query.limit) : undefined;
  const response = await contractsApi.getContracts(page, limit);
  sendSuccess(req, res, {
    view: "contracts",
    locals: {
      title: "Contracts",
      data: response.data.data || [],
    },
  });
}));

router.get("/:contractId", cors(corsOptions), asyncHandler(async (req, res) => {
  const response = await contractsApi.getContract(req.params.contractId);
  sendSuccess(req, res, { data: response.data });
}));

router.get("/:contractId/view", cors(corsOptions), asyncHandler(async (req, res) => {
  const response = await contractsApi.getContract(req.params.contractId);
  sendSuccess(req, res, {
    view: "contractDetail",
    locals: {
      title: "Contract Detail",
      data: response.data.data,
    },
  });
}));

router.post("/:contractId/accept", cors(corsOptions), asyncHandler(async (req, res) => {
  const response = await contractsApi.acceptContract(req.params.contractId);
  sendSuccess(req, res, { data: response.data });
}));

router.post("/:contractId/deliver", cors(corsOptions), asyncHandler(async (req, res) => {
  const response = await contractsApi.deliverContract(req.params.contractId, req.body);
  sendSuccess(req, res, { data: response.data });
}));

router.post("/:contractId/fulfill", cors(corsOptions), asyncHandler(async (req, res) => {
  const response = await contractsApi.fulfillContract(req.params.contractId);
  sendSuccess(req, res, { data: response.data });
}));

export default router;
