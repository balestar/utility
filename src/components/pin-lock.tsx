"use client";

import {
  createContext,
  useContext,
  useState,
  useCallback,
  useEffect,
  type ReactNode,
} from "react";

type PinContext = {
  locked: boolean;
  lock: () => void;
  unlock: (pin: string) => Promise<boolean>;
  setPin: (pin: string) => Promise<void>;
  hasPin: boolean;
};

const PinContext = createContext<PinContext>({
  locked: true,
  lock: () => {},
  unlock: async () => false,
  setPin: async () => {},
  hasPin: false,
});

export function usePinLock() {
  return useContext(PinContext);
}

const STORAGE_KEY = "msf_app_pin";
const LOCK_TIMEOUT_MS = 5 * 60 * 1000;

async function hashPin(pin: string): Promise<string> {
  const data = new TextEncoder().encode(pin + "msf-secure-salt");
  const hash = await crypto.subtle.digest("SHA-256", data);
  return Array.from(new Uint8Array(hash))
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");
}

export function PinLock({ children }: { children: ReactNode }) {
  const [locked, setLocked] = useState(true);
  const [hasPin, setHasPin] = useState(() => {
    if (typeof window === "undefined") return false;
    return !!localStorage.getItem(STORAGE_KEY);
  });
  const [ready, setReady] = useState(false);

  // Sync locked state with hasPin on mount (single render batch)
  useEffect(() => {
    if (!ready) {
      setReady(true);
      if (!hasPin) setLocked(false);
    }
  }, [ready, hasPin]);

  // Auto-lock timer
  useEffect(() => {
    if (!ready || locked || !hasPin) return;

    let timer: ReturnType<typeof setTimeout>;
    const reset = () => {
      clearTimeout(timer);
      timer = setTimeout(() => setLocked(true), LOCK_TIMEOUT_MS);
    };
    const events = ["mousedown", "keydown", "touchstart", "scroll"];
    events.forEach((e) => window.addEventListener(e, reset));
    reset();
    return () => {
      clearTimeout(timer);
      events.forEach((e) => window.removeEventListener(e, reset));
    };
  }, [ready, locked, hasPin]);

  const lock = useCallback(() => setLocked(true), []);

  const unlock = useCallback(async (pin: string): Promise<boolean> => {
    const stored = localStorage.getItem(STORAGE_KEY);
    if (!stored) {
      setLocked(false);
      return true;
    }
    const h = await hashPin(pin);
    if (h === stored) {
      setLocked(false);
      return true;
    }
    return false;
  }, []);

  const setPinCb = useCallback(async (pin: string) => {
    const h = await hashPin(pin);
    localStorage.setItem(STORAGE_KEY, h);
    setHasPin(true);
  }, []);

  if (!ready) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-zinc-950">
        <p className="text-sm text-zinc-500">Initializing...</p>
      </div>
    );
  }

  return (
    <PinContext.Provider value={{ locked, lock, unlock, setPin: setPinCb, hasPin }}>
      {locked ? <LockScreen /> : children}
    </PinContext.Provider>
  );
}

