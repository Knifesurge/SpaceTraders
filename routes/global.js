import express from "express";
import cors from "cors";
import fs from "node:fs/promises";
import path from "node:path";

import { Configuration, FactionsApi, GlobalApi } from "spacetraders-sdk";

import config from "../data/config.js";
import { asyncHandler, sendSuccess } from "./http.js";
import { loadPersistentCache } from "./persistent-cache-store.js";
import { invalidateMyShipsCache } from "./ship-cache.js";
import { invalidateFleetCaches } from "./fleet.js";
import { getTransactionLog } from "./transaction-log.js";

const publicConfig = new Configuration({
  basePath: config.basePath,
});

const accountConfig = new Configuration({
  basePath: config.basePath,
  accessToken: () => process.env.ACCOUNT_TOKEN || "",
});

const globalApi = new GlobalApi(publicConfig);
const registerApi = new GlobalApi(accountConfig);
const factionsApi = new FactionsApi(publicConfig);

const router = express.Router();
const corsOptions = {
  origin: "https://api.spacetraders.io/",
  methods: ["GET", "POST", "PATCH", "OPTIONS"],
};

const MAIN_FACTION_SYMBOLS = new Set([
  "COSMIC",
  "VOID",
  "GALACTIC",
  "QUANTUM",
  "DOMINION",
  "ASTRO",
  "CORSAIRS",
]);

const INDEPENDENT_FACTION_SYMBOLS = new Set([
  "OBSIDIAN",
  "AEGIS",
  "UNITED",
  "SOLITARY",
  "COBALT",
  "OMEGA",
  "ECHO",
]);

const STRANGE_FACTION_SYMBOLS = new Set([
  "LORDS",
  "CULT",
  "ANCIENTS",
  "SHADOW",
  "ETHEREAL",
]);

const REGISTRATION_FACTION_PAGE_SIZE = 20;

const getAllFactions = async () => {
  const factions = [];
  let page = 1;

  while (true) {
    const response = await factionsApi.getFactions(page, REGISTRATION_FACTION_PAGE_SIZE);
    const data = response.data?.data || [];
    factions.push(...data);

    if (data.length < REGISTRATION_FACTION_PAGE_SIZE) {
      break;
    }

    page += 1;
  }

  return factions;
};

const mapFaction = (faction) => ({
  symbol: faction.symbol,
  name: faction.name,
  description: faction.description,
  headquarters: faction.headquarters || "Unknown",
  isRecruiting: Boolean(faction.isRecruiting),
  traits: (faction.traits || []).map((trait) => trait.name),
});

const categorizeFactions = (factions) => {
  const mainFactions = [];
  const independentFactions = [];
  const strangeFactions = [];

  for (const faction of factions) {
    if (MAIN_FACTION_SYMBOLS.has(faction.symbol)) {
      mainFactions.push(faction);
      continue;
    }
    if (INDEPENDENT_FACTION_SYMBOLS.has(faction.symbol)) {
      independentFactions.push(faction);
      continue;
    }
    if (STRANGE_FACTION_SYMBOLS.has(faction.symbol)) {
      strangeFactions.push(faction);
      continue;
    }

    mainFactions.push(faction);
  }

  const sortByName = (a, b) => a.name.localeCompare(b.name);
  mainFactions.sort(sortByName);
  independentFactions.sort(sortByName);
  strangeFactions.sort(sortByName);

  return { mainFactions, independentFactions, strangeFactions };
};

const persistAgentToken = async (token) => {
  const envPath = path.resolve(process.cwd(), "data/.env");
  let envText = "";

  try {
    envText = await fs.readFile(envPath, "utf8");
  } catch (error) {
    if (error?.code !== "ENOENT") {
      throw error;
    }
  }

  const cleanToken = String(token || "").trim();
  if (!cleanToken) {
    return;
  }

  if (/^AGENT_TOKEN=.*$/m.test(envText)) {
    envText = envText.replace(/^AGENT_TOKEN=.*$/m, `AGENT_TOKEN=${cleanToken}`);
  } else {
    const needsNewline = envText.length > 0 && !envText.endsWith("\n");
    envText = `${envText}${needsNewline ? "\n" : ""}AGENT_TOKEN=${cleanToken}\n`;
  }

  await fs.writeFile(envPath, envText, "utf8");
};

