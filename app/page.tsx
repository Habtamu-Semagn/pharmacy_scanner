"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import Image from "next/image";
import { useRouter } from "next/navigation";
import { BrowserQRCodeReader } from "@zxing/browser";
import type { IScannerControls } from "@zxing/browser";
import type { Result } from "@zxing/library";
import { CODE_RE, tokenFromScan } from "@/lib/rx";
import { lookup, saveCodeLookup } from "@/lib/client";
import {
  AlertCircle,
  CheckCircle,
  Crosshair,
  Flashlight,
  FlashlightOff,
  Images,
  MessageSquare,
  RefreshCw,
  ScanLine,
  SwitchCamera,
} from "lucide-react";

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

export default function Home() {
  const router = useRouter();
  const videoRef = useRef<HTMLVideoElement>(null);
  const controlsRef = useRef<IScannerControls | null>(null);
  const readerRef = useRef<BrowserQRCodeReader | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);
  // Bumped on every stop; a camera start that resolves after a stop is discarded.
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
          // NotFoundException is reported on every empty frame; ignore it.
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
          // Stopped (navigation, unmount, new start) while the camera was opening.
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

  // Start on mount; stop on unmount and when Next hides this route on navigation.
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

  return (
    <div className="flex flex-col min-h-screen bg-surface text-on-surface">
      <header className="fixed top-0 w-full z-50 bg-surface/85 backdrop-blur-xl pt-safe shadow-[0_1px_8px_rgba(0,0,0,0.04)]">
        <div className="h-16 px-space-lg flex items-center justify-between gap-space-sm">
          <div className="flex items-center gap-space-sm min-w-0 flex-1">
            <Image
              src="/endod_logo.jpeg"
              alt="Endod Health"
              width={48}
              height={48}
              priority
              unoptimized
              className="h-12 w-auto object-contain flex-shrink-0 bg-transparent mix-blend-multiply"
            />
            <div className="flex flex-col min-w-0">
              <span className="font-headline-sm text-headline-sm text-on-surface truncate">Endod Health</span>
              <div className="flex items-center gap-1">
                <span className="relative flex h-2 w-2">
                  {live && (
                    <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-black opacity-75"></span>
                  )}
                  <span className="relative inline-flex rounded-full h-2 w-2 bg-black"></span>
                </span>
              </div>
            </div>
          </div>
        </div>
      </header>

      <main className="flex-1 w-full bg-surface pt-20 pb-8 flex flex-col">
        <div className="flex flex-col w-full max-w-md md:max-w-lg lg:max-w-2xl mx-auto px-space-lg lg:px-space-xl space-y-space-lg lg:space-y-space-xl pb-space-xl">
          {/* Scanner card */}
          <div className="w-full max-w-md md:max-w-lg lg:max-w-2xl mx-auto bg-surface-container-lowest rounded-xl p-space-lg lg:p-space-xl shadow-sm flex flex-col items-center">
            <div className="w-full flex items-center justify-between mb-space-sm px-1">
              <div className="flex items-center gap-1.5 text-black">
                <ScanLine size={18} />
                <span className="font-label-lg text-label-lg">Scan prescription QR</span>
              </div>
              <span className="bg-surface-container text-on-surface-variant font-label-sm text-label-sm px-2.5 py-1 rounded-full">
                {live ? "Live" : status === "found" ? "Locked" : "Idle"}
              </span>
            </div>

            <div className="relative w-full aspect-[4/3] max-w-sm md:max-w-md lg:max-w-lg rounded-xl overflow-hidden bg-inverse-surface shadow-md flex items-center justify-center">
              <video
                ref={videoRef}
                className="absolute inset-0 w-full h-full object-cover"
                muted
                playsInline
                autoPlay
              />
              <div className="relative w-48 h-48 sm:w-56 sm:h-56 flex items-center justify-center pointer-events-none">
                <div className="absolute top-0 left-0 w-6 h-6 border-t-4 border-l-4 border-black rounded-tl-lg shadow-[0_0_8px_rgba(0,0,0,0.4)]"></div>
                <div className="absolute top-0 right-0 w-6 h-6 border-t-4 border-r-4 border-black rounded-tr-lg shadow-[0_0_8px_rgba(0,0,0,0.4)]"></div>
                <div className="absolute bottom-0 left-0 w-6 h-6 border-b-4 border-l-4 border-black rounded-bl-lg shadow-[0_0_8px_rgba(0,0,0,0.4)]"></div>
                <div className="absolute bottom-0 right-0 w-6 h-6 border-b-4 border-r-4 border-black rounded-br-lg shadow-[0_0_8px_rgba(0,0,0,0.4)]"></div>
                {status === "scanning" && (
                  <div className="absolute left-2 right-2 h-0.5 bg-gradient-to-r from-transparent via-black to-transparent shadow-[0_0_12px_rgba(0,0,0,0.4)] animate-pulse" />
                )}
              </div>
              {!live && (
                <div className="absolute inset-0 flex items-center justify-center bg-inverse-surface/60">
                  <span className="font-label-md text-label-md text-inverse-on-surface px-4 text-center">
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
              <div className="absolute top-3 right-3 flex items-center gap-2">
                {torchSupported && (
                  <button
                    type="button"
                    aria-label="Toggle Torch"
                    onClick={handleTorch}
                    className={`w-9 h-9 rounded-full flex items-center justify-center transition-all active:scale-95 shadow-sm ${
                      torchOn ? "bg-black text-white hover:bg-gray-800" : "bg-black/75 text-white hover:bg-black"
                    }`}
                  >
                    {torchOn ? <Flashlight size={18} /> : <FlashlightOff size={18} />}
                  </button>
                )}
                {devices.length > 1 && live && (
                  <button
                    type="button"
                    aria-label="Switch Camera"
                    onClick={handleSwitchCamera}
                    className="w-9 h-9 rounded-full bg-black/75 text-white flex items-center justify-center hover:bg-black transition-all active:scale-95 shadow-sm"
                  >
                    <SwitchCamera size={18} />
                  </button>
                )}
              </div>
            </div>

            <div className="w-full mt-space-md flex flex-col sm:flex-row items-center justify-between gap-space-sm">
              <div className="flex items-center gap-1.5 text-black" role="status" aria-live="polite">
                {status === "found" ? (
                    <CheckCircle size={18} />
                  ) : status === "error" || status === "rejected" ? (
                    <AlertCircle size={18} />
                  ) : (
                    <Crosshair size={18} />
                  )}
                <span className="font-label-sm text-label-sm" data-testid="scan-message">{message}</span>
              </div>
              <div className="flex items-center gap-2">
                <input
                  ref={fileInputRef}
                  type="file"
                  accept="image/*"
                  className="hidden"
                  data-testid="qr-upload"
                  onChange={handleFileUpload}
                />
                <button
                  type="button"
                  onClick={() => fileInputRef.current?.click()}
                  className="px-4 py-2 bg-black text-white font-label-md text-label-md rounded-xl hover:bg-gray-800 transition-colors flex items-center justify-center gap-1.5"
                >
                  <Images size={18} />
                  <span>Upload QR</span>
                </button>
                {!live && (
                  <button
                    type="button"
                    onClick={resetScan}
                    className="px-4 py-2 bg-black text-white font-label-md text-label-md rounded-xl hover:bg-gray-800 transition-colors flex items-center justify-center gap-1.5"
                  >
                    <RefreshCw size={18} />
                    <span>Rescan</span>
                  </button>
                )}
              </div>
            </div>

            {error && (
              <div
                role="alert"
                data-testid="scan-error"
                className="w-full max-w-md md:max-w-lg lg:max-w-2xl mx-auto mt-space-sm text-error font-body-sm text-body-sm bg-error-container/40 rounded-lg px-3 py-2"
              >
                {error}
              </div>
            )}
          </div>

          {/* SMS code */}
          <div className="flex items-center justify-center my-1">
            <div className="h-[1px] bg-outline-variant/40 flex-1"></div>
            <span className="px-space-md font-label-sm text-label-sm text-outline tracking-widest uppercase">
              ENTER CODE
            </span>
            <div className="h-[1px] bg-outline-variant/40 flex-1"></div>
          </div>

          <form
            onSubmit={handleVerify}
            noValidate
            className="w-full max-w-md md:max-w-lg lg:max-w-2xl mx-auto bg-surface-container-lowest rounded-xl p-space-lg lg:p-space-xl shadow-sm"
          >
            <div className="flex items-start justify-between gap-2 mb-space-sm">
              <div>
                <label className="font-headline-sm text-headline-sm text-on-surface block" htmlFor="otp-input-field">
                  Prescription Code
                </label>
                <p className="font-body-sm text-body-sm text-on-surface-variant mt-0.5">
                  The 6-digit code is in the patient&apos;s code from Endod
                </p>
              </div>
              <MessageSquare size={24} className="text-black" />
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
              className="grid grid-cols-6 gap-2 sm:gap-space-sm my-space-md max-w-sm mx-auto cursor-pointer"
              onClick={() => document.getElementById("otp-input-field")?.focus()}
              aria-hidden="true"
            >
              {Array.from({ length: 6 }).map((_, i) => {
                const ch = otpChars[i];
                const isCursor = i === otpChars.length;
                let cls = "h-14 rounded-xl flex items-center justify-center font-headline-md text-headline-md shadow-inner transition-all";
                if (ch !== undefined) {
                  cls += " bg-surface-container-low text-on-surface";
                } else if (isCursor) {
                  cls += " bg-surface-container-highest text-black shadow-sm relative";
                } else {
                  cls += " bg-surface-container-lowest text-on-surface-variant/40";
                }
                return (
                  <div key={i} className={cls}>
                    {ch !== undefined ? (
                      ch
                    ) : isCursor ? (
                      <span className="animate-pulse w-0.5 h-6 bg-black" />
                    ) : (
                      <span className="w-2 h-2 rounded-full bg-outline-variant/50" />
                    )}
                  </div>
                );
              })}
            </div>



            {codeError && (
              <div
                role="alert"
                data-testid="code-error"
                className="max-w-sm mx-auto mt-space-sm text-error font-body-sm text-body-sm bg-error-container/40 rounded-lg px-3 py-2"
              >
                {codeError}
              </div>
            )}

            <div className="space-y-space-sm pt-space-md">
              <button
                type="submit"
                disabled={verifying}
                className="mx-auto w-fit h-12 px-10 rounded-xl font-label-lg text-label-lg shadow-sm flex items-center justify-center gap-space-xs transition-all active:scale-[0.98] bg-black text-white hover:bg-gray-800 disabled:opacity-60"
              >
                <CheckCircle size={20} />
                <span>{verifying ? "Looking up..." : "Find Prescription"}</span>
              </button>
            </div>
          </form>
        </div>
      </main>
    </div>
  );
}
