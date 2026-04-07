import express from "express";
import cors from "cors";
import { AgentsApi } from "spacetraders-sdk";

import config from "../data/config.js";
import { asyncHandler, sendSuccess } from "./http.js";

const router = express.Router();
const agentsApi = new AgentsApi(config);

const corsOptions = {
  origin: "https://api.spacetraders.io/",
  methods: ["GET", "POST", "PATCH", "OPTIONS"],
};

const DEFAULT_PAGE_SIZE = 20;

const toPositiveInt = (value, fallback) => {
  const parsed = Number(value);
  if (!Number.isFinite(parsed) || parsed <= 0) {
    return fallback;
  }
  return Math.floor(parsed);
};

const getActiveAgentsSnapshot = async (pageSize) => {
  const collectedAgents = [];
  let pagesFetched = 0;
  let totalAvailable = null;
  let page = 1;

  while (true) {
    const response = await agentsApi.getAgents(page, pageSize);
    const pageAgents = response.data?.data || [];
    const meta = response.data?.meta || null;

    collectedAgents.push(...pageAgents);
    pagesFetched += 1;

    if (meta && Number.isFinite(Number(meta.total))) {
      totalAvailable = Number(meta.total);
    }

    if (pageAgents.length < pageSize) {
      break;
    }

    if (totalAvailable !== null && collectedAgents.length >= totalAvailable) {
      break;
    }

    page += 1;
  }

  const activeAgents = collectedAgents
    .filter((agent) => Number(agent?.shipCount || 0) > 0)
    .sort((left, right) => {
      const creditDelta = Number(right?.credits || 0) - Number(left?.credits || 0);
      if (creditDelta !== 0) {
        return creditDelta;
      }
      return String(left?.symbol || "").localeCompare(String(right?.symbol || ""));
    });

  return {
    activeAgents,
    pagesFetched,
    pageSize,
    totalFetched: collectedAgents.length,
    totalAvailable,
    activeCount: activeAgents.length,
  };
};

router.get("/", cors(corsOptions), asyncHandler(async (req, res) => {
  const pageSize = Math.min(toPositiveInt(req.query.limit, DEFAULT_PAGE_SIZE), 20);

  const [myAgentResponse, activeSnapshot] = await Promise.all([
    agentsApi.getMyAgent(),
    getActiveAgentsSnapshot(pageSize),
  ]);

  sendSuccess(req, res, {
    data: {
      myAgent: myAgentResponse.data?.data || null,
      activeAgents: activeSnapshot.activeAgents,
      snapshot: {
        pagesFetched: activeSnapshot.pagesFetched,
        pageSize: activeSnapshot.pageSize,
        totalFetched: activeSnapshot.totalFetched,
        totalAvailable: activeSnapshot.totalAvailable,
        activeCount: activeSnapshot.activeCount,
      },
      sdkCoverage: {
        hasGetMyAgent: true,
        hasGetAgents: true,
        hasGetMyAccount: false,
        note: "Live SpaceTraders OpenAPI spec currently omits /my/account, so AccountsApi is not generated.",
      },
    },
  });
}));

router.get("/view", cors(corsOptions), asyncHandler(async (req, res) => {
  const pageSize = Math.min(toPositiveInt(req.query.limit, DEFAULT_PAGE_SIZE), 20);

  const [myAgentResponse, activeSnapshot] = await Promise.all([
    agentsApi.getMyAgent(),
    getActiveAgentsSnapshot(pageSize),
  ]);

  sendSuccess(req, res, {
    view: "account",
    locals: {
      title: "Account",
      myAgent: myAgentResponse.data?.data || null,
      activeAgents: activeSnapshot.activeAgents,
      snapshot: {
        pagesFetched: activeSnapshot.pagesFetched,
        pageSize: activeSnapshot.pageSize,
        totalFetched: activeSnapshot.totalFetched,
        totalAvailable: activeSnapshot.totalAvailable,
        activeCount: activeSnapshot.activeCount,
      },
      sdkCoverage: {
        hasGetMyAgent: true,
        hasGetAgents: true,
        hasGetMyAccount: false,
      },
    },
  });
}));

export default router;
