import axios from "axios";
import express from "express";
import cors from "cors";
import session from "express-session";
import AgentRouter from "./routes/agent.js";
import ContractRouter from "./routes/contract.js";
import SystemsRouter from "./routes/system.js";
import FleetRouter from "./routes/fleet.js";

const app = express();
app.use(express.json());
app.use(express.urlencoded({ extended: true }));
app.use(
  session({
    secret: process.env.SESSION_SECRET,
    resave: false,
    saveUninitialized: true,
    cookie: { secure: false },
  })
);
const corsOptions = {
  origin: "https://api.spacetraders.io/",
  methods: ["GET", "POST", "PATCH", "OPTIONS"],
};

app.use(cors(corsOptions));
app.set("view engine", "pug");
app.set("views", "./views");

app.use("/agent", AgentRouter);
app.use("/contracts", ContractRouter);
app.use("/systems", SystemsRouter);
app.use("/fleet", FleetRouter);

app.get("/", (req, res) => {
  res.render("index", {
    title: "SpaceTraders API",
    message: "Welcome to the SpaceTraders API",
  });
});

app.listen(3000, () => {
  console.log("Server is running on port 3000");
});
