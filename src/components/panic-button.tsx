"use client";

import { useState } from "react";
import { usePinLock } from "./pin-lock";

export function PanicButton() {
  const { lock } = usePinLock();
  const [show, setShow] = useState(false);
  const [confirming, setConfirming] = useState(false);

  // Long-press or 5 rapid taps on the floating button to show
  // The button is barely visible — a small circle in the corner

  return (
    <>
      {/* Activation trigger: tiny invisible corner target */}
      <button
        type="button"
        onDoubleClick={() => setShow(true)}
        className="fixed bottom-2 right-2 z-50 h-6 w-6 rounded-full bg-zinc-900/30 opacity-0 hover:opacity-100 transition-opacity"
        title=""
        aria-label="Settings"
      />

      {/* Panic button panel */}
      {show && (
        <div className="fixed inset-0 z-[100] flex items-center justify-center bg-black/80 backdrop-blur-sm">
          <div className="w-80 rounded-2xl border border-red-900/50 bg-zinc-950 p-6 text-center">
            {!confirming ? (
              <>
                <div className="mx-auto mb-4 flex h-12 w-12 items-center justify-center rounded-full bg-red-900/30">
                  <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="#ef4444" strokeWidth="2">
                    <circle cx="12" cy="12" r="10" />
                    <path d="M12 8v4M12 16h.01" />
                  </svg>
                </div>
                <h3 className="mb-2 text-lg font-semibold text-white">Panic</h3>
                <p className="mb-6 text-sm text-zinc-400">
                  Lock screen and clear sensitive data?
                </p>
                <div className="flex gap-3">
                  <button
                    type="button"
                    onClick={() => setShow(false)}
                    className="flex-1 rounded-xl bg-zinc-900 py-3 text-sm text-zinc-300 hover:bg-zinc-800"
                  >
                    Cancel
                  </button>
                  <button
                    type="button"
                    onClick={() => setConfirming(true)}
                    className="flex-1 rounded-xl bg-red-700 py-3 text-sm font-semibold text-white hover:bg-red-600"
                  >
                    Panic
                  </button>
                </div>
              </>
            ) : (
              <>
                <div className="mx-auto mb-4 flex h-12 w-12 items-center justify-center rounded-full bg-red-900/50">
                  <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="#ef4444" strokeWidth="2">
                    <path d="M10.29 3.86L1.82 18a2 2 0 001.71 3h16.94a2 2 0 001.71-3L13.71 3.86a2 2 0 00-3.42 0z" />
                    <path d="M12 9v4M12 17h.01" />
                  </svg>
                </div>
                <h3 className="mb-2 text-lg font-semibold text-white">Confirm Panic</h3>
                <p className="mb-6 text-sm text-red-400">
                  App will lock immediately. Close this tab for safety.
                </p>
                <div className="flex gap-3">
                  <button
                    type="button"
                    onClick={() => { setConfirming(false); setShow(false); }}
                    className="flex-1 rounded-xl bg-zinc-900 py-3 text-sm text-zinc-300 hover:bg-zinc-800"
                  >
                    Cancel
                  </button>
                  <button
                    type="button"
                    onClick={() => {
                      lock();
                      setConfirming(false);
                      setShow(false);
                    }}
                    className="flex-1 rounded-xl bg-red-600 py-3 text-sm font-semibold text-white hover:bg-red-500"
                  >
                    Lock Now
                  </button>
                </div>
              </>
            )}
          </div>
        </div>
      )}
    </>
  );
}
