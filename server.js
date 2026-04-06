import axios from "axios";
import express from "express";
import cors from "cors";
import session from "express-session";
import { AgentsApi, FleetApi } from "spacetraders-sdk";
import AgentRouter from "./routes/agent.js";
import ContractRouter from "./routes/contract.js";
import SystemsRouter from "./routes/system.js";
import FleetRouter from "./routes/fleet.js";
import FactionRouter from "./routes/faction.js";
import GlobalRouter from "./routes/global.js";
import DataRouter from "./routes/data.js";
import { apiErrorHandler } from "./routes/http.js";
import config from "./data/config.js";
import { getAllMyShipsCached } from "./routes/ship-cache.js";
import { appendTransactionLogEntry } from "./routes/transaction-log.js";
import dotenv from "dotenv";

dotenv.config({ path: "./data/.env" });

const app = express();
const RESET_WARNING_WINDOW_MS = 12 * 60 * 60 * 1000;

const agentsApi = new AgentsApi(config);
const fleetApi = new FleetApi(config);

let globalStatusCache = {
  cachedAt: 0,
  data: null,
};

let navStatsCache = {
  cachedAt: 0,
  token: "",
  data: null,
};

const invalidateNavStatsCache = () => {
  navStatsCache = {
    cachedAt: 0,
    token: "",
    data: null,
  };
};

const isMutationRequest = (method) => ["POST", "PATCH", "PUT", "DELETE"].includes(method);

const isCreditAffectingMutation = (req) => {
  if (!isMutationRequest(req.method)) {
    return false;
  }

  const path = String(req.path || "").toLowerCase();
  const creditPatterns = [
    /^\/contracts\/[^/]+\/accept$/,
    /^\/contracts\/[^/]+\/accept(?:\/view)?$/,
    /^\/contracts\/[^/]+\/deliver$/,
    /^\/contracts\/[^/]+\/fulfill$/,
    /^\/fleet\/my\/ships\/purchaseship$/,
    /^\/fleet\/my\/ships\/purchase$/,
    /^\/fleet\/my\/ships\/[^/]+\/cargo\/purchase$/,
    /^\/fleet\/my\/ships\/[^/]+\/cargo\/sell$/,
    /^\/systems\/[^/]+\/waypoints\/[^/]+\/market\/sell$/,
    /^\/fleet\/my\/ships\/[^/]+\/refuel$/,
    /^\/fleet\/my\/ships\/[^/]+\/mounts\/install$/,
    /^\/fleet\/my\/ships\/[^/]+\/mounts\/remove$/,
    /^\/fleet\/my\/ships\/[^/]+\/modules\/install$/,
    /^\/fleet\/my\/ships\/[^/]+\/modules\/remove$/,
    /^\/fleet\/my\/ships\/[^/]+\/repair$/,
    /^\/fleet\/my\/ships\/[^/]+\/scrap$/,
  ];

  return creditPatterns.some((pattern) => pattern.test(path));
};

const isFleetOverviewRequest = (req) => {
  if (req.method !== "GET") {
    return false;
  }

  const path = String(req.path || "").toLowerCase();
  return /^\/fleet\/my\/ships\/?$/.test(path);
};

const extractSymbolFromPath = (path, anchor) => {
  const pattern = new RegExp(`${anchor}\\/([^/?#]+)`, "i");
  const match = String(path || "").match(pattern);
  return match ? String(match[1] || "").trim().toUpperCase() : "";
};

const classifyTransactionAction = (path) => {
  const loweredPath = String(path || "").toLowerCase();
  const actionMatchers = [
    [/\/purchase(?:ship)?$/, "SHIP_PURCHASE"],
    [/\/cargo\/purchase$/, "CARGO_PURCHASE"],
    [/\/cargo\/sell$/, "CARGO_SELL"],
    [/\/market\/sell$/, "MARKET_SELL"],
    [/\/refuel$/, "SHIP_REFUEL"],
    [/\/mounts\/install$/, "MOUNT_INSTALL"],
    [/\/mounts\/remove$/, "MOUNT_REMOVE"],
    [/\/modules\/install$/, "MODULE_INSTALL"],
    [/\/modules\/remove$/, "MODULE_REMOVE"],
    [/\/repair$/, "SHIP_REPAIR"],
    [/\/scrap$/, "SHIP_SCRAP"],
    [/\/accept(?:\/view)?$/, "CONTRACT_ACCEPT"],
    [/\/deliver$/, "CONTRACT_DELIVER"],
    [/\/fulfill$/, "CONTRACT_FULFILL"],
  ];

  for (const [pattern, action] of actionMatchers) {
    if (pattern.test(loweredPath)) {
      return action;
    }
  }

  return "CREDIT_MUTATION";
};

