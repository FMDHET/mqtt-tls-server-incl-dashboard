import "dotenv/config";
import cors from "cors";
import express from "express";
import http from "http";
import { ensureAdmin, ensureMqttIngestCredential } from "./auth.js";
import { migrate } from "./db.js";
import { startMqttIngestion, attachLiveServer } from "./mqtt.js";
import { router } from "./routes.js";

const app = express();
app.use(cors());
app.use(express.json({ limit: "1mb" }));
app.use("/api", router);

const server = http.createServer(app);
attachLiveServer(server);

const port = Number(process.env.PORT || 3000);

await migrate();
await ensureAdmin();
await ensureMqttIngestCredential();
startMqttIngestion();

server.listen(port, () => {
  console.log(`API listening on ${port}`);
});
