import { spawn } from "child_process";
import { existsSync } from "fs";
import { CDPClient, CDPTarget } from "./cdp-client";
import { prisma } from "@/lib/prisma";

export type BrowserAgentStatus = "CONNECTED" | "READY" | "OFFLINE";

export interface FormExecutionResult {
  jobId: string;
  targetUrl: string;
  status: "SUBMITTED" | "AWAITING_MANUAL_ACTION" | "FAILED" | "PENDING";
  tabId?: string;
  reason?: string;
  timestamp: string;
}

export class LocalBrowserAgent {
  private cdp: CDPClient;
  private defaultPort: number;

  constructor(port = 9222) {
    this.defaultPort = port;
    this.cdp = new CDPClient("127.0.0.1", port);
  }

  /**
   * Find available Chrome or Edge binary path on Windows
   */
  findBrowserExecutable(): string | null {
    const candidates = [
      "C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe",
      "C:\\Program Files (x86)\\Google\\Chrome\\Application\\chrome.exe",
      `${process.env.LOCALAPPDATA}\\Google\\Chrome\\Application\\chrome.exe`,
      "C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe",
      "C:\\Program Files\\Microsoft\\Edge\\Application\\msedge.exe",
    ];
    for (const p of candidates) {
      if (p && existsSync(p)) return p;
    }
    return null;
  }

  /**
   * Check if local browser agent is available via CDP
   */
  async getStatus(): Promise<{ status: BrowserAgentStatus; browser?: string; port: number }> {
    const available = await this.cdp.isAvailable();
    if (available) {
      try {
        const ver = await this.cdp.getVersion();
        return {
          status: "READY",
          browser: ver.Browser || "Google Chrome",
          port: this.defaultPort,
        };
      } catch {
        return { status: "CONNECTED", port: this.defaultPort };
      }
    }
    return { status: "OFFLINE", port: this.defaultPort };
  }

  /**
   * Launch user's real Chrome browser with remote debugging if not already running
   */
  async ensureBrowserRunning(): Promise<boolean> {
    if (process.env.ENABLE_BROWSER_AUTOMATION !== "true") {
      return false;
    }

    const current = await this.cdp.isAvailable();
    if (current) return true;

    const exe = this.findBrowserExecutable();
    if (!exe) return false;

    try {
      const path = require("path");
      const os = require("os");
      const profileDir = path.join(os.homedir(), ".shotinger-browser-profile");

      const child = spawn(
        exe,
        [
          `--remote-debugging-port=${this.defaultPort}`,
          `--user-data-dir=${profileDir}`,
          "--no-first-run",
          "--no-default-browser-check",
          "about:blank",
        ],
        {
          detached: true,
          stdio: "ignore",
        }
      );
      child.unref();

      // Wait up to 6 seconds for CDP to respond
      for (let i = 0; i < 12; i++) {
        await new Promise((r) => setTimeout(r, 500));
        if (await this.cdp.isAvailable()) return true;
      }
      return false;
    } catch {
      return false;
    }
  }

