"use client";

import Image from "next/image";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useMemo, useRef, useState } from "react";
import {
  formatDate,
  formatDateTime,
  formatQty,
  isToken,
  remaining,
  type Prescription,
  type RxItem,
  type RxRef,
  type RxStatus,
} from "@/lib/rx";
import {
  clearCodeLookup,
  dispense,
  lookup,
  newIdempotencyKey,
  readCodeLookup,
  rememberPharmacy,
  rememberedPharmacy,
  saveCodeLookup,
  type DispenseRequest,
} from "@/lib/client";

const STATUS_LABEL: Record<RxStatus, string> = {
  open: "Open",
  completed: "Completed",
  expired: "Expired",
  retracted: "Retracted",
};

const STATUS_BADGE: Record<RxStatus, string> = {
  open: "bg-emerald-500/15 text-emerald-200 border-emerald-400/30",
  completed: "bg-slate-400/15 text-slate-200 border-slate-300/30",
  expired: "bg-amber-500/15 text-amber-200 border-amber-400/30",
  retracted: "bg-red-500/15 text-red-200 border-red-400/30",
};

const MED_IMAGES = ["/medicine_1.png", "/medicine_2.png", "/medicine_3.png", "/medicine_4.png"];

function closedMessage(rx: Prescription): string | null {
  switch (rx.status) {
    case "completed":
      return "Everything on this prescription has been given. Nothing more can be dispensed.";
    case "expired":
      return `This prescription expired on ${formatDate(rx.expires_at)}. It can no longer be dispensed; the patient needs a new prescription.`;
    case "retracted":
      return "The hospital has withdrawn this prescription. Do not dispense anything from it.";
    default:
      return null;
  }
}

function itemProgress(item: RxItem): string {
  if (item.status === "given") return "Given";
  if (item.quantity_total !== null) {
    const given = item.given_total ?? 0;
    if (given === 0) return `Not given yet (0 of ${formatQty(item.quantity_total)})`;
    return `${formatQty(given)} of ${formatQty(item.quantity_total)} given, ${formatQty(remaining(item))} left`;
  }
  return item.status === "partly_given" ? "Partly given" : "Not given yet";
}

type Phase =
  | { name: "loading" }
  | { name: "error"; message: string; noCode?: boolean }
  | { name: "ready" };

interface Line {
  item: RxItem;
  amount: number | null;
  complete: boolean;
}

function MedicineCarousel() {
  const [index, setIndex] = useState(0);

  useEffect(() => {
    const id = window.setInterval(() => {
      setIndex((i) => (i + 1) % MED_IMAGES.length);
    }, 3000);
    return () => window.clearInterval(id);
  }, []);

  return (
    <div className="relative h-44 w-full overflow-hidden rounded-2xl bg-black sm:h-52">
      <Image
        src={MED_IMAGES[index]}
        alt=""
        fill
        sizes="(max-width: 640px) 100vw, 480px"
        className="object-cover"
        priority
      />
      <div
        className="absolute bottom-3 left-1/2 z-10 flex -translate-x-1/2 items-center gap-2.5"
        aria-label="Image progress"
      >
        {MED_IMAGES.map((_, i) => (
          <button
            key={i}
            type="button"
            aria-label={`Show image ${i + 1}`}
            onClick={() => setIndex(i)}
            className={`h-3 w-3 rounded-full transition-all ${
              i === index ? "border border-white bg-white" : "border border-black/40 bg-transparent"
            }`}
          />
        ))}
      </div>
    </div>
  );
}

