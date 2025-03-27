import { AgentsApi, Configuration } from "spacetraders-sdk";

import express from "express";
import cors from "cors";

const app = express();
const corsOptions = {
  origin: "https://api.spacetraders.io/",
  methods: ["GET", "POST", "PATCH", "OPTIONS"],
};
app.use(cors(corsOptions));

const agentToken = process.env.AGENT_TOKEN;
const config = new Configuration({
  basePath: "https://api.spacetraders.io/v2",
  accessToken: agentToken,
});

const agentsApi = new AgentsApi(config);
console.log(`Agent Token: ${agentToken}`);

agentsApi
  .getMyAgent()
  .then((response) => {
    console.log(response.data);
  })
  .catch((error) => {
    console.error(error);
  });
