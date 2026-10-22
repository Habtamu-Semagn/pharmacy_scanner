"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { BrowserQRCodeReader } from "@zxing/browser";
import type { IScannerControls } from "@zxing/browser";
import type { Result } from "@zxing/library";

type ScanStatus = "idle" | "scanning" | "success" | "error";

export default function Home() {
  const videoRef = useRef<HTMLVideoElement>(null);
  const controlsRef = useRef<IScannerControls | null>(null);
  const readerRef = useRef<BrowserQRCodeReader | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);

  const [devices, setDevices] = useState<MediaDeviceInfo[]>([]);
  const [deviceId, setDeviceId] = useState<string | undefined>(undefined);
  const [torchOn, setTorchOn] = useState(false);
  const [torchSupported, setTorchSupported] = useState(false);
  const [status, setStatus] = useState<ScanStatus>("idle");
  const [message, setMessage] = useState<string>("Ready to scan");
  const [scanResult, setScanResult] = useState<string | null>(null);
  const [otp, setOtp] = useState("");
  const [verifying, setVerifying] = useState(false);
  const [verified, setVerified] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const stopScanner = useCallback(() => {
    try {
      controlsRef.current?.stop();
    } catch {
      /* ignore */
    }
    controlsRef.current = null;
    if (videoRef.current) {
      const src = videoRef.current.srcObject as MediaStream | null;
      src?.getTracks().forEach((t) => t.stop());
      videoRef.current.srcObject = null;
    }
  }, []);

  const startScanner = useCallback(
    async (targetDeviceId?: string) => {
      setError(null);
      setStatus("scanning");
      setMessage("Starting camera...");
      stopScanner();
      try {
        if (!readerRef.current) readerRef.current = new BrowserQRCodeReader();
        const reader = readerRef.current;
        const controls = await reader.decodeFromVideoDevice(
          targetDeviceId,
          videoRef.current as HTMLVideoElement,
          (result: Result | undefined, _err: unknown) => {
             void _err;
            if (result) {
              const text = result.getText();
              setScanResult(text);
              setStatus("success");
              setMessage("QR code detected");
              stopScanner();
            }
            // NotFoundException is expected while scanning; ignore silently
          }
        );
        controlsRef.current = controls;
        setMessage("Scanning for QR code...");
        // torch support
        const stream = videoRef.current?.srcObject as MediaStream | null;
        const track = stream?.getVideoTracks()?.[0];
        setTorchSupported(
          !!track && (track.getCapabilities?.() as { torch?: boolean } | undefined)?.torch === true
        );
      } catch (e) {
        setStatus("error");
        setError(e instanceof Error ? e.message : "Camera access failed");
        setMessage("Camera unavailable");
      }
    },
    [stopScanner]
  );

  // enumerate devices
  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        // request permission first to get labels
        const stream = await navigator.mediaDevices.getUserMedia({ video: true });
        stream.getTracks().forEach((t) => t.stop());
        const devs = await navigator.mediaDevices.enumerateDevices();
        if (cancelled) return;
        const videos = devs.filter((d) => d.kind === "videoinput");
        setDevices(videos);
        const back = videos.find((d) => /back|rear|environment/i.test(d.label));
        const chosen = back?.deviceId ?? videos[0]?.deviceId;
        setDeviceId(chosen);
        if (chosen) {
          setTimeout(() => startScanner(chosen), 0);
        }
      } catch (e) {
        setError(e instanceof Error ? e.message : "Permission denied");
      }
    })();
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    return () => stopScanner();
  }, [stopScanner]);

  const handleSwitchCamera = async () => {
    if (devices.length < 2) return;
    const idx = devices.findIndex((d) => d.deviceId === deviceId);
    const next = devices[(idx + 1) % devices.length];
    setDeviceId(next.deviceId);
    setTorchOn(false);
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
    } catch (e) {
      setError(e instanceof Error ? e.message : "Torch not supported");
    }
  };

  const handleFileUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    setError(null);
    setStatus("scanning");
    setMessage("Decoding image...");
    try {
      if (!readerRef.current) readerRef.current = new BrowserQRCodeReader();
      const url = URL.createObjectURL(file);
      const img = new Image();
      img.src = url;
      await new Promise<void>((res, rej) => {
        img.onload = () => res();
        img.onerror = () => rej(new Error("Image load failed"));
      });
      const result = await readerRef.current.decodeFromImageElement(img);
      setScanResult(result.getText());
      setStatus("success");
      setMessage("QR code detected");
      URL.revokeObjectURL(url);
    } catch (err) {
      setStatus("error");
      setError(err instanceof Error ? err.message : "No QR code found");
      setMessage("Decode failed");
    } finally {
      if (fileInputRef.current) fileInputRef.current.value = "";
    }
  };

  const handleOtpChange = (val: string) => {
    const cleaned = val.replace(/\D/g, "").slice(0, 6);
    setOtp(cleaned);
    if (verified) setVerified(false);
  };

  const handleVerify = async () => {
    if (otp.length < 6 && !scanResult) {
      setError("Enter 6-digit code or scan a QR code");
      return;
    }
    setVerifying(true);
    setError(null);
    // simulate verification
    await new Promise((r) => setTimeout(r, 800));
    setVerifying(false);
    setVerified(true);
    setMessage("Prescription verified");
  };

  const handleResend = () => {
    setMessage("New SMS code sent");
    setTimeout(() => setMessage("Ready to verify"), 3000);
  };

  const resetScan = () => {
    setScanResult(null);
    setVerified(false);
    setStatus("idle");
    setOtp("");
    if (deviceId) startScanner(deviceId);
  };

  const otpChars = otp.split("");

  return (
    <div className="flex flex-col min-h-screen bg-surface text-on-surface">
      <header className="fixed top-0 w-full z-50 bg-surface/85 backdrop-blur-xl pt-safe shadow-[0_1px_8px_rgba(0,0,0,0.04)]">
        <div className="h-16 px-space-lg flex items-center justify-between gap-space-sm">
          <div className="flex items-center gap-space-sm min-w-0 flex-1">
            <div className="w-8 h-8 rounded-xl bg-primary flex items-center justify-center flex-shrink-0">
              <span className="material-symbols-outlined text-on-primary text-[18px]">medication</span>
            </div>
            <div className="flex flex-col min-w-0">
              <span className="font-headline-sm text-headline-sm text-on-surface truncate">PharmaVerify</span>
              <div className="flex items-center gap-1">
                <span className="relative flex h-2 w-2">
                  {status === "scanning" && (
                    <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-secondary opacity-75"></span>
                  )}
                  <span className="relative inline-flex rounded-full h-2 w-2 bg-secondary"></span>
                </span>
                <span className="font-label-sm text-label-sm text-secondary truncate">
                  {status === "scanning" ? "Scanning" : status === "success" ? "Scan locked" : "Idle"}
                </span>
              </div>
            </div>
          </div>
          <div className="flex items-center gap-space-xs flex-shrink-0">
            <div className="w-8 h-8 rounded-full bg-primary flex items-center justify-center">
              <span className="material-symbols-outlined text-on-primary text-[18px]">person</span>
            </div>
          </div>
        </div>
      </header>

      <main className="flex-1 w-full bg-surface pt-20 pb-8 flex flex-col">
        <div className="flex flex-col w-full max-w-md md:max-w-lg lg:max-w-2xl mx-auto px-space-lg lg:px-space-xl space-y-space-lg lg:space-y-space-xl pb-space-xl">
          {/* Scanner card */}
          <div className="w-full max-w-md md:max-w-lg lg:max-w-2xl mx-auto bg-surface-container-lowest rounded-xl p-space-lg lg:p-space-xl shadow-sm flex flex-col items-center">
            <div className="w-full flex items-center justify-between mb-space-sm px-1">
              <div className="flex items-center gap-1.5 text-primary">
                <span className="material-symbols-outlined text-[18px]">document_scanner</span>
                <span className="font-label-lg text-label-lg">Optical Rx Sensor</span>
              </div>
              <span className="bg-surface-container text-on-surface-variant font-label-sm text-label-sm px-2.5 py-1 rounded-full">
                {status === "scanning" ? "Live" : status === "success" ? "Locked" : "Idle"}
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
                <div className="absolute top-0 left-0 w-6 h-6 border-t-4 border-l-4 border-primary-fixed rounded-tl-lg shadow-[0_0_8px_rgba(137,245,231,0.6)]"></div>
                <div className="absolute top-0 right-0 w-6 h-6 border-t-4 border-r-4 border-primary-fixed rounded-tr-lg shadow-[0_0_8px_rgba(137,245,231,0.6)]"></div>
                <div className="absolute bottom-0 left-0 w-6 h-6 border-b-4 border-l-4 border-primary-fixed rounded-bl-lg shadow-[0_0_8px_rgba(137,245,231,0.6)]"></div>
                <div className="absolute bottom-0 right-0 w-6 h-6 border-b-4 border-r-4 border-primary-fixed rounded-br-lg shadow-[0_0_8px_rgba(137,245,231,0.6)]"></div>
                {status === "scanning" && (
                  <div className="absolute left-2 right-2 h-0.5 bg-gradient-to-r from-transparent via-secondary-fixed to-transparent shadow-[0_0_12px_#85f8c4] animate-pulse" />
                )}
              </div>
              {status !== "scanning" && (
                <div className="absolute inset-0 flex items-center justify-center bg-inverse-surface/60">
                  <span className="font-label-md text-label-md text-inverse-on-surface">
                    {status === "success" ? "Scan complete" : status === "error" ? "Camera error" : "Idle"}
                  </span>
                </div>
              )}
              <div className="absolute top-3 right-3 flex items-center gap-2">
                {torchSupported && (
                  <button
                    aria-label="Toggle Torch"
                    onClick={handleTorch}
                    className={`w-9 h-9 rounded-full flex items-center justify-center transition-all active:scale-95 shadow-sm ${
                      torchOn
                        ? "bg-primary text-on-primary"
                        : "bg-inverse-surface/75 text-inverse-on-surface hover:bg-inverse-surface"
                    }`}
                  >
                    <span className="material-symbols-outlined text-[18px]">{torchOn ? "flash_on" : "flash_off"}</span>
                  </button>
                )}
                {devices.length > 1 && (
                  <button
                    aria-label="Switch Camera"
                    onClick={handleSwitchCamera}
                    className="w-9 h-9 rounded-full bg-inverse-surface/75 text-inverse-on-surface flex items-center justify-center hover:bg-inverse-surface transition-all active:scale-95 shadow-sm"
                  >
                    <span className="material-symbols-outlined text-[18px]">flip_camera_ios</span>
                  </button>
                )}
              </div>
            </div>

            <div className="w-full mt-space-md flex flex-col sm:flex-row items-center justify-between gap-space-sm">
              <div className="flex items-center gap-1.5 text-secondary">
                <span className="material-symbols-outlined text-[18px]">
                  {status === "success" ? "check_circle" : status === "error" ? "error" : "center_focus_strong"}
                </span>
                <span className="font-label-sm text-label-sm">{message}</span>
              </div>
              <div className="flex items-center gap-2">
                <input
                  ref={fileInputRef}
                  type="file"
                  accept="image/*"
                  className="hidden"
                  onChange={handleFileUpload}
                />
                <button
                  onClick={() => fileInputRef.current?.click()}
                  className="px-4 py-2 bg-surface-container text-on-surface font-label-md text-label-md rounded-xl hover:bg-surface-container-high transition-colors flex items-center justify-center gap-1.5"
                >
                  <span className="material-symbols-outlined text-[18px]">photo_library</span>
                  <span>Upload QR</span>
                </button>
                {status !== "scanning" && (
                  <button
                    onClick={resetScan}
                    className="px-4 py-2 bg-primary text-on-primary font-label-md text-label-md rounded-xl hover:bg-primary-container transition-colors flex items-center justify-center gap-1.5"
                  >
                    <span className="material-symbols-outlined text-[18px]">refresh</span>
                    <span>Rescan</span>
                  </button>
                )}
              </div>
            </div>

            {error && (
              <div className="w-full max-w-md md:max-w-lg lg:max-w-2xl mx-auto mt-space-sm text-error font-body-sm text-body-sm bg-error-container/40 rounded-lg px-3 py-2">
                {error}
              </div>
            )}
          </div>

          {/* SMS code */}
          <div className="flex items-center justify-center my-1">
            <div className="h-[1px] bg-outline-variant/40 flex-1"></div>
            <span className="px-space-md font-label-sm text-label-sm text-outline tracking-widest uppercase">
              OR ENTER SMS CODE
            </span>
            <div className="h-[1px] bg-outline-variant/40 flex-1"></div>
          </div>

          <div className="w-full max-w-md md:max-w-lg lg:max-w-2xl mx-auto bg-surface-container-lowest rounded-xl p-space-lg lg:p-space-xl shadow-sm">
            <div className="flex items-start justify-between gap-2 mb-space-sm">
              <div>
                <label className="font-headline-sm text-headline-sm text-on-surface block" htmlFor="otp-input-field">
                  Patient SMS Verification Code
                </label>
                <p className="font-body-sm text-body-sm text-on-surface-variant mt-0.5">
                  Sent to patient phone on file
                </p>
              </div>
              <span className="material-symbols-outlined text-primary text-[24px]">sms</span>
            </div>
            <input
              aria-label="Enter 6 digit authorization code"
              id="otp-input-field"
              type="tel"
              inputMode="numeric"
              maxLength={6}
              value={otp}
              onChange={(e) => handleOtpChange(e.target.value)}
              className="sr-only"
              autoFocus
            />
            <div
              className="grid grid-cols-6 gap-2 sm:gap-space-sm my-space-md max-w-sm mx-auto cursor-pointer"
              onClick={() => document.getElementById("otp-input-field")?.focus()}
            >
              {Array.from({ length: 6 }).map((_, i) => {
                const ch = otpChars[i];
                const isCursor = i === otpChars.length;
                let cls = "h-14 rounded-xl flex items-center justify-center font-headline-md text-headline-md shadow-inner transition-all";
                if (ch !== undefined) {
                  cls += " bg-surface-container-low text-on-surface";
                } else if (isCursor) {
                  cls += " bg-surface-container-highest text-primary shadow-sm relative";
                } else {
                  cls += " bg-surface-container-lowest text-on-surface-variant/40";
                }
                return (
                  <div key={i} className={cls}>
                    {ch !== undefined ? (
                      ch
                    ) : isCursor ? (
                      <span className="animate-pulse w-0.5 h-6 bg-primary" />
                    ) : (
                      <span className="w-2 h-2 rounded-full bg-outline-variant/50" />
                    )}
                  </div>
                );
              })}
            </div>
            <div className="space-y-space-sm pt-2">
              <button
                onClick={handleVerify}
                disabled={verifying}
                className={`mx-auto w-fit h-12 px-10 rounded-xl font-label-lg text-label-lg shadow-sm flex items-center justify-center gap-space-xs transition-all active:scale-[0.98] ${
                  verified
                    ? "bg-secondary text-on-secondary"
                    : "bg-primary text-on-primary hover:bg-primary-container"
                } disabled:opacity-60`}
              >
                <span className="material-symbols-outlined text-[20px]">
                  {verified ? "check" : "task_alt"}
                </span>
                <span>{verified ? "Prescription Verified!" : verifying ? "Verifying..." : "Verify & Release Prescription"}</span>
              </button>
              <div className="flex items-center justify-center pt-1 px-1">
                <button
                  onClick={handleResend}
                  className="font-label-md text-label-md text-primary hover:text-primary-container flex items-center gap-1 transition-colors py-1"
                >
                  <span className="material-symbols-outlined text-[16px]">refresh</span>
                  <span>Resend SMS code</span>
                </button>
              </div>
            </div>
          </div>

          {/* Result card */}
          {(scanResult || verified) && (
            <div className="w-full max-w-md md:max-w-lg lg:max-w-2xl mx-auto bg-surface-container-low rounded-xl p-space-lg lg:p-space-xl shadow-sm">
              <div className="flex items-center justify-between mb-space-xs">
                <div className="flex items-center gap-1.5 text-secondary">
                  <span className="material-symbols-outlined text-[18px]">lock</span>
                  <span className="font-label-sm text-label-sm uppercase tracking-wide">Rx Match Identified</span>
                </div>
                <span className="font-label-sm text-label-sm bg-primary-fixed text-on-primary-fixed-variant px-2 py-0.5 rounded-full font-semibold">
                  {verified ? "Released" : "Ready for Pickup"}
                </span>
              </div>
              <div className="bg-surface-container-lowest rounded-xl p-space-sm mt-space-xs shadow-sm flex items-center justify-between gap-space-sm">
                <div className="flex items-center gap-space-sm min-w-0">
                  <div className="w-10 h-10 rounded-full bg-tertiary-fixed text-on-tertiary-fixed flex items-center justify-center font-label-lg text-label-lg flex-shrink-0">
                    RX
                  </div>
                  <div className="min-w-0">
                    <div className="flex items-center gap-space-xs truncate">
                      <span className="font-label-lg text-label-lg text-on-surface truncate">
                        {scanResult ? "Scanned Code" : "SMS Verified"}
                      </span>
                    </div>
                    <div className="flex items-center gap-space-xs text-on-surface-variant font-body-sm text-body-sm truncate">
                      <span className="font-label-md text-label-md text-tertiary">{scanResult ?? `Code: ${otp}`}</span>
                    </div>
                  </div>
                </div>
              </div>
            </div>
          )}
        </div>
      </main>
    </div>
  );
}
