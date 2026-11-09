export async function register() {
  if (process.env.NEXT_RUNTIME !== "nodejs") return;
  const { validateServerConfig } = await import("./lib/config");
  validateServerConfig();

  // Autonomous resilient background email queue dispatcher
  // Ensures mail sending NEVER stops under any circumstances
  if (!(globalThis as any).__outreach_worker_running) {
    (globalThis as any).__outreach_worker_running = true;

    const runWorkerLoop = async () => {
      try {
        const { processDueJobs } = await import("./lib/queue/worker");
        await processDueJobs();
      } catch {
        // Safe recovery, never crash the process
      }
    };

    // Run initial check after server boot
    setTimeout(() => void runWorkerLoop(), 3000);

    // Keep dispatching due jobs continuously every 10 seconds
    setInterval(() => {
      void runWorkerLoop();
    }, 10_000);
  }
}