export default function PrescriptionScreen({ token }: { token: string | null }) {
  const router = useRouter();
  const [phase, setPhase] = useState<Phase>({ name: "loading" });
  const [rx, setRx] = useState<Prescription | null>(null);
  const [ref, setRef] = useState<RxRef | null>(null);

  const [amounts, setAmounts] = useState<Record<number, string>>({});
  const [fully, setFully] = useState<Record<number, boolean>>({});
  const [pharmacyName, setPharmacyName] = useState("");
  const [pharmacistName, setPharmacistName] = useState("");
  const [step, setStep] = useState<"edit" | "confirm">("edit");
  const [sending, setSending] = useState(false);
  const [formError, setFormError] = useState<string | null>(null);
  const [canRetry, setCanRetry] = useState(false);
  const [success, setSuccess] = useState<string | null>(null);

  const pendingRef = useRef<{ key: string; fingerprint: string } | null>(null);
  const sendingRef = useRef(false);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      const name = rememberedPharmacy();
      if (token === null) {
        const saved = readCodeLookup();
        if (cancelled) return;
        setPharmacyName((n) => n || name);
        if (!saved) {
          setPhase({
            name: "error",
            noCode: true,
            message: "Enter the prescription code on the scanner page.",
          });
          return;
        }
        setRef(saved.ref);
        setRx(saved.rx);
        setPhase({ name: "ready" });
        return;
      }
      if (!isToken(token)) {
        setPhase({ name: "error", message: "This link is not a valid Endod prescription." });
        return;
      }
      const r: RxRef = { token };
      const result = await lookup(r);
      if (cancelled) return;
      setPharmacyName((n) => n || name);
      setRef(r);
      if (result.ok) {
        setRx(result.prescription);
        setPhase({ name: "ready" });
      } else {
        setPhase({ name: "error", message: result.error });
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [token]);

  const resetSubmission = () => {
    setCanRetry(false);
    setFormError(null);
    setSuccess(null);
  };

  const open = rx?.status === "open";

  const lines: Line[] = useMemo(() => {
    if (!rx) return [];
    return rx.items.flatMap((item): Line[] => {
      if (item.status === "given") return [];
      if (item.quantity_total !== null) {
        const raw = (amounts[item.item_index] ?? "").trim();
        if (!raw) return [];
        return [{ item, amount: Number(raw), complete: false }];
      }
      return fully[item.item_index] ? [{ item, amount: null, complete: true }] : [];
    });
  }, [rx, amounts, fully]);

  const validate = (): string | null => {
    const name = pharmacyName.trim();
    if (name.length < 2 || name.length > 120) return "Enter the pharmacy name.";
    if (pharmacistName.trim().length > 120) return "The pharmacist name is too long.";
    if (lines.length === 0) return "Enter what is given now for at least one item.";
    for (const l of lines) {
      if (l.amount !== null) {
        const left = remaining(l.item) ?? 0;
        if (!Number.isFinite(l.amount) || l.amount <= 0) return `Enter an amount above 0 for ${l.item.drug}.`;
        if (l.amount > left) return `Only ${formatQty(left)} of ${l.item.drug} is left to give.`;
      }
    }
    return null;
  };

  const refresh = async () => {
    if (!ref) return;
    const result = await lookup(ref);
    if (result.ok) {
      setRx(result.prescription);
      if ("code" in ref) saveCodeLookup(ref, result.prescription);
    }
  };

  const review = (e: React.FormEvent) => {
    e.preventDefault();
    const problem = validate();
    if (problem) {
      setFormError(problem);
      return;
    }
    setFormError(null);
    setStep("confirm");
  };

  const submit = async () => {
    if (!ref || !rx || sendingRef.current) return;
    sendingRef.current = true;
    setSending(true);
    setFormError(null);
    const body: DispenseRequest = {
      pharmacy_name: pharmacyName.trim(),
      pharmacist_name: pharmacistName.trim() || null,
      items: lines.map((l) => ({ item_index: l.item.item_index, amount: l.amount, complete: l.complete })),
    };
    const fingerprint = JSON.stringify([ref, body.pharmacy_name, body.items]);
    if (pendingRef.current?.fingerprint !== fingerprint) {
      pendingRef.current = { key: newIdempotencyKey(), fingerprint };
    }
    const result = await dispense(ref, body, pendingRef.current.key);
    sendingRef.current = false;
    setSending(false);

    if (result.ok) {
      pendingRef.current = null;
      setCanRetry(false);
      rememberPharmacy(body.pharmacy_name);
      setRx(result.prescription);
      if ("code" in ref) saveCodeLookup(ref, result.prescription);
      setAmounts({});
      setFully({});
      setStep("edit");
      setSuccess(
        result.prescription.status === "completed"
          ? "Dispensed. Everything on this prescription has now been given."
          : "Dispensed. The patient will get an SMS from Endod.",
      );
      window.scrollTo({ top: 0, behavior: "smooth" });
      return;
    }

    if (result.retryable) {
      setFormError(
        `${result.error} It may already have been recorded: try again without changing anything, or reload the prescription before changing the amounts.`,
      );
      setCanRetry(true);
      return;
    }
    setFormError(result.error);
    pendingRef.current = null;
    setCanRetry(false);
    setStep("edit");
    if (result.status === 409) await refresh();
  };

  const newScan = () => {
    clearCodeLookup();
    router.push("/scan");
  };

  if (phase.name !== "ready" || !rx) {
    return (
      <div className="min-h-dvh bg-black text-white">
        <main className="mx-auto flex min-h-dvh w-full max-w-[420px] flex-col px-5 pb-10 pt-8 sm:max-w-[460px]">
          <header className="mb-6 flex items-center justify-between">
            <Link
              href="/scan"
              aria-label="Back to scanner"
              onClick={() => clearCodeLookup()}
              className="flex h-10 w-10 items-center justify-center rounded-full bg-white/10 text-white hover:bg-white/20"
            >
              <svg className="h-5 w-5" fill="none" stroke="currentColor" strokeWidth="2" viewBox="0 0 24 24" aria-hidden="true">
                <path d="M15 19l-7-7 7-7" strokeLinecap="round" strokeLinejoin="round" />
              </svg>
            </Link>
            <h1 className="text-lg font-semibold tracking-wide text-white">Prescription</h1>
            <div className="w-10" />
          </header>

          {phase.name === "loading" ? (
            <div className="mx-auto mt-10 w-full rounded-[26px] border border-white/10 bg-[#111726]/90 px-6 py-10 text-center shadow-[0_15px_35px_rgba(0,0,0,0.55)] backdrop-blur-xl" role="status">
              <div className="mx-auto mb-3 h-8 w-8 animate-spin rounded-full border-2 border-white/20 border-t-emerald-400" />
              <p className="text-sm text-gray-300">Looking up the prescription...</p>
            </div>
          ) : (
            <div className="mx-auto mt-10 w-full rounded-[26px] border border-white/10 bg-[#111726]/90 px-6 py-8 text-center shadow-[0_15px_35px_rgba(0,0,0,0.55)] backdrop-blur-xl" role="alert">
              <p className="text-sm font-semibold text-white" data-testid="rx-error">
                {phase.name === "error" ? phase.message : ""}
              </p>
              <button
                type="button"
                onClick={newScan}
                className="mt-5 inline-flex h-11 items-center justify-center rounded-xl border border-white/10 bg-white/10 px-6 text-sm font-semibold text-emerald-300 hover:bg-white/15"
              >
                Back to scanner
              </button>
            </div>
          )}
        </main>
      </div>
    );
  }

  const closed = closedMessage(rx);
  const drugName = (idx: number) => rx.items.find((i) => i.item_index === idx)?.drug ?? `Item ${idx + 1}`;
  const meta = (item: RxItem) => [item.dose, item.route, item.frequency, item.duration].filter(Boolean).join(" • ");
  const ageSex = [rx.patient.age !== null ? `${rx.patient.age} yrs` : null, rx.patient.sex].filter(Boolean).join(" • ");

  return (
    <div className="min-h-dvh bg-black text-white print:bg-white print:text-slate-900">
      <style>{`@keyframes rx-marquee{0%{transform:translateX(0)}100%{transform:translateX(-50%)}}`}</style>
      <main className="mx-auto flex min-h-dvh w-full max-w-[430px] flex-col px-5 pb-8 pt-8 sm:max-w-[520px] print:max-w-none print:bg-white print:px-0 print:pt-0">
        <header className="mb-4 flex items-center justify-between print:hidden">
          <Link
            href="/scan"
            aria-label="Back to scanner"
            onClick={() => clearCodeLookup()}
            className="flex h-10 w-10 items-center justify-center rounded-full bg-white/10 text-white transition-colors hover:bg-white/20"
          >
            <svg className="h-5 w-5" fill="none" stroke="currentColor" strokeWidth="2" viewBox="0 0 24 24" aria-hidden="true">
              <path d="M15 19l-7-7 7-7" strokeLinecap="round" strokeLinejoin="round" />
            </svg>
          </Link>
          <div className="w-10" />
        </header>

        <section className="relative mb-4 overflow-hidden rounded-[26px] bg-black p-5 print:hidden">
          <MedicineCarousel />
        </section>

        <section className="w-full rounded-[26px] border border-white/5 bg-[#111726]/90 p-5 shadow-[0_15px_35px_rgba(0,0,0,0.55)] backdrop-blur-xl print:rounded-none print:border-slate-200 print:bg-white print:shadow-none">
          <div className="flex items-start justify-between gap-3 border-b border-white/10 pb-4 print:border-slate-200">
            <div className="flex min-w-0 items-center gap-3">
              <div className="flex h-12 w-12 shrink-0 items-center justify-center rounded-full bg-gradient-to-br from-teal-400/30 to-emerald-500/20 ring-1 ring-white/10">
                <svg className="h-6 w-6 text-emerald-300" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" aria-hidden="true">
                  <path d="M12 12a4 4 0 1 0-4-4 4 4 0 0 0 4 4Z" />
                  <path d="M4 20a8 8 0 0 1 16 0" strokeLinecap="round" />
                </svg>
              </div>
              <div className="min-w-0">
                <span className="text-[11px] font-medium text-gray-400">Prescribed By</span>
                <div className="mt-0.5 flex items-center gap-1.5">
                  <span className="truncate text-sm font-semibold text-white print:text-slate-900" data-testid="rx-hospital">
                    {rx.hospital_name}
                  </span>
                  <svg className="h-3.5 w-3.5 shrink-0 text-[#3b82f6]" viewBox="0 0 20 20" fill="currentColor" aria-hidden="true">
                    <path fillRule="evenodd" d="M6.267 3.455a3.066 3.066 0 001.745-.723 3.066 3.066 0 013.976 0 3.066 3.066 0 001.745.723 3.066 3.066 0 012.812 2.812c.051.643.304 1.254.723 1.745a3.066 3.066 0 010 3.976 3.066 3.066 0 00-.723 1.745 3.066 3.066 0 01-2.812 2.812 3.066 3.066 0 00-1.745.723 3.066 3.066 0 01-3.976 0 3.066 3.066 0 00-1.745-.723 3.066 3.066 0 01-2.812-2.812 3.066 3.066 0 00-.723-1.745 3.066 3.066 0 010-3.976 3.066 3.066 0 00.723-1.745 3.066 3.066 0 012.812-2.812zm7.44 5.252a1 1 0 00-1.414-1.414L9 10.586 7.707 9.293a1 1 0 00-1.414 1.414l2 2a1 1 0 001.414 0l4-4z" clipRule="evenodd" />
                  </svg>
                </div>
                {rx.doctor_name && <p className="truncate text-[11px] text-gray-400 print:text-slate-600">{rx.doctor_name}</p>}
              </div>
            </div>
            <div className="flex shrink-0 flex-col items-end gap-2">
              <span data-testid="rx-status" className="sr-only">
                {STATUS_LABEL[rx.status]}
              </span>
            </div>
          </div>

          <div className="mt-4 grid grid-cols-2 gap-4 text-sm print:text-slate-700">
            <div>
              <span className="text-[11px] font-medium text-gray-400 print:text-slate-500">Patient Name</span>
              <div className="mt-0.5 break-words font-semibold text-white print:text-slate-900" data-testid="rx-patient">{rx.patient.name}</div>
            </div>
            <div className="text-right">
              <span className="text-[11px] font-medium text-gray-400 print:text-slate-500">Age & Sex</span>
              <div className="mt-0.5 font-medium text-gray-200 print:text-slate-800">{ageSex || "-"}</div>
            </div>
            <div>
              <span className="text-[11px] font-medium text-gray-400 print:text-slate-500">Endod ID</span>
              <div className="mt-0.5 font-mono text-xs font-semibold text-gray-100 print:text-slate-800">Endod ID: {rx.patient.dedan_id || "-"}</div>
            </div>
            <div className="text-right">
              <span className="text-[11px] font-medium text-gray-400 print:text-slate-500">Written / Expires</span>
              <div className="mt-0.5 font-mono text-xs font-semibold text-gray-100 print:text-slate-800">{formatDate(rx.written_at)} / {formatDate(rx.expires_at)}</div>
            </div>
          </div>
          {rx.doctor_name && (
            <p className="mt-3 text-xs text-gray-400 print:text-slate-600">Doctor: {rx.doctor_name}</p>
          )}


          {closed && (
            <div
              role="status"
              data-testid="rx-closed"
              className={`mt-4 flex items-start gap-3 rounded-2xl border px-4 py-3 text-sm font-medium ${STATUS_BADGE[rx.status]} print:bg-white print:text-slate-800`}
            >
              <span>{closed}</span>
            </div>
          )}
          {success && (
            <div
              role="status"
              data-testid="rx-success"
              className="mt-4 rounded-2xl border border-emerald-400/30 bg-emerald-500/15 px-4 py-3 text-sm font-medium text-emerald-100 print:hidden"
            >
              {success}
            </div>
          )}

          <div className="mt-5 space-y-3">
            {rx.items.map((item, n) => {
              const left = remaining(item);
              const editable = open && item.status !== "given" && step === "edit";
              const inputId = `give-${item.item_index}`;
              const img = MED_IMAGES[n % MED_IMAGES.length];
              return (
                <article
                  key={item.item_index}
                  className="rounded-2xl border border-white/[0.04] bg-[#070b13]/85 p-4 print:border-slate-200 print:bg-white"
                  data-testid={`item-${item.item_index}`}
                >
                  <div className="flex items-start gap-3">
                    <div className="relative h-14 w-14 shrink-0 overflow-hidden rounded-xl border border-white/10 bg-black">
                      <Image src={img} alt="" fill sizes="56px" className="object-cover" />
                    </div>
                    <div className="min-w-0 flex-1">
                      <h4 className="break-words text-[15px] font-semibold leading-snug tracking-wide text-white print:text-slate-900">{item.drug}</h4>
                      {meta(item) && <div className="mt-0.5 break-words text-xs text-gray-400 print:text-slate-500">{meta(item)}</div>}
                      <div className="mt-1 text-xs text-gray-400 print:text-slate-600">Qty: {item.quantity_text || formatQty(item.quantity_total)}</div>
                      {item.notes && <div className="mt-1 break-words text-xs italic text-gray-300 print:text-slate-600">{item.notes}</div>}
                      <div
                        className={`mt-1.5 text-xs font-medium ${item.status === "given" ? "text-emerald-300 print:text-emerald-700" : "text-gray-200 print:text-slate-700"}`}
                        data-testid={`progress-${item.item_index}`}
                      >
                        {itemProgress(item)}
                      </div>
                    </div>
                  </div>

                  {editable && (
                    <div className="mt-3 pl-0 sm:pl-[68px] print:hidden">
                      {item.quantity_total !== null ? (
                        <label htmlFor={inputId} className="flex flex-wrap items-center gap-2 text-sm text-gray-200">
                          <span className="text-gray-300">Give now</span>
                          <input
                            id={inputId}
                            type="number"
                            inputMode="decimal"
                            min={0}
                            max={left ?? undefined}
                            step="any"
                            placeholder="0"
                            value={amounts[item.item_index] ?? ""}
                            onChange={(e) => {
                              resetSubmission();
                              setAmounts((a) => ({ ...a, [item.item_index]: e.target.value }));
                            }}
                            className="h-10 w-24 rounded-lg border border-white/10 bg-[#101824] px-3 font-mono text-sm text-white focus:border-emerald-400 focus:outline-none focus:ring-1 focus:ring-emerald-400"
                          />
                          <span className="text-xs text-gray-400">of {formatQty(left)} left</span>
                        </label>
                      ) : (
                        <label htmlFor={inputId} className="flex cursor-pointer items-center gap-2 text-sm text-gray-200">
                          <input
                            id={inputId}
                            type="checkbox"
                            checked={!!fully[item.item_index]}
                            onChange={(e) => {
                              resetSubmission();
                              setFully((f) => ({ ...f, [item.item_index]: e.target.checked }));
                            }}
                            className="h-5 w-5 accent-emerald-400"
                          />
                          <span className="text-gray-200">Given fully</span>
                        </label>
                      )}
                    </div>
                  )}
                </article>
              );
            })}
          </div>

          <form onSubmit={review} noValidate className="mt-5 print:hidden">
            {open ? (
              <>
                <div className="fixed -left-[9999px] top-auto h-px w-px overflow-hidden">
                  <label htmlFor="pharmacy-name">Pharmacy name (shown to the patient)</label>
                  <input
                    id="pharmacy-name"
                    required
                    minLength={2}
                    maxLength={120}
                    autoComplete="organization"
                    disabled={step !== "edit"}
                    value={pharmacyName}
                    onChange={(e) => {
                      resetSubmission();
                      setPharmacyName(e.target.value);
                    }}
                  />
                  <label htmlFor="pharmacist-name">Pharmacist (optional)</label>
                  <input
                    id="pharmacist-name"
                    maxLength={120}
                    autoComplete="name"
                    disabled={step !== "edit"}
                    value={pharmacistName}
                    onChange={(e) => {
                      resetSubmission();
                      setPharmacistName(e.target.value);
                    }}
                  />
                </div>

                {step === "confirm" && (
                  <div className="mt-4 rounded-xl border border-emerald-400/30 bg-[#101824] px-4 py-4" data-testid="confirm-panel">
                    <p className="text-sm font-semibold text-white">Confirm what you are giving now</p>
                    <ul className="mt-2 flex flex-col gap-1 text-sm text-gray-200">
                      {lines.map((l) => (
                        <li key={l.item.item_index} className="flex justify-between gap-3">
                          <span className="min-w-0 break-words">{l.item.drug}</span>
                          <span className="shrink-0 font-mono text-emerald-300">
                            {l.amount !== null ? `give ${formatQty(l.amount)} (${formatQty(remaining(l.item))} left)` : "given fully"}
                          </span>
                        </li>
                      ))}
                    </ul>
                    <p className="mt-3 break-words text-xs text-gray-400">
                      Recorded as given at <span className="font-semibold text-gray-200">{pharmacyName.trim()}</span>
                      {pharmacistName.trim() ? ` by ${pharmacistName.trim()}` : ""}. This cannot be undone.
                    </p>
                  </div>
                )}

                {formError && (
                  <div
                    role="alert"
                    data-testid="dispense-error"
                    className="mt-4 rounded-lg border border-red-400/30 bg-red-500/15 px-3 py-2 text-sm text-red-100"
                  >
                    {formError}
                  </div>
                )}

                <div className="mt-5 flex flex-col gap-3">
                  {step === "edit" ? (
                    <button type="submit" className="fixed -left-[9999px] top-auto">
                      Review dispense
                    </button>
                  ) : (
                    <>
                      <button
                        type="button"
                        onClick={submit}
                        disabled={sending}
                        className="flex h-12 w-full items-center justify-center rounded-xl bg-gradient-to-b from-emerald-400 to-teal-500 text-sm font-semibold text-[#041614] transition-all hover:brightness-105 active:scale-[0.99] disabled:opacity-60"
                      >
                        {sending ? "Dispensing..." : canRetry ? "Try again" : "Confirm dispense"}
                      </button>
                      <button
                        type="button"
                        disabled={sending}
                        onClick={() => {
                          resetSubmission();
                          setStep("edit");
                        }}
                        className="flex h-11 w-full items-center justify-center rounded-xl border border-white/10 bg-white/5 text-sm font-medium text-gray-100 transition-colors hover:bg-white/10 disabled:opacity-60"
                      >
                        Back
                      </button>
                    </>
                  )}
                </div>
              </>
            ) : (
              <p className="mt-4 text-sm text-gray-400">This prescription is not open for dispensing.</p>
            )}
          </form>
        </section>

        <div className="mt-5 print:hidden">
          <button
            type="button"
            onClick={newScan}
            className="flex h-11 w-full items-center justify-center gap-2 rounded-xl border border-white/10 bg-white/5 text-sm font-medium text-gray-100 transition-colors hover:bg-white/10"
          >
            <svg className="h-4 w-4" fill="none" stroke="currentColor" strokeWidth="2" viewBox="0 0 24 24" aria-hidden="true">
              <path d="M15 19l-7-7 7-7" strokeLinecap="round" strokeLinejoin="round" />
            </svg>
            <span>Back to scan</span>
          </button>
        </div>

        <div className="fixed -left-[9999px] top-auto">
          {rx.dispenses.length === 0 ? (
            <p data-testid="history-empty">Nothing has been dispensed yet.</p>
          ) : (
            <ul data-testid="history">
              {rx.dispenses.map((d, i) => (
                <li key={`${d.at}-${i}`}>
                  {d.pharmacy_name} {formatDateTime(d.at)}
                  {d.items.map((l) => (
                    <span key={l.item_index}>
                      {drugName(l.item_index)}: {l.amount !== null ? formatQty(l.amount) : ""}
                      {l.amount !== null && l.complete ? ", " : ""}
                      {l.complete ? "given fully" : ""}
                    </span>
                  ))}
                </li>
              ))}
            </ul>
          )}
        </div>


      </main>
    </div>
  );
}