const buildJsonToggleHref = (req) => {
  const query = new URLSearchParams();
  const sourceQuery = req.query || {};

  for (const [key, value] of Object.entries(sourceQuery)) {
    if (String(key).toLowerCase() === "json") {
      continue;
    }

    if (Array.isArray(value)) {
      for (const item of value) {
        query.append(key, String(item));
      }
      continue;
    }

    if (value !== undefined && value !== null) {
      query.set(key, String(value));
    }
  }

  const requestPath = String(req.path || "");
  const apiPath = requestPath.endsWith("/view")
    ? requestPath.slice(0, -5) || "/"
    : requestPath;

  query.set("json", "1");
  const queryString = query.toString();
  return queryString ? `${apiPath}?${queryString}` : apiPath;
};

const decodeJwtPayload = (token) => {
  if (!token || typeof token !== "string") return null;

  const parts = token.split(".");
  if (parts.length < 2) return null;

  try {
    const payload = parts[1]
      .replace(/-/g, "+")
      .replace(/_/g, "/")
      .padEnd(Math.ceil(parts[1].length / 4) * 4, "=");
    const decoded = Buffer.from(payload, "base64").toString("utf8");
    return JSON.parse(decoded);
  } catch {
    return null;
  }
};

const getCachedGlobalStatus = async () => {
  if (globalStatusCache.data) {
    return globalStatusCache.data;
  }

  const response = await axios.get("https://api.spacetraders.io/v2");
  globalStatusCache = {
    cachedAt: Date.now(),
    data: response.data,
  };

  return response.data;
};

const formatDuration = (ms) => {
  const totalSeconds = Math.max(Math.floor(ms / 1000), 0);
  const hours = Math.floor(totalSeconds / 3600);
  const minutes = Math.floor((totalSeconds % 3600) / 60);
  return `${String(hours).padStart(2, "0")}h ${String(minutes).padStart(2, "0")}m`;
};

const buildGlobalBanner = async () => {
  const status = await getCachedGlobalStatus();
  const serverResetDate = String(status?.resetDate || "").trim();
  const nextResetRaw = String(status?.serverResets?.next || "").trim();

  const token = String(process.env.AGENT_TOKEN || "").trim();
  const tokenPayload = decodeJwtPayload(token);
  const tokenResetDate = String(tokenPayload?.reset_date || "").trim();

  const missingToken = !token;
  const mismatchedReset = Boolean(serverResetDate && tokenResetDate && tokenResetDate !== serverResetDate);
  const missingTokenResetDate = Boolean(token && !tokenResetDate && serverResetDate);
  const needsRegistration = missingToken || mismatchedReset || missingTokenResetDate;

  if (needsRegistration) {
    return {
      level: "danger",
      message: "Server reset detected for your agent token. Register a new agent for this reset cycle.",
      ctaLabel: "Register Agent",
      ctaHref: "/global/register/view",
    };
  }

  const nextResetMs = Date.parse(nextResetRaw);
  if (!Number.isNaN(nextResetMs)) {
    const remaining = nextResetMs - Date.now();
    if (remaining > 0 && remaining <= RESET_WARNING_WINDOW_MS) {
      return {
        level: "warning",
        message: `Server reset in ${formatDuration(remaining)} (${new Date(nextResetMs).toLocaleString()}).`,
        ctaLabel: "View Status",
        ctaHref: "/global/status/view",
      };
    }
  }

  return null;
};

