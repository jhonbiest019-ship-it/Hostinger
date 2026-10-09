let warnedAboutTestMode = false;

const requiredVariables = ["DATABASE_URL", "ENCRYPTION_KEY", "AUTH_SESSION_SECRET", "WORKER_TOKEN"] as const;

export function validateServerConfig() {
  // Next evaluates server components while building; runtime-only checks belong on requests.
  if (process.env.NEXT_PHASE === "phase-production-build") return;

  const missing = requiredVariables.filter((name) => !process.env[name]?.trim());
  if (missing.length) throw new Error(`Missing required server configuration: ${missing.join(", ")}`);

  if (process.env.EMAIL_TEST_MODE === "true") {
    if (process.env.NODE_ENV === "production") throw new Error("EMAIL_TEST_MODE=true is not allowed in production.");
    if (!warnedAboutTestMode) {
      console.warn("EMAIL_TEST_MODE=true is enabled. SMTP network delivery is disabled for this non-production process.");
      warnedAboutTestMode = true;
    }
  }
}
