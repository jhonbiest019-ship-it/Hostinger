"use client";

import Link from "next/link";
import { FormEvent, useState } from "react";

export function AuthForm({ mode: initialMode }: { mode: "login" | "signup" }) {
  const [currentMode, setCurrentMode] = useState<"login" | "signup" | "reset">(initialMode);
  const [resetStep, setResetStep] = useState<"email" | "code">("email");
  const [name, setName] = useState("");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [resetCode, setResetCode] = useState("");
  const [error, setError] = useState("");
  const [message, setMessage] = useState("");
  const [busy, setBusy] = useState(false);

  async function submit(event: FormEvent) {
    event.preventDefault();
    setBusy(true);
    setError("");
    setMessage("");
    try {
      if (currentMode === "reset" && resetStep === "email") {
        const response = await fetch("/api/auth/reset", {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ email: email.trim().toLowerCase() }),
        });
        const body = await response.json().catch(() => ({}));
        if (!response.ok) throw new Error(body.error || "Unable to request reset code.");

        setMessage(body.message || "Verification code sent to your email.");
        if (body.verificationCode) {
          setResetCode(body.verificationCode);
        }
        setResetStep("code");
        return;
      }

      const endpoint =
        currentMode === "login"
          ? "/api/auth/login"
          : currentMode === "signup"
          ? "/api/auth/signup"
          : "/api/auth/reset";

      const payload =
        currentMode === "login"
          ? { email: email.trim().toLowerCase(), password }
          : currentMode === "signup"
          ? { name: name.trim(), email: email.trim().toLowerCase(), password }
          : { email: email.trim().toLowerCase(), code: resetCode.trim(), password };

      const response = await fetch(endpoint, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(payload),
      });

      const body = await response.json().catch(() => ({}));
      if (!response.ok) {
        throw new Error(body.error || "Unable to proceed.");
      }

      // Hard redirect to /dashboard guarantees the session cookie is immediately sent and dashboard loads
      window.location.href = "/dashboard";
    } catch (err) {
      setError(err instanceof Error ? err.message : "Unable to continue.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <main className="grid min-h-screen place-items-center bg-cloud p-5">
      <div className="w-full max-w-md">
        <div className="mb-6 flex items-center gap-3">
          <div className="grid h-10 w-10 place-items-center rounded-xl bg-ink text-xs font-bold text-white">
            HF
          </div>
          <div>
            <p className="font-bold">Hostinger by Farani</p>
            <p className="text-xs text-slate-400">Secure workspace</p>
          </div>
        </div>

        <section className="card p-7 shadow-sm">
          {/* Tab buttons */}
          <div className="mb-6 flex rounded-lg bg-cloud p-1 text-sm font-medium">
            <button
              type="button"
              onClick={() => {
                setCurrentMode("login");
                setResetStep("email");
                setError("");
                setMessage("");
              }}
              className={`flex-1 rounded-md py-2 text-center transition-colors ${
                currentMode === "login"
                  ? "bg-white font-semibold text-ink shadow-sm"
                  : "text-slate-500 hover:text-ink"
              }`}
            >
              Sign In
            </button>
            <button
              type="button"
              onClick={() => {
                setCurrentMode("signup");
                setResetStep("email");
                setError("");
                setMessage("");
              }}
              className={`flex-1 rounded-md py-2 text-center transition-colors ${
                currentMode === "signup"
                  ? "bg-white font-semibold text-ink shadow-sm"
                  : "text-slate-500 hover:text-ink"
              }`}
            >
              Sign Up
            </button>
            <button
              type="button"
              onClick={() => {
                setCurrentMode("reset");
                setResetStep("email");
                setError("");
                setMessage("");
              }}
              className={`flex-1 rounded-md py-2 text-center transition-colors ${
                currentMode === "reset"
                  ? "bg-white font-semibold text-ink shadow-sm"
                  : "text-slate-500 hover:text-ink"
              }`}
            >
              Reset Pass
            </button>
          </div>

          <h1 className="text-2xl font-bold">
            {currentMode === "login"
              ? "Welcome back"
              : currentMode === "signup"
              ? "Create your workspace"
              : resetStep === "code"
              ? "Verify code & new password"
              : "Reset password"}
          </h1>
          <p className="mt-2 text-sm leading-6 text-slate-500">
            {currentMode === "login"
              ? "Sign in to manage your outreach campaigns and mailboxes."
              : currentMode === "signup"
              ? "Start with a new private account for your contacts and campaigns."
              : resetStep === "code"
              ? "Enter the 6-digit verification code and your new password."
              : "Enter your account email to receive a secure reset verification code."}
          </p>

          <form className="mt-6 space-y-4" onSubmit={submit}>
            {currentMode === "signup" && (
              <label className="block text-sm font-medium text-slate-600">
                Name
                <input
                  required
                  minLength={2}
                  value={name}
                  onChange={(event) => setName(event.target.value)}
                  placeholder="Your Name"
                  className="mt-2 w-full rounded-lg border border-line px-3 py-2.5 outline-none focus:border-ink"
                />
              </label>
            )}

            <label className="block text-sm font-medium text-slate-600">
              Email
              <input
                required
                type="email"
                disabled={currentMode === "reset" && resetStep === "code"}
                value={email}
                onChange={(event) => setEmail(event.target.value)}
                placeholder="name@example.com"
                className="mt-2 w-full rounded-lg border border-line px-3 py-2.5 outline-none focus:border-ink disabled:bg-slate-50 disabled:text-slate-500"
              />
            </label>

            {currentMode === "reset" && resetStep === "code" && (
              <label className="block text-sm font-medium text-slate-600">
                6-Digit Verification Code
                <input
                  required
                  maxLength={10}
                  value={resetCode}
                  onChange={(event) => setResetCode(event.target.value)}
                  placeholder="e.g. 123456"
                  className="mt-2 w-full rounded-lg border border-line px-3 py-2.5 font-mono text-base tracking-widest outline-none focus:border-ink"
                />
              </label>
            )}

            {(currentMode !== "reset" || resetStep === "code") && (
              <label className="block text-sm font-medium text-slate-600">
                {currentMode === "reset" ? "New Password" : "Password"}
                {currentMode !== "login" && (
                  <span className="ml-1 text-xs font-normal text-slate-400">(6+ characters)</span>
                )}
                <input
                  required
                  minLength={currentMode === "login" ? 1 : 6}
                  type="password"
                  value={password}
                  onChange={(event) => setPassword(event.target.value)}
                  placeholder={currentMode === "reset" ? "Enter new password" : "••••••••"}
                  className="mt-2 w-full rounded-lg border border-line px-3 py-2.5 outline-none focus:border-ink"
                />
              </label>
            )}

            {error && (
              <p className="rounded-lg bg-red-50 px-3 py-2.5 text-sm text-red-700" role="alert">
                {error}
              </p>
            )}

            {message && (
              <p className="rounded-lg bg-mint px-3 py-2.5 text-sm text-emerald-800" role="status">
                {message}
              </p>
            )}

            <button className="btn-primary w-full" disabled={busy}>
              {busy
                ? "Please wait..."
                : currentMode === "login"
                ? "Sign in"
                : currentMode === "signup"
                ? "Create account"
                : resetStep === "email"
                ? "Request Verification Code"
                : "Verify & Reset Password"}
            </button>

            {currentMode === "reset" && resetStep === "code" && (
              <button
                type="button"
                onClick={() => setResetStep("email")}
                className="w-full text-center text-xs text-slate-500 hover:text-ink pt-1"
              >
                ← Back to email input
              </button>
            )}
          </form>

          <p className="mt-6 text-center text-sm text-slate-500">
            {currentMode === "login" ? (
              <>
                Need an account?{" "}
                <button
                  type="button"
                  onClick={() => setCurrentMode("signup")}
                  className="font-semibold text-ink hover:underline"
                >
                  Create one
                </button>
              </>
            ) : currentMode === "signup" ? (
              <>
                Already registered?{" "}
                <button
                  type="button"
                  onClick={() => setCurrentMode("login")}
                  className="font-semibold text-ink hover:underline"
                >
                  Sign in
                </button>
              </>
            ) : (
              <>
                Remember your password?{" "}
                <button
                  type="button"
                  onClick={() => setCurrentMode("login")}
                  className="font-semibold text-ink hover:underline"
                >
                  Sign in
                </button>
              </>
            )}
          </p>
        </section>
      </div>
    </main>
  );
}