function LockScreen() {
  const { unlock, setPin, hasPin } = usePinLock();
  const [pin, setPinLocal] = useState("");
  const [mode, setMode] = useState<"unlock" | "set" | "confirm">(
    hasPin ? "unlock" : "set",
  );
  const [confirmPin, setConfirmPin] = useState("");
  const [error, setError] = useState("");
  const [verifying, setVerifying] = useState(false);
  const [modeInit, setModeInit] = useState(false);

  useEffect(() => {
    if (modeInit) return;
    setModeInit(true);
    setMode(hasPin ? "unlock" : "set");
    setPinLocal("");
    setConfirmPin("");
  }, [hasPin, modeInit]);

  const submitPin = async (value: string) => {
    if (mode === "unlock") {
      setVerifying(true);
      const ok = await unlock(value);
      setVerifying(false);
      if (!ok) {
        setError("Wrong PIN");
        setPinLocal("");
      }
    } else if (mode === "set") {
      setMode("confirm");
    } else if (mode === "confirm") {
      if (value === pin) {
        await setPin(pin);
        setMode("unlock");
        setPinLocal("");
        setConfirmPin("");
      } else {
        setError("PINs don't match. Try again.");
        setPinLocal("");
        setConfirmPin("");
        setMode("set");
      }
    }
  };

  const handleDigit = (d: string) => {
    if (verifying) return;
    setError("");

    if (mode === "set" || mode === "unlock") {
      const next = pin + d;
      setPinLocal(next);
      if (next.length === 6) submitPin(next);
    } else if (mode === "confirm") {
      const next = confirmPin + d;
      setConfirmPin(next);
      if (next.length === 6) submitPin(next);
    }
  };

  const handleBackspace = () => {
    if (mode === "confirm") setConfirmPin((p) => p.slice(0, -1));
    else setPinLocal((p) => p.slice(0, -1));
    setError("");
  };

  const currentLen = mode === "confirm" ? confirmPin.length : pin.length;

  const titles: Record<string, string> = {
    unlock: "Enter PIN",
    set: "Set a 6-digit PIN",
    confirm: "Confirm your PIN",
  };

  return (
    <div className="flex min-h-screen flex-col items-center justify-center bg-zinc-950 px-6">
      <div className="mb-12 text-center">
        <div className="mx-auto mb-4 flex h-16 w-16 items-center justify-center rounded-2xl bg-zinc-900">
          <svg
            width="32"
            height="32"
            viewBox="0 0 512 512"
            fill="none"
            xmlns="http://www.w3.org/2000/svg"
          >
            <path
              d="M160 256C160 197.4 197.4 160 256 160C314.6 160 352 197.4 352 256C352 314.6 314.6 352 256 352C197.4 352 160 314.6 160 256Z"
              stroke="#52525b"
              strokeWidth="20"
              fill="none"
            />
            <path
              d="M200 256L240 296L312 224"
              stroke="#3f3f46"
              strokeWidth="20"
              strokeLinecap="round"
              strokeLinejoin="round"
            />
          </svg>
        </div>
        <h1 className="text-2xl font-bold text-white">{titles[mode]}</h1>
        {mode === "unlock" && (
          <p className="mt-2 text-sm text-zinc-500">Enter your app PIN</p>
        )}
      </div>

      <div className="mb-8 flex gap-3">
        {Array.from({ length: 6 }).map((_, i) => (
          <div
            key={i}
            className={`h-3 w-3 rounded-full transition-all duration-150 ${
              i < currentLen ? "scale-110 bg-red-500" : "bg-zinc-800"
            }`}
          />
        ))}
      </div>

      {error && (
        <p className="mb-4 text-sm text-red-400">{error}</p>
      )}
      {verifying && (
        <p className="mb-4 text-sm text-zinc-500">Verifying...</p>
      )}

      <div className="grid w-72 grid-cols-3 gap-3">
        {[1, 2, 3, 4, 5, 6, 7, 8, 9].map((d) => (
          <button
            key={d}
            type="button"
            onClick={() => handleDigit(String(d))}
            className="flex h-16 items-center justify-center rounded-xl bg-zinc-900 text-xl font-semibold text-white transition hover:bg-zinc-800 active:scale-95"
          >
            {d}
          </button>
        ))}
        <div />
        <button
          type="button"
          onClick={() => handleDigit("0")}
          className="flex h-16 items-center justify-center rounded-xl bg-zinc-900 text-xl font-semibold text-white transition hover:bg-zinc-800 active:scale-95"
        >
          0
        </button>
        <button
          type="button"
          onClick={handleBackspace}
          className="flex h-16 items-center justify-center rounded-xl bg-zinc-900 text-zinc-400 transition hover:bg-zinc-800 active:scale-95"
        >
          <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
            <path d="M21 4H8l-7 8 7 8h13a2 2 0 002-2V6a2 2 0 00-2-2z" />
            <path d="M18 9l-6 6M12 9l6 6" />
          </svg>
        </button>
      </div>

      <p className="mt-8 text-xs text-zinc-700">Utility v1.0</p>
    </div>
  );
}
