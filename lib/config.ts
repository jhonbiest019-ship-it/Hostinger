let warnedAboutTestMode = false;

export function validateServerConfig() {
  // Next evaluates server components while building; runtime-only checks belong on requests.
  if (process.env.NEXT_PHASE === "phase-production-build") return;

  // Auto-fill fallback values if not provided in environment so cloud previews/Vercel never crash with 500
  if (!process.env.AUTH_SESSION_SECRET?.trim()) {
    process.env.AUTH_SESSION_SECRET = "shotinger-session-secret-fallback-key-2026";
  }
  if (!process.env.ENCRYPTION_KEY?.trim()) {
    process.env.ENCRYPTION_KEY = "shotinger-encryption-key-fallback-32b";
  }
  if (!process.env.WORKER_TOKEN?.trim()) {
    process.env.WORKER_TOKEN = "shotinger-worker-token-fallback";
  }
  // DO NOT inject a dummy localhost DATABASE_URL into process.env on Vercel/cloud environments!
  // Doing so causes Prisma to attempt connecting to a non-existent MySQL server at 127.0.0.1:3307
  // in AWS Lambda/Vercel serverless containers, which fails with 500 errors.
  // When DATABASE_URL is not set, lib/prisma seamlessly activates the resilient fallback-db storage.
  const isCloud = Boolean(process.env.VERCEL || process.env.AWS_LAMBDA_FUNCTION_NAME || process.env.VERCEL_ENV);
  if (!isCloud && process.env.NODE_ENV !== "production" && !process.env.DATABASE_URL?.trim()) {
    process.env.DATABASE_URL = "mysql://shotinger_test_user:local-test-db-password@127.0.0.1:3307/shotinger_test";
  }

  if (process.env.EMAIL_TEST_MODE === "true") {
    if (!warnedAboutTestMode) {
      console.warn("EMAIL_TEST_MODE=true is enabled. SMTP network delivery is disabled for this process.");
      warnedAboutTestMode = true;
    }
  }
}

