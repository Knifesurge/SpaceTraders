import axios from "axios";
import express from "express";
import cors from "cors";
import AgentRouter from "./routes/agent.js";
import ContractRouter from "./routes/contract.js";

const app = express();

const corsOptions = {
  origin: "https://api.spacetraders.io/",
  methods: ["GET", "POST", "PATCH", "OPTIONS"],
};

app.use(cors(corsOptions));

app.use("/agent", AgentRouter);

app.use("/contracts", ContractRouter);

app.listen(3000, () => {
  console.log("Server is running on port 3000");
});
