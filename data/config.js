import { Configuration } from "spacetraders-sdk";

const config = new Configuration({
  basePath: "https://api.spacetraders.io/v2",
  accessToken: process.env.AGENT_TOKEN,
});

export default config;
