"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { BrowserQRCodeReader } from "@zxing/browser";
import type { IScannerControls } from "@zxing/browser";
import type { Result } from "@zxing/library";
import { AlertCircle, CheckCircle, Crosshair, MessageSquare } from "lucide-react";
import { CODE_RE, tokenFromScan } from "@/lib/rx";
import { lookup, saveCodeLookup } from "@/lib/client";

type ScanStatus = "idle" | "starting" | "scanning" | "found" | "rejected" | "error";

const NOT_ENDOD = "Not an Endod prescription";

function cameraErrorMessage(e: unknown): string {
  const name = e instanceof Error ? e.name : "";
  if (name === "NotAllowedError" || name === "SecurityError") {
    return "Camera permission was refused. Allow the camera in the browser settings, or use Upload QR or the SMS code.";
  }
  if (name === "NotFoundError" || name === "OverconstrainedError") {
    return "No camera found on this device. Use Upload QR or the SMS code.";
  }
  if (name === "NotReadableError") {
    return "The camera is in use by another app. Close it and tap Rescan.";
  }
  return "The camera could not be started. Use Upload QR or the SMS code.";
}

function ScanCorners() {
  return (
    <>
      <div className="pointer-events-none absolute -top-3.5 -left-3.5 h-11 w-11 rounded-tl-[16px] border-t-[8px] border-l-[8px] border-[#FDB714]" />
      <div className="pointer-events-none absolute -top-3.5 -right-3.5 h-11 w-11 rounded-tr-[16px] border-t-[8px] border-r-[8px] border-[#FDB714]" />
      <div className="pointer-events-none absolute -bottom-3.5 -left-3.5 h-11 w-11 rounded-bl-[16px] border-b-[8px] border-l-[8px] border-[#FDB714]" />
      <div className="pointer-events-none absolute -bottom-3.5 -right-3.5 h-11 w-11 rounded-br-[16px] border-b-[8px] border-r-[8px] border-[#FDB714]" />
    </>
  );
}