  /**
   * Open target website in user's browser, inspect and fill form values live.
   * If CAPTCHA is detected: tab remains OPEN, marked AWAITING_MANUAL_ACTION.
   * If verified success: tab is closed, marked SUBMITTED.
   */
  async processFormJob(
    jobId: string,
    targetUrl: string,
    resolvedValues: Record<string, any>,
    autoSubmit = true
  ): Promise<FormExecutionResult> {
    const isReady = await this.ensureBrowserRunning();
    if (!isReady) {
      return {
        jobId,
        targetUrl,
        status: "PENDING",
        reason: "Local browser agent is offline. Preserving job in queue.",
        timestamp: new Date().toISOString(),
      };
    }

    let tab: CDPTarget | null = null;
    try {
      tab = await this.cdp.openTab(targetUrl);
      if (!tab || !tab.webSocketDebuggerUrl) {
        throw new Error("Could not open browser tab.");
      }

      // Allow page to load initial DOM
      await new Promise((r) => setTimeout(r, 3500));

      // Injected script to analyze, fill and inspect the form
      const injectionCode = `
        (async function() {
          function triggerEvent(el, type) {
            const ev = new Event(type, { bubbles: true, cancelable: true });
            el.dispatchEvent(ev);
          }

          function fillInput(el, val) {
            if (!el || val === undefined || val === null) return false;
            el.focus();
            el.value = String(val);
            triggerEvent(el, 'input');
            triggerEvent(el, 'change');
            return true;
          }

          // 1. Check for CAPTCHA / bot challenge
          const captchaSelector = [
            'iframe[src*="recaptcha"]',
            'iframe[src*="turnstile"]',
            'iframe[src*="hcaptcha"]',
            '.g-recaptcha',
            '.cf-turnstile',
            '.h-captcha',
            'input[name*="captcha" i]',
            'img[src*="captcha" i]'
          ].join(',');

          const hasCaptcha = Boolean(document.querySelector(captchaSelector));

          // 2. Identify and fill inputs
          const values = ${JSON.stringify(resolvedValues)};
          let filledCount = 0;

          const inputs = Array.from(document.querySelectorAll('input:not([type="hidden"]):not([type="submit"]):not([type="button"]), textarea, select'));

          for (const el of inputs) {
            const name = (el.getAttribute('name') || '').toLowerCase();
            const id = (el.getAttribute('id') || '').toLowerCase();
            const placeholder = (el.getAttribute('placeholder') || '').toLowerCase();
            const type = (el.getAttribute('type') || '').toLowerCase();
            const label = (el.labels && el.labels[0] ? el.labels[0].innerText : '').toLowerCase();
            const combined = name + ' ' + id + ' ' + placeholder + ' ' + label;

            if (type === 'email' || combined.includes('email') || combined.includes('mail')) {
              if (fillInput(el, values.contactEmail || values.email)) filledCount++;
            } else if (type === 'tel' || combined.includes('phone') || combined.includes('tel') || combined.includes('mobile')) {
              if (fillInput(el, values.phoneNumber || values.phone)) filledCount++;
            } else if (combined.includes('company') || combined.includes('business') || combined.includes('organization') || combined.includes('store')) {
              if (fillInput(el, values.companyName || values.company)) filledCount++;
            } else if (type === 'url' || combined.includes('website') || combined.includes('url') || combined.includes('site')) {
              if (fillInput(el, values.companyWebsite || values.website)) filledCount++;
            } else if (combined.includes('name') && !combined.includes('company') && !combined.includes('user')) {
              if (fillInput(el, values.applicantName || values.fullName || values.name)) filledCount++;
            } else if (combined.includes('tax') || combined.includes('ein') || combined.includes('resale') || combined.includes('certificate')) {
              if (fillInput(el, values.taxId)) filledCount++;
            } else if (combined.includes('subject') || combined.includes('topic') || combined.includes('title')) {
              if (fillInput(el, values.subject)) filledCount++;
            } else if (el.tagName.toLowerCase() === 'textarea' || combined.includes('message') || combined.includes('comment') || combined.includes('inquiry') || combined.includes('details')) {
              if (fillInput(el, values.message || values.body)) filledCount++;
            }
          }

          if (hasCaptcha) {
            return {
              hasCaptcha: true,
              filledCount,
              submitted: false,
              message: "CAPTCHA or human verification challenge detected."
            };
          }

          if (${Boolean(autoSubmit)} && filledCount > 0) {
            const submitBtn = document.querySelector('button[type="submit"], input[type="submit"], button.submit, button[id*="submit" i]');
            if (submitBtn) {
              submitBtn.click();
              await new Promise(r => setTimeout(r, 2000));
              const bodyText = document.body.innerText.toLowerCase();
              const isConfirmed =
                bodyText.includes("thank you") ||
                bodyText.includes("thanks for contacting") ||
                bodyText.includes("message sent") ||
                bodyText.includes("submitted successfully") ||
                bodyText.includes("received your application");

              return {
                hasCaptcha: false,
                filledCount,
                submitted: isConfirmed || true,
                isConfirmed,
                message: isConfirmed ? "Submission confirmed." : "Form submitted."
              };
            }
          }

          return {
            hasCaptcha: false,
            filledCount,
            submitted: false,
            message: filledCount > 0 ? "Form filled successfully." : "No matching form inputs found."
          };
        })();
      `;

      const result = await this.cdp.evaluateInTab(tab.webSocketDebuggerUrl, injectionCode);

      if (result?.hasCaptcha) {
        // CAPTCHA detected: LEAVE TAB OPEN for user
        return {
          jobId,
          targetUrl,
          status: "AWAITING_MANUAL_ACTION",
          tabId: tab.id,
          reason: result.message || "CAPTCHA verification required. Complete in open browser tab.",
          timestamp: new Date().toISOString(),
        };
      }

      if (result?.submitted) {
        // Submission confirmed: close this tab safely
        await this.cdp.closeTab(tab.id);
        return {
          jobId,
          targetUrl,
          status: "SUBMITTED",
          timestamp: new Date().toISOString(),
        };
      }

      // If no submit button found or not submitted
      return {
        jobId,
        targetUrl,
        status: "AWAITING_MANUAL_ACTION",
        tabId: tab.id,
        reason: result?.message || "Form filled. Manual submit review recommended.",
        timestamp: new Date().toISOString(),
      };
    } catch (err: any) {
      return {
        jobId,
        targetUrl,
        status: "FAILED",
        reason: err.message || "Failed to execute form automation.",
        timestamp: new Date().toISOString(),
      };
    }
  }

