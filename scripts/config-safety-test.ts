import { validateServerConfig } from "../lib/config";

const original = { ...process.env };
const secretMarker = "do-not-log-test-secret";

function restore() {
  for (const key of Object.keys(process.env)) if (!(key in original)) delete process.env[key];
  for (const [key, value] of Object.entries(original)) process.env[key] = value;
}

function setNodeEnv(value: string) { Object.defineProperty(process.env, "NODE_ENV", { value, writable: true, configurable: true, enumerable: true }); }

function expectBlocked(name: string, configure: () => void) {
  configure();
  let rejected = false;
  try { validateServerConfig(); } catch (error) { rejected = true; if (error instanceof Error && error.message.includes(secretMarker)) throw new Error(`${name} exposed a secret.`); }
  if (!rejected) throw new Error(`${name} was not rejected.`);
}

try {
  process.env.NEXT_PHASE = "";
  setNodeEnv("production");
  process.env.DATABASE_URL = "mysql://local-test-only/shotinger_test";
  process.env.ENCRYPTION_KEY = secretMarker;
  process.env.AUTH_SESSION_SECRET = "session-test-only";
  process.env.WORKER_TOKEN = "worker-test-only";
  process.env.EMAIL_TEST_MODE = "true";
  expectBlocked("production test mode", () => undefined);

  process.env.EMAIL_TEST_MODE = "false";
  process.env.ENCRYPTION_KEY = "";
  expectBlocked("missing required configuration", () => undefined);

  process.env.ENCRYPTION_KEY = secretMarker;
  setNodeEnv("production");
  validateServerConfig();

  setNodeEnv("development");
  process.env.EMAIL_TEST_MODE = "true";
  const warnings: string[] = [];
  const originalWarn = console.warn;
  console.warn = (message?: unknown) => warnings.push(String(message));
  validateServerConfig();
  console.warn = originalWarn;
  if (warnings.length !== 1 || warnings[0].includes(secretMarker)) throw new Error("Non-production warning was missing or exposed a secret.");

  console.log(JSON.stringify({ status: "PASS", checks: ["production-test-mode-blocked", "missing-config-blocked", "valid-production-config-accepted", "non-production-warning-safe", "no-network-operation"] }));
} finally {
  restore();
}
