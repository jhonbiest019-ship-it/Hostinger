import { loadEnvConfig } from "@next/env";
import { spawnSync } from "node:child_process";
loadEnvConfig(process.cwd());
for (const script of ["config-safety-test", "phase7-safe-test", "queue-safety-test", "imap-test-safety", "daily-use-safe-test"]) {
  const result = spawnSync(process.execPath, ["node_modules/tsx/dist/cli.mjs", `scripts/${script}.ts`], { env: process.env, stdio: "inherit" });
  if (result.status !== 0) process.exit(result.status ?? 1);
}
