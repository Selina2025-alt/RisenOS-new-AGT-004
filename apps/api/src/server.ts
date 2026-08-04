import { startTelemetry } from "./telemetry.js";

const telemetry = await startTelemetry("agt-rsn-004-api");
const { buildApp } = await import("./app.js");
const { createDependencies } = await import("./dependencies.js");
const port = Number.parseInt(process.env.API_PORT ?? "4004", 10);
const host = process.env.API_HOST ?? "0.0.0.0";
const container = await createDependencies();
const app = await buildApp(container);

await app.listen({ port, host });

const shutdown = async () => {
  await app.close();
  await telemetry?.shutdown();
};
process.on("SIGINT", shutdown);
process.on("SIGTERM", shutdown);
