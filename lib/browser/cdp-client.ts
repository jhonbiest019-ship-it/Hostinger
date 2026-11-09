/**
 * Native Chrome DevTools Protocol (CDP) Client
 * Uses Node.js built-in fetch and WebSocket to control the user's visible browser.
 */

export interface CDPTarget {
  id: string;
  title: string;
  url: string;
  type: string;
  webSocketDebuggerUrl?: string;
}

export class CDPClient {
  private port: number;
  private host: string;

  constructor(host = "127.0.0.1", port = 9222) {
    this.host = host;
    this.port = port;
  }

  get baseUrl() {
    return `http://${this.host}:${this.port}`;
  }

  async isAvailable(): Promise<boolean> {
    try {
      const res = await fetch(`${this.baseUrl}/json/version`, { signal: AbortSignal.timeout(1500) });
      return res.ok;
    } catch {
      return false;
    }
  }

  async getVersion(): Promise<any> {
    const res = await fetch(`${this.baseUrl}/json/version`, { signal: AbortSignal.timeout(2000) });
    if (!res.ok) throw new Error("Browser CDP endpoint unavailable");
    return res.json();
  }

  async listTabs(): Promise<CDPTarget[]> {
    const res = await fetch(`${this.baseUrl}/json/list`, { signal: AbortSignal.timeout(2000) });
    if (!res.ok) throw new Error("Could not list browser tabs");
    return res.json();
  }

  async openTab(url: string): Promise<CDPTarget> {
    const res = await fetch(`${this.baseUrl}/json/new?${encodeURIComponent(url)}`, {
      method: "PUT",
      signal: AbortSignal.timeout(8000),
    });
    if (!res.ok) throw new Error(`Could not open browser tab for ${url}`);
    return res.json();
  }

  async closeTab(targetId: string): Promise<boolean> {
    try {
      const res = await fetch(`${this.baseUrl}/json/close/${targetId}`, {
        signal: AbortSignal.timeout(3000),
      });
      return res.ok;
    } catch {
      return false;
    }
  }

  async evaluateInTab(wsUrl: string, expression: string): Promise<any> {
    return new Promise((resolve, reject) => {
      const ws = new WebSocket(wsUrl);
      const timer = setTimeout(() => {
        ws.close();
        reject(new Error("CDP evaluate timed out"));
      }, 20000);

      ws.onopen = () => {
        const id = 1;
        ws.send(
          JSON.stringify({
            id,
            method: "Runtime.evaluate",
            params: {
              expression,
              returnByValue: true,
              awaitPromise: true,
            },
          })
        );
      };

      ws.onmessage = (event) => {
        clearTimeout(timer);
        try {
          const data = JSON.parse(event.data.toString());
          ws.close();
          if (data.error) {
            reject(new Error(data.error.message || "CDP error"));
          } else {
            resolve(data.result?.result?.value);
          }
        } catch (err) {
          ws.close();
          reject(err);
        }
      };

      ws.onerror = (err) => {
        clearTimeout(timer);
        reject(err);
      };
    });
  }
}
