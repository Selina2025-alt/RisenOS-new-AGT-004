import { startTelemetry } from "./telemetry.js";

const telemetry = await startTelemetry("agt-rsn-004-worker");
const { startWorker } = await import("./worker-main.js");
await startWorker(telemetry);