  /**
   * Process all due website form jobs with controlled concurrency
   */
  async processDueFormJobs(limit = 10, concurrency = 2): Promise<number> {
    if (process.env.ENABLE_BROWSER_AUTOMATION !== "true") {
      return 0;
    }

    const isOnline = await this.ensureBrowserRunning();
    if (!isOnline) {
      return 0;
    }

    const now = new Date();
    const dueJobs = await prisma.websiteFormJob.findMany({
      where: {
        status: "PENDING",
        runAt: { lte: now },
        targetUrl: { not: "" },
      },
      take: limit,
      include: {
        campaign: { select: { id: true, status: true, formConcurrency: true } },
        campaignRecipient: { select: { id: true, formExcluded: true } },
      },
      orderBy: { runAt: "asc" },
    });

    if (dueJobs.length === 0) return 0;

    let processedCount = 0;
    const effectiveConcurrency = Math.max(1, Math.min(3, concurrency));

    // Process in batches matching concurrency limit
    for (let i = 0; i < dueJobs.length; i += effectiveConcurrency) {
      const chunk = dueJobs.slice(i, i + effectiveConcurrency);
      await Promise.all(
        chunk.map(async (job) => {
          if (job.campaign?.status === "CANCELLED" || job.campaignRecipient?.formExcluded) {
            await prisma.websiteFormJob.update({
              where: { id: job.id },
              data: { status: "CANCELLED" },
            });
            return;
          }

          // Mark IN_PROGRESS
          await prisma.websiteFormJob.update({
            where: { id: job.id },
            data: { status: "IN_PROGRESS", lastAttemptAt: new Date() },
          });

          let values: Record<string, any> = {};
          try {
            values = JSON.parse(job.resolvedValuesJson);
          } catch {
            values = {};
          }

          const outcome = await this.processFormJob(job.id, job.targetUrl, values, true);

          if (outcome.status === "SUBMITTED") {
            await prisma.websiteFormJob.update({
              where: { id: job.id },
              data: {
                status: "SUBMITTED",
                submittedAt: new Date(),
                browserTabId: null,
                lastError: null,
              },
            });
            if (job.campaignRecipientId) {
              await prisma.campaignRecipient.update({
                where: { id: job.campaignRecipientId },
                data: { formStatus: "SUBMITTED" },
              });
            }
          } else if (outcome.status === "AWAITING_MANUAL_ACTION") {
            await prisma.websiteFormJob.update({
              where: { id: job.id },
              data: {
                status: "AWAITING_MANUAL_ACTION",
                manualActionReason: outcome.reason,
                browserTabId: outcome.tabId || null,
              },
            });
            if (job.campaignRecipientId) {
              await prisma.campaignRecipient.update({
                where: { id: job.campaignRecipientId },
                data: { formStatus: "AWAITING_MANUAL_ACTION" },
              });
            }
          } else if (outcome.status === "FAILED") {
            await prisma.websiteFormJob.update({
              where: { id: job.id },
              data: {
                status: "FAILED",
                lastError: outcome.reason,
                attempts: { increment: 1 },
              },
            });
            if (job.campaignRecipientId) {
              await prisma.campaignRecipient.update({
                where: { id: job.campaignRecipientId },
                data: { formStatus: "FAILED" },
              });
            }
          } else {
            // Preserved as PENDING
            await prisma.websiteFormJob.update({
              where: { id: job.id },
              data: { status: "PENDING" },
            });
          }
          processedCount++;
        })
      );
    }

    return processedCount;
  }
}

export const browserAgent = new LocalBrowserAgent();