const hasAccountToken = () => Boolean(String(process.env.ACCOUNT_TOKEN || "").trim());

const renderRegisterView = async (req, res, options = {}) => {
  const factions = (await getAllFactions()).map(mapFaction);
  const grouped = categorizeFactions(factions);

  sendSuccess(req, res, {
    view: "globalRegister",
    locals: {
      title: "Register Agent",
      ...grouped,
      selectedFaction: options.selectedFaction || "",
      formSymbol: options.formSymbol || "",
      formEmail: options.formEmail || "",
      hasAccountToken: hasAccountToken(),
    },
  });
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

router.get("/cache-debug/view", cors(corsOptions), asyncHandler(async (req, res) => {
  const marketCache = loadPersistentCache("market-cache.json", []);
  const visitedWaypoints = loadPersistentCache("visited-waypoints.json", {});
  const shipMetadata = loadPersistentCache("ship-metadata-cache.json", []);

  const visitedAgentEntries = Object.entries(
    visitedWaypoints && typeof visitedWaypoints === "object" ? visitedWaypoints : {}
  );
  const visitedWaypointCount = visitedAgentEntries.reduce(
    (sum, [, entries]) => sum + (Array.isArray(entries) ? entries.length : 0),
    0,
  );

  sendSuccess(req, res, {
    view: "cacheDebug",
    locals: {
      title: "Cache Debug",
      cacheSummary: {
        marketEntries: Array.isArray(marketCache) ? marketCache.length : 0,
        visitedAgents: visitedAgentEntries.length,
        visitedWaypoints: visitedWaypointCount,
        shipMetadataEntries: Array.isArray(shipMetadata) ? shipMetadata.length : 0,
      },
      cacheData: {
        marketCache,
        visitedWaypoints,
        shipMetadata,
      },
    },
  });
}));

router.get("/transactions/view", cors(corsOptions), asyncHandler(async (req, res) => {
  const transactions = getTransactionLog();

  const summary = transactions.reduce((acc, entry) => {
    const delta = Number(entry?.creditsDelta || 0);
    if (delta < 0) {
      acc.totalSpent += Math.abs(delta);
      acc.spentCount += 1;
    } else if (delta > 0) {
      acc.totalEarned += delta;
      acc.earnedCount += 1;
    }
    return acc;
  }, {
    totalSpent: 0,
    totalEarned: 0,
    spentCount: 0,
    earnedCount: 0,
  });

  sendSuccess(req, res, {
    view: "globalTransactions",
    locals: {
      title: "Transaction Log",
      transactions,
      transactionSummary: summary,
    },
  });
}));

router.get("/register/view", cors(corsOptions), asyncHandler(async (req, res) => {
  await renderRegisterView(req, res);
}));

router.post("/register/view", cors(corsOptions), asyncHandler(async (req, res) => {
  const symbol = String(req.body.symbol || "").trim().toUpperCase();
  const faction = String(req.body.faction || "").trim().toUpperCase();
  const email = String(req.body.email || "").trim();

  const registerPayload = {
    symbol,
    faction,
  };
  if (email) {
    registerPayload.email = email;
  }

  const response = await registerApi.register(registerPayload);
  const token = response.data?.data?.token;

  if (token) {
    process.env.AGENT_TOKEN = token;
    await persistAgentToken(token);
  }

  invalidateMyShipsCache();
  invalidateFleetCaches();

  req.session.responseData = {
    registeredAgent: response.data?.data?.agent?.symbol || symbol,
    registeredFaction: response.data?.data?.faction?.symbol || faction,
  };

  res.redirect("/fleet/my/ships");
}));

// POST register a new agent
router.post("/register", cors(corsOptions), asyncHandler(async (req, res) => {
  const response = await registerApi.register(req.body);
  const token = response.data?.data?.token;

  if (token) {
    process.env.AGENT_TOKEN = token;
    await persistAgentToken(token);
  }

  invalidateMyShipsCache();
  invalidateFleetCaches();

  sendSuccess(req, res, { data: response.data });
}));

export default router;
