"use client";

import { useEffect } from "react";

export default function ErrorBoundary({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  useEffect(() => {
    console.error("Global Application Error:", error);
  }, [error]);

  return (
    <div className="min-h-screen flex items-center justify-center bg-gray-50 px-4 py-12">
      <div className="max-w-md w-full bg-white rounded-2xl border border-gray-200 p-8 shadow-sm text-center space-y-4">
        <div className="w-12 h-12 bg-purple-100 text-[#673DE6] rounded-full flex items-center justify-center mx-auto text-xl font-bold">
          !
        </div>
        <h2 className="text-xl font-bold text-gray-900">Something went wrong</h2>
        <p className="text-sm text-gray-600">
          The application encountered an unexpected issue while processing your request.
        </p>
        {error.message && (
          <div className="p-3 bg-red-50 border border-red-200 rounded-xl text-xs text-red-700 font-mono text-left break-all max-h-32 overflow-auto">
            {error.message}
          </div>
        )}
        <div className="pt-2 flex items-center justify-center gap-3">
          <button
            onClick={() => reset()}
            className="px-4 py-2 rounded-xl bg-[#673DE6] hover:bg-[#5025D1] text-white text-xs font-bold transition shadow-xs"
          >
            Try Again
          </button>
          <a
            href="/login"
            className="px-4 py-2 rounded-xl border border-gray-200 hover:bg-gray-50 text-gray-700 text-xs font-bold transition shadow-2xs"
          >
            Go to Login
          </a>
        </div>
      </div>
    </div>
  );
}
