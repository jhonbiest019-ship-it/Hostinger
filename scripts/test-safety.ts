export function assertSafeTestDatabase() {
  if (process.env.EMAIL_TEST_MODE !== "true") throw new Error("Safe test aborted: EMAIL_TEST_MODE must be true.");
  const rawUrl = process.env.DATABASE_URL;
  if (!rawUrl) throw new Error("Safe test aborted: DATABASE_URL is missing.");
  let url: URL;
  try { url = new URL(rawUrl); } catch { throw new Error("Safe test aborted: DATABASE_URL is invalid."); }
  const host = url.hostname.toLowerCase();
  const database = url.pathname.replace(/^\//, "");
  if (!(["localhost", "127.0.0.1"].includes(host) && url.port === "3307" && database === "shotinger_test")) throw new Error("Safe test aborted: DATABASE_URL must target localhost:3307/shotinger_test.");
}