const getCachedNavStats = async (options = {}) => {
  const { forceRefresh = false } = options;
  const token = String(process.env.AGENT_TOKEN || "").trim();
  if (!token) {
    invalidateNavStatsCache();
    return null;
  }

  if (!forceRefresh && navStatsCache.data && navStatsCache.token === token) {
    return navStatsCache.data;
  }

  const [agentResponse, myShips] = await Promise.all([
    agentsApi.getMyAgent(),
    getAllMyShipsCached(fleetApi, { forceRefresh }),
  ]);

  const stats = {
    shipCount: (myShips || []).length,
    credits: Number(agentResponse.data?.data?.credits || 0),
  };

  navStatsCache = {
    cachedAt: Date.now(),
    token,
    data: stats,
  };

  return stats;
};

app.use(express.json());
app.use(express.urlencoded({ extended: true }));
app.use(
  session({
    secret: process.env.SESSION_SECRET || "fallbacksecret",
    resave: false,
    saveUninitialized: true,
    cookie: { secure: false },
  }),
);
const corsOptions = {
  origin: "https://api.spacetraders.io/",
  methods: ["GET", "POST", "PATCH", "OPTIONS"],
};

app.use(cors(corsOptions));
app.set("view engine", "pug");
app.set("views", "./views");

app.use(async (req, res, next) => {
  const forceRefreshNavStats = isFleetOverviewRequest(req);
  res.locals.jsonToggleHref = buildJsonToggleHref(req);
  res.locals.appToast = req.session.appToast || null;
  delete req.session.appToast;

  if (isCreditAffectingMutation(req)) {
    invalidateNavStatsCache();
  }

  try {
    res.locals.globalBanner = await buildGlobalBanner();
  } catch (error) {
    res.locals.globalBanner = null;
  }

  try {
    res.locals.navStats = await getCachedNavStats({ forceRefresh: forceRefreshNavStats });
  } catch (error) {
    res.locals.navStats = null;
  }

  next();
});

app.use(async (req, res, next) => {
  if (!isCreditAffectingMutation(req)) {
    next();
    return;
  }

  const token = String(process.env.AGENT_TOKEN || "").trim();
  if (!token) {
    next();
    return;
  }

  let creditsBefore = null;
  try {
    const beforeResponse = await agentsApi.getMyAgent();
    creditsBefore = Number(beforeResponse.data?.data?.credits);
  } catch {
    creditsBefore = null;
  }

  res.on("finish", () => {
    if (res.statusCode >= 400 || !Number.isFinite(creditsBefore)) {
      return;
    }

    const endpointPath = String(req.path || "");
    const action = classifyTransactionAction(endpointPath);
    const shipSymbol = extractSymbolFromPath(endpointPath, "ships");
    const contractId = extractSymbolFromPath(endpointPath, "contracts");
    const waypointFromPath = extractSymbolFromPath(endpointPath, "waypoints");
    const waypointFromBody = String(req.body?.waypointSymbol || "").trim().toUpperCase();
    const tradeSymbol = String(req.body?.symbol || req.body?.tradeSymbol || "").trim().toUpperCase();
    const units = Number(req.body?.units);

    void (async () => {
      try {
        const afterResponse = await agentsApi.getMyAgent();
        const creditsAfter = Number(afterResponse.data?.data?.credits);
        if (!Number.isFinite(creditsAfter)) {
          return;
        }

        const creditsDelta = Math.trunc(creditsAfter - creditsBefore);
        if (creditsDelta === 0) {
          return;
        }

        appendTransactionLogEntry({
          action,
          endpoint: endpointPath,
          method: req.method,
          shipSymbol,
          waypointSymbol: waypointFromBody || waypointFromPath,
          creditsBefore,
          creditsAfter,
          details: {
            contractId,
            tradeSymbol,
            units: Number.isFinite(units) ? units : undefined,
            requestId: String(req.headers["x-request-id"] || "").trim() || undefined,
          },
        });
      } catch {
        // Transaction logging is best-effort and should not affect route behavior.
      }
    })();
  });

  next();
});

app.use("/agent", AgentRouter);
app.use("/contracts", ContractRouter);
app.use("/systems", SystemsRouter);
app.use("/fleet", FleetRouter);
app.use("/factions", FactionRouter);
app.use("/global", GlobalRouter);
app.use("/data", DataRouter);

app.get("/", (req, res) => {
  res.render("index", {
    title: "SpaceTraders API",
    message: "Welcome to the SpaceTraders API",
  });
});

app.use(apiErrorHandler);

app.listen(3000, () => {
  console.log("Server is running on port 3000");
});
