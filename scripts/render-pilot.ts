import { spawn } from "node:child_process";
import { renderPilotConfig } from "../lib/render-pilot";

const command = process.argv[2];
if (command !== "build" && command !== "start") throw new Error("Use build or start.");
const { revision, port } = renderPilotConfig(process.env);
const args = command === "build" ? ["build"] : ["start", "--hostname", "0.0.0.0", "--port", String(port)];
const child = spawn(process.execPath, ["node_modules/next/dist/bin/next", ...args], {
  env: { ...process.env, NEXUS_BUILD_REVISION: revision },
  stdio: "inherit",
});
for (const signal of ["SIGINT", "SIGTERM"] as const) {
  process.once(signal, () => child.kill(signal));
}
child.once("error", () => { process.exitCode = 1; });
child.once("exit", (code, signal) => {
  process.exitCode = code ?? (signal === "SIGTERM" ? 143 : signal === "SIGINT" ? 130 : 1);
});
