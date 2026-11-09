export async function register() {
  if (process.env.NEXT_RUNTIME !== "nodejs") return;
  const { validateServerConfig } = await import("./lib/config");
  validateServerConfig();
}
