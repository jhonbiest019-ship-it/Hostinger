export function isTemporaryEmailFailure(error: unknown) {
  const candidate = error as { code?: string; responseCode?: number };
  if (["ETIMEDOUT", "ECONNECTION", "ESOCKET", "EAI_AGAIN", "ECONNRESET"].includes(candidate?.code ?? "")) return true;
  return typeof candidate?.responseCode === "number" && candidate.responseCode >= 400 && candidate.responseCode < 500;
}

export function isAmbiguousEmailFailure(error: unknown) {
  const candidate = error as { code?: string; command?: string; responseCode?: number };
  if (candidate?.responseCode) return false;
  const networkFailure = ["ETIMEDOUT", "ECONNECTION", "ESOCKET", "ECONNRESET"].includes(candidate?.code ?? "");
  return networkFailure && (!candidate.command || candidate.command.toUpperCase() === "DATA");
}