export default function ScanPage() {
  const router = useRouter();
  const videoRef = useRef<HTMLVideoElement>(null);
  const controlsRef = useRef<IScannerControls | null>(null);
  const readerRef = useRef<BrowserQRCodeReader | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const sessionRef = useRef(0);
  const pausedByVisibilityRef = useRef(false);

  const [devices, setDevices] = useState<MediaDeviceInfo[]>([]);
  const [deviceId, setDeviceId] = useState<string | undefined>(undefined);
  const [torchOn, setTorchOn] = useState(false);
  const [torchSupported, setTorchSupported] = useState(false);
  const [status, setStatus] = useState<ScanStatus>("idle");
  const [message, setMessage] = useState<string>("Ready to scan");
  const [error, setError] = useState<string | null>(null);

  const [otp, setOtp] = useState("");
  const [verifying, setVerifying] = useState(false);
  const [codeError, setCodeError] = useState<string | null>(null);

  const stopScanner = useCallback(() => {
    sessionRef.current += 1;
    try {
      controlsRef.current?.stop();
    } catch {
      /* ignore */
    }
    controlsRef.current = null;
    const video = videoRef.current;
    if (video) {
      const src = video.srcObject as MediaStream | null;
      src?.getTracks().forEach((t) => t.stop());
      video.srcObject = null;
    }
    setTorchOn(false);
    setTorchSupported(false);
  }, []);

  const handleScanText = useCallback(
    (text: string) => {
      const token = tokenFromScan(text, window.location.origin);
      if (!token) {
        setStatus("rejected");
        setMessage(NOT_ENDOD);
        setError(`${NOT_ENDOD}. Only the QR code from the patient's Endod app can be used here.`);
        return;
      }
      setStatus("found");
      setMessage("Endod prescription found");
      setError(null);
      router.push(`/rx/${encodeURIComponent(token)}`);
    },
    [router],
  );

  const startScanner = useCallback(
    async (targetDeviceId?: string) => {
      stopScanner();
      const session = sessionRef.current;
      setError(null);
      setStatus("starting");
      setMessage("Starting camera...");
      const video = videoRef.current;
      if (!video) return;
      if (!navigator.mediaDevices?.getUserMedia) {
        setStatus("error");
        setMessage("Camera unavailable");
        setError("This browser cannot use the camera here (it needs HTTPS). Use Upload QR or the SMS code.");
        return;
      }
      try {
        readerRef.current ??= new BrowserQRCodeReader();
        const onResult = (result: Result | undefined) => {
          if (!result || session !== sessionRef.current) return;
          stopScanner();
          handleScanText(result.getText());
        };
        const controls = targetDeviceId
          ? await readerRef.current.decodeFromVideoDevice(targetDeviceId, video, onResult)
          : await readerRef.current.decodeFromConstraints(
              { video: { facingMode: { ideal: "environment" } } },
              video,
              onResult,
            );
        if (session !== sessionRef.current) {
          controls.stop();
          return;
        }
        controlsRef.current = controls;
        setStatus("scanning");
        setMessage("Scanning for QR code...");

        const track = (video.srcObject as MediaStream | null)?.getVideoTracks()?.[0];
        setTorchSupported(
          !!track && (track.getCapabilities?.() as { torch?: boolean } | undefined)?.torch === true,
        );
        setDeviceId(track?.getSettings().deviceId ?? targetDeviceId);
        const all = await navigator.mediaDevices.enumerateDevices();
        if (session === sessionRef.current) setDevices(all.filter((d) => d.kind === "videoinput"));
      } catch (e) {
        if (session !== sessionRef.current) return;
        stopScanner();
        setStatus("error");
        setMessage("Camera unavailable");
        setError(cameraErrorMessage(e));
      }
    },
    [stopScanner, handleScanText],
  );

  useEffect(() => {
    const timer = setTimeout(() => void startScanner(), 0);
    const onVisibility = () => {
      if (document.hidden) {
        if (controlsRef.current) {
          pausedByVisibilityRef.current = true;
          stopScanner();
          setStatus("idle");
          setMessage("Camera paused");
        }
      } else if (pausedByVisibilityRef.current) {
        pausedByVisibilityRef.current = false;
        void startScanner();
      }
    };
    document.addEventListener("visibilitychange", onVisibility);
    return () => {
      clearTimeout(timer);
      document.removeEventListener("visibilitychange", onVisibility);
      pausedByVisibilityRef.current = false;
      stopScanner();
    };
  }, [startScanner, stopScanner]);

  const handleSwitchCamera = async () => {
    if (devices.length < 2) return;
    const idx = devices.findIndex((d) => d.deviceId === deviceId);
    const next = devices[(idx + 1) % devices.length];
    await startScanner(next.deviceId);
  };

  const handleTorch = async () => {
    const next = !torchOn;
    try {
      if (controlsRef.current?.switchTorch) {
        await controlsRef.current.switchTorch(next);
      } else {
        const track = (videoRef.current?.srcObject as MediaStream | null)?.getVideoTracks()?.[0];
        await track?.applyConstraints({ advanced: [{ torch: next } as MediaTrackConstraintSet] });
      }
      setTorchOn(next);
    } catch {
      setError("The torch could not be switched on this camera.");
    }
  };

  const handleFileUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    stopScanner();
    setError(null);
    setStatus("starting");
    setMessage("Decoding image...");
    const url = URL.createObjectURL(file);
    try {
      readerRef.current ??= new BrowserQRCodeReader();
      const img = new window.Image();
      img.src = url;
      await new Promise<void>((res, rej) => {
        img.onload = () => res();
        img.onerror = () => rej(new Error("Image load failed"));
      });
      const result = await readerRef.current.decodeFromImageElement(img);
      handleScanText(result.getText());
    } catch {
      setStatus("error");
      setMessage("No QR code found");
      setError("No QR code was found in that image. Try a sharper photo.");
    } finally {
      URL.revokeObjectURL(url);
      if (fileInputRef.current) fileInputRef.current.value = "";
    }
  };

  const handleOtpChange = (val: string) => {
    setOtp(val.replace(/\D/g, "").slice(0, 6));
    setCodeError(null);
  };

  const handleVerify = async (e?: React.FormEvent) => {
    e?.preventDefault();
    if (verifying) return;
    if (!CODE_RE.test(otp)) {
      setCodeError("Enter the 6-digit code from the patient's SMS.");
      return;
    }
    setVerifying(true);
    setCodeError(null);
    const ref = { code: otp };
    const result = await lookup(ref);
    if (!result.ok) {
      setVerifying(false);
      setCodeError(result.error);
      return;
    }
    saveCodeLookup(ref, result.prescription);
    stopScanner();
    setOtp("");
    setVerifying(false);
    router.push("/rx/code");
  };

  const resetScan = () => {
    setError(null);
    void startScanner(deviceId);
  };

  const otpChars = otp.split("");
  const live = status === "scanning" || status === "starting";
  const cameraOn = status === "scanning" || status === "starting" || status === "found";

  return (
    <div className="min-h-dvh bg-[#0d0e10] text-white flex flex-col">
      <main className="relative flex min-h-[100dvh] w-full flex-col overflow-hidden camera-feed-fallback">
        <video
          ref={videoRef}
          className={`absolute inset-0 h-full w-full object-cover transition-opacity duration-300 ${cameraOn ? "opacity-100" : "opacity-0"}`}
          muted
          playsInline
          autoPlay
        />
        <div className="absolute inset-0 bg-black/20" />

        <header className="relative z-20 flex items-center justify-between px-6 pt-10 sm:pt-12 pb-4">
          <button
            aria-label="Open Photos Gallery"
            className="p-2 text-white/90 hover:text-white transition-opacity active:opacity-70"
            type="button"
            onClick={() => fileInputRef.current?.click()}
          >
            <svg className="h-7 w-7 drop-shadow" fill="none" stroke="currentColor" strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" viewBox="0 0 24 24" aria-hidden="true">
              <rect height="18" rx="3" ry="3" width="18" x="3" y="3" />
              <circle cx="8.5" cy="8.5" r="1.5" />
              <polyline points="21 15 16 10 5 21" />
            </svg>
          </button>

          <button
            aria-label="Toggle Flashlight"
            className={`p-2 transition-transform active:scale-95 ${torchSupported ? "text-white/95 hover:text-white" : "text-white/30 cursor-not-allowed"}`}
            type="button"
            onClick={() => { if (torchSupported) void handleTorch(); }}
            disabled={!torchSupported}
          >
            <svg className="h-7 w-7 drop-shadow" viewBox="0 0 24 24" aria-hidden="true">
              <path d="M13 2L4 13.5H11L10 22L20 10.5H13L13 2Z" fill={torchOn ? "#FDB714" : "white"} stroke={torchOn ? "#FDB714" : "white"} strokeLinejoin="round" strokeWidth="1.2" />
            </svg>
          </button>

          <button
            aria-label="Switch Camera"
            className={`p-2 transition-opacity active:opacity-70 ${devices.length > 1 && live ? "text-white/90 hover:text-white" : "text-white/30 cursor-not-allowed"}`}
            type="button"
            onClick={() => { if (devices.length > 1 && live) void handleSwitchCamera(); }}
            disabled={!(devices.length > 1 && live)}
          >
            <svg className="h-7 w-7 drop-shadow" fill="none" stroke="currentColor" strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" viewBox="0 0 24 24" aria-hidden="true">
              <path d="M20 10c0-4.418-3.582-8-8-8s-8 3.582-8 8c0 1.5.414 2.9 1.135 4.1L3 16h5v-5L6.2 12.8A5.96 5.96 0 0 1 6 10c0-3.314 2.686-6 6-6s6 2.686 6 6-2.686 6-6 6c-.95 0-1.843-.223-2.637-.621L7.9 16.9A7.95 7.95 0 0 0 12 18c4.418 0 8-3.582 8-8z" />
              <path d="M10 8l-2 2 2 2" />
              <path d="M14 16l2-2-2-2" />
            </svg>
          </button>
        </header>

        <input
          ref={fileInputRef}
          type="file"
          accept="image/*"
          className="hidden"
          data-testid="qr-upload"
          onChange={handleFileUpload}
        />

        <section aria-label="QR Code Scanner Viewfinder" className="relative z-10 flex flex-1 flex-col items-center justify-center px-6 pb-8 pt-2">
          <div className="relative flex h-[240px] w-[240px] items-center justify-center sm:h-[280px] sm:w-[280px]">
            <ScanCorners />
            <div className="relative h-[214px] w-[214px] overflow-hidden rounded-2xl border border-white/10 bg-black/25 backdrop-blur-[1px] sm:h-[250px] sm:w-[250px]">
              {!live && (
                <div className="absolute inset-0 flex items-center justify-center bg-black/45 px-4 text-center">
                  <span className="text-sm font-medium text-white/90">
                    {status === "found"
                      ? "Opening prescription..."
                      : status === "rejected"
                        ? NOT_ENDOD
                        : status === "error"
                          ? message
                          : "Camera off"}
                  </span>
                </div>
              )}
              <div className="absolute top-4 left-4 h-3 w-3 rounded-full bg-[#FDB714] shadow-sm" />
            </div>
            {status === "scanning" && (
              <div className="laser-beam pointer-events-none absolute inset-x-[-14px] z-20 h-[3px] rounded-full bg-[#FDB714]" />
            )}
          </div>

          <div className="mt-8 w-full max-w-xl rounded-2xl border border-white/10 bg-black/35 px-4 py-3 backdrop-blur-md">
            <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
              <div className="flex items-center gap-2 text-white" role="status" aria-live="polite">
                {status === "found" ? (
                  <CheckCircle size={18} className="text-[#FDB714]" />
                ) : status === "error" || status === "rejected" ? (
                  <AlertCircle size={18} className="text-[#FDB714]" />
                ) : (
                  <Crosshair size={18} className="text-[#FDB714]" />
                )}
                <span className="text-sm font-medium" data-testid="scan-message">{message}</span>
              </div>
              {!live && (
                <button
                  type="button"
                  onClick={resetScan}
                  className="inline-flex items-center justify-center rounded-xl bg-[#FDB714] px-4 py-2 text-sm font-semibold text-[#18191B] hover:bg-[#eab015] transition-colors"
                >
                  Rescan
                </button>
              )}
            </div>
            {error && (
              <div
                role="alert"
                data-testid="scan-error"
                className="mt-3 rounded-xl border border-red-400/30 bg-red-500/15 px-3 py-2 text-sm text-red-50"
              >
                {error}
              </div>
            )}
          </div>
        </section>

        <footer className="relative z-20 w-full pb-6 pt-2 sm:pb-8">
          <div className="relative mx-auto flex h-24 w-full max-w-3xl items-center justify-between px-10 sm:px-16">
            <svg className="absolute inset-0 -z-10 h-full w-full" fill="none" preserveAspectRatio="none" viewBox="0 0 390 96" aria-hidden="true">
              <path d="M0,28 C70,28 105,28 128,28 C145,28 155,72 195,72 C235,72 245,28 262,28 C285,28 320,28 390,28 L390,96 L0,96 Z" fill="#161719" />
            </svg>

            <button
              aria-label="Go to code entry"
              className="mt-3 flex flex-col items-center justify-center text-white/80 transition-opacity hover:text-white active:opacity-70"
              type="button"
              onClick={() => document.getElementById("code-entry")?.scrollIntoView({ behavior: "smooth", block: "start" })}
            >
              <svg className="h-6 w-6 stroke-current" fill="none" strokeLinecap="round" strokeLinejoin="round" strokeWidth="2.2" viewBox="0 0 24 24" aria-hidden="true">
                <rect height="7" rx="1.5" width="7" x="3" y="3" />
                <rect height="7" rx="1.5" width="7" x="14" y="3" />
                <rect height="7" rx="1.5" width="7" x="3" y="14" />
                <rect fill="currentColor" height="3" stroke="none" width="3" x="14" y="14" />
                <rect fill="currentColor" height="3" stroke="none" width="3" x="18" y="18" />
                <rect fill="currentColor" height="1.5" stroke="none" width="3" x="18" y="14" />
              </svg>
            </button>

            <div className="relative -top-2 flex items-center justify-center">
              <div className="flex h-16 w-16 items-center justify-center rounded-full bg-[#18191B] p-1.5 shadow-lg">
                <button
                  aria-label="Scan QR Code"
                  className="flex h-full w-full items-center justify-center rounded-full bg-[#FDB714] shadow-md transition-all hover:bg-[#eab015] active:scale-95"
                  type="button"
                  onClick={() => { if (!live) resetScan(); }}
                >
                  <svg className="h-7 w-7 text-black stroke-current" fill="none" strokeLinecap="round" strokeLinejoin="round" strokeWidth="2.6" viewBox="0 0 24 24" aria-hidden="true">
                    <path d="M4 8V5a1 1 0 0 1 1-1h3" />
                    <path d="M16 4h3a1 1 0 0 1 1 1v3" />
                    <path d="M4 16v3a1 1 0 0 0 1 1h3" />
                    <path d="M16 20h3a1 1 0 0 0 1-1v-3" />
                    <line strokeWidth="2.2" x1="8" x2="16" y1="12" y2="12" />
                  </svg>
                </button>
              </div>
            </div>

            <button
              aria-label="Scan History"
              className="mt-3 flex flex-col items-center justify-center text-white/40 cursor-default"
              type="button"
              disabled
            >
              <svg className="h-6 w-6 stroke-current" fill="none" strokeLinecap="round" strokeLinejoin="round" strokeWidth="2.2" viewBox="0 0 24 24" aria-hidden="true">
                <path d="M3 12a9 9 0 1 0 2.64-6.36L3 8" />
                <path d="M3 3v5h5" />
                <path d="M12 7v5l3 2" />
              </svg>
            </button>
          </div>
        </footer>
      </main>

      <section id="code-entry" className="bg-[#0f1013] px-4 py-8 sm:px-6 sm:py-10 border-t border-white/10">
        <div className="mx-auto w-full max-w-2xl">
          <div className="flex items-center justify-center my-1 mb-6">
            <div className="h-[1px] flex-1 bg-white/15"></div>
            <span className="px-4 text-xs font-semibold tracking-[0.2em] text-white/60 uppercase">Enter Code</span>
            <div className="h-[1px] flex-1 bg-white/15"></div>
          </div>

          <form
            onSubmit={handleVerify}
            noValidate
            className="mx-auto w-full max-w-xl rounded-2xl border border-white/10 bg-[#18191B] p-5 sm:p-6 shadow-xl"
          >
            <div className="mb-4 flex items-start justify-between gap-3">
              <div>
                <label className="block text-lg font-semibold text-white" htmlFor="otp-input-field">
                  Prescription Code
                </label>
                <p className="mt-1 text-sm text-white/60">
                  The 6-digit code is in the patient&apos;s code from Endod
                </p>
              </div>
              <MessageSquare size={24} className="mt-1 text-[#FDB714]" />
            </div>

            <input
              aria-label="Enter 6 digit prescription code"
              id="otp-input-field"
              name="code"
              type="tel"
              inputMode="numeric"
              autoComplete="off"
              maxLength={6}
              value={otp}
              onChange={(e) => handleOtpChange(e.target.value)}
              className="sr-only"
            />
            <div
              className="mx-auto my-5 grid max-w-sm cursor-pointer grid-cols-6 gap-2 sm:gap-3"
              onClick={() => document.getElementById("otp-input-field")?.focus()}
              aria-hidden="true"
            >
              {Array.from({ length: 6 }).map((_, i) => {
                const ch = otpChars[i];
                const isCursor = i === otpChars.length;
                return (
                  <div
                    key={i}
                    className={`flex h-14 items-center justify-center rounded-xl text-xl font-semibold shadow-inner transition-all ${
                      ch !== undefined
                        ? "bg-[#24262a] text-white border border-[#FDB714]/30"
                        : isCursor
                          ? "bg-[#24262a] text-[#FDB714] border border-[#FDB714]/60"
                          : "bg-[#1f2023] text-white/30 border border-white/10"
                    }`}
                  >
                    {ch !== undefined ? ch : isCursor ? <span className="h-6 w-0.5 animate-pulse bg-[#FDB714]" /> : <span className="h-2 w-2 rounded-full bg-white/20" />}
                  </div>
                );
              })}
            </div>

            {codeError && (
              <div
                role="alert"
                data-testid="code-error"
                className="mx-auto mt-2 max-w-sm rounded-lg border border-red-400/30 bg-red-500/15 px-3 py-2 text-sm text-red-50"
              >
                {codeError}
              </div>
            )}

            <div className="pt-5">
              <button
                type="submit"
                disabled={verifying}
                className="mx-auto flex h-12 w-fit items-center justify-center gap-2 rounded-xl bg-[#FDB714] px-10 text-base font-semibold text-[#18191B] shadow-sm transition-all hover:bg-[#eab015] active:scale-[0.98] disabled:opacity-60"
              >
                <CheckCircle size={20} />
                <span>{verifying ? "Looking up..." : "Find Prescription"}</span>
              </button>
            </div>
          </form>
        </div>
      </section>
    </div>
  );
}
