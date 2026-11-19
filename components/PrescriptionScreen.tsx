"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
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
            message: "Enter the prescription code and the patient's phone number on the scanner page.",
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

  const print = () => window.print();

  const newScan = () => {
    clearCodeLookup();
    router.push("/scan");
  };

  if (phase.name !== "ready" || !rx) {
    return (
      <div className="relative min-h-dvh overflow-hidden bg-[#1a1b1f] text-white">
        <div className="detail-bg-circle-1" />
        <div className="detail-bg-circle-2" />
        <div className="detail-bg-circle-3" />
        <main className="relative z-10 mx-auto flex min-h-dvh w-full max-w-4xl flex-col px-4 pb-10 pt-6 sm:px-6 sm:pt-8">
          <header className="mb-6 flex items-center gap-4">
            <Link
              href="/scan"
              aria-label="Back to scanner"
              onClick={() => clearCodeLookup()}
              className="flex h-11 w-11 items-center justify-center rounded-full bg-[#24262b] text-[#f5a623] shadow-md transition-transform active:scale-95"
            >
              <svg className="h-5 w-5 stroke-[2.5]" fill="none" stroke="currentColor" viewBox="0 0 24 24" aria-hidden="true">
                <path d="M15 19l-7-7 7-7" strokeLinecap="round" strokeLinejoin="round" />
              </svg>
            </Link>
            <h1 className="text-[22px] font-semibold tracking-wide text-gray-100">Prescription</h1>
          </header>

          {phase.name === "loading" ? (
            <div className="mx-auto mt-10 w-full max-w-xl rounded-2xl border border-white/10 bg-[#26282e]/90 px-6 py-10 text-center shadow-lg backdrop-blur-md" role="status">
              <div className="mx-auto mb-3 h-8 w-8 animate-spin rounded-full border-2 border-white/20 border-t-[#f5a623]" />
              <p className="text-sm text-gray-300">Looking up the prescription...</p>
            </div>
          ) : (
            <div className="mx-auto mt-10 w-full max-w-xl rounded-2xl border border-white/10 bg-[#26282e]/90 px-6 py-8 text-center shadow-lg backdrop-blur-md" role="alert">
              <p className="text-sm font-semibold text-white" data-testid="rx-error">
                {phase.name === "error" ? phase.message : ""}
              </p>
              <button
                type="button"
                onClick={newScan}
                className="mt-5 inline-flex h-11 items-center justify-center gap-2 rounded-xl border border-white/10 bg-[#24262c] px-6 text-sm font-semibold text-[#f5a623] hover:bg-[#2c2f37]"
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
    <div className="relative min-h-dvh overflow-hidden bg-[#1a1b1f] text-white print:bg-white print:text-slate-900">
      <div className="detail-bg-circle-1 print:hidden" />
      <div className="detail-bg-circle-2 print:hidden" />
      <div className="detail-bg-circle-3 print:hidden" />

      <main className="relative z-10 mx-auto flex w-full max-w-5xl flex-col px-4 pb-12 pt-6 sm:px-6 sm:pt-8 print:max-w-none print:px-0 print:pt-0">
        <header className="mb-6 flex items-center justify-between gap-3 print:mb-4">
          <div className="flex min-w-0 items-center gap-4">
            <Link
              href="/scan"
              aria-label="Back to scanner"
              onClick={() => clearCodeLookup()}
              className="flex h-11 w-11 shrink-0 items-center justify-center rounded-full bg-[#24262b] text-[#f5a623] shadow-md transition-transform active:scale-95 print:hidden"
            >
              <svg className="h-5 w-5 stroke-[2.5]" fill="none" stroke="currentColor" viewBox="0 0 24 24" aria-hidden="true">
                <path d="M15 19l-7-7 7-7" strokeLinecap="round" strokeLinejoin="round" />
              </svg>
            </Link>
            <div className="min-w-0">
              <h1 className="text-[22px] font-semibold tracking-wide text-gray-100 print:text-slate-900">Prescription</h1>
              <p className="truncate text-xs text-gray-400 print:text-slate-600">Endod Health prescription</p>
            </div>
          </div>
          <div className="flex shrink-0 items-center gap-2">
            <span
              data-testid="rx-status"
              className={`rounded-md border px-2.5 py-1 font-mono text-xs font-semibold ${STATUS_BADGE[rx.status]} print:border-slate-300 print:bg-white print:text-slate-800`}
            >
              {STATUS_LABEL[rx.status]}
            </span>
            <button
              type="button"
              onClick={print}
              aria-label="Print prescription"
              className="flex h-10 w-10 items-center justify-center rounded-full border border-white/10 bg-[#24262b] text-[#f5a623] hover:bg-[#2c2f37] print:hidden"
            >
              <svg className="h-5 w-5" fill="none" stroke="currentColor" strokeWidth="2" viewBox="0 0 24 24" aria-hidden="true">
                <path d="M6 9V4h12v5M6 18H4a2 2 0 0 1-2-2v-5a2 2 0 0 1 2-2h16a2 2 0 0 1 2 2v5a2 2 0 0 1-2 2h-2" strokeLinecap="round" strokeLinejoin="round" />
                <rect x="6" y="14" width="12" height="7" rx="1.5" />
              </svg>
            </button>
          </div>
        </header>

        <section className="mb-6 rounded-xl border border-white/10 bg-[#26282e]/90 px-4 py-4 shadow-lg backdrop-blur-md print:border-slate-200 print:bg-white print:shadow-none">
          <div className="flex flex-col gap-4 sm:flex-row sm:items-start sm:justify-between">
            <div className="min-w-0">
              <h2 className="text-base font-semibold tracking-wide text-white print:text-slate-900" data-testid="rx-hospital">
                {rx.hospital_name}
              </h2>
              {rx.doctor_name && <p className="mt-1 text-sm text-gray-400 print:text-slate-600">Prescribed by {rx.doctor_name}</p>}
            </div>
            <span className="inline-flex w-fit shrink-0 rounded-full border border-white/10 bg-[#24262c] px-3 py-1 font-mono text-xs font-semibold text-gray-200 print:border-slate-200 print:bg-slate-50 print:text-slate-700">
              {rx.items.length} {rx.items.length === 1 ? "item" : "items"}
            </span>
          </div>
          <div className="mt-4 grid grid-cols-2 gap-4 border-t border-dashed border-white/10 pt-4 text-sm print:border-slate-200">
            <div>
              <span className="text-xs font-medium text-gray-400 print:text-slate-500">Written</span>
              <div className="mt-1 font-mono font-semibold text-white print:text-slate-900">{formatDate(rx.written_at)}</div>
            </div>
            <div className="text-right">
              <span className="text-xs font-medium text-gray-400 print:text-slate-500">Expires</span>
              <div className="mt-1 font-mono font-semibold text-white print:text-slate-900">{formatDate(rx.expires_at)}</div>
            </div>
          </div>
        </section>

        {closed && (
          <div
            role="status"
            data-testid="rx-closed"
            className={`mb-6 flex items-start gap-3 rounded-2xl border px-5 py-4 text-sm font-medium ${STATUS_BADGE[rx.status]} print:bg-white print:text-slate-800`}
          >
            <span>{closed}</span>
          </div>
        )}
        {success && (
          <div
            role="status"
            data-testid="rx-success"
            className="mb-6 rounded-2xl border border-emerald-400/30 bg-emerald-500/15 px-5 py-4 text-sm font-medium text-emerald-100 print:hidden"
          >
            {success}
          </div>
        )}

        <section className="mb-6 rounded-2xl border border-[#f5a623]/50 bg-[#26282e]/90 p-4 shadow-[0_0_20px_rgba(245,166,35,0.12)] backdrop-blur-md sm:p-6 print:border-slate-200 print:bg-white print:shadow-none">
          <div className="grid gap-6 lg:grid-cols-[1.1fr_0.9fr]">
            <div className="rounded-xl border border-white/10 bg-[#1f2126] p-4 sm:p-5 print:border-slate-200 print:bg-white">
              <div className="mb-4 flex items-center justify-between gap-3">
                <h3 className="text-sm font-semibold text-white print:text-slate-900">Patient</h3>
                <span className="truncate rounded-md border border-white/10 bg-[#24262c] px-2.5 py-1 font-mono text-xs font-medium text-gray-200 print:border-slate-200 print:bg-slate-50 print:text-slate-700">
                  Endod ID: {rx.patient.dedan_id || "-"}
                </span>
              </div>
              <div className="grid grid-cols-1 gap-x-6 gap-y-4 text-sm sm:grid-cols-2">
                <div className="flex min-w-0 flex-col gap-0.5">
                  <span className="text-xs font-medium text-gray-400 print:text-slate-500">Patient Name</span>
                  <span className="break-words font-semibold text-white print:text-slate-900" data-testid="rx-patient">{rx.patient.name}</span>
                </div>
                <div className="flex flex-col gap-0.5">
                  <span className="text-xs font-medium text-gray-400 print:text-slate-500">Age & Sex</span>
                  <span className="font-medium text-gray-200 print:text-slate-800">{ageSex || "-"}</span>
                </div>
              </div>
              {rx.notes && (
                <div className="mt-5 border-t border-white/10 pt-4 print:border-slate-200">
                  <span className="text-xs font-medium text-gray-400 print:text-slate-500">Notes from the prescriber</span>
                  <p className="mt-1 whitespace-pre-line break-words text-sm leading-relaxed text-gray-200 print:text-slate-900">{rx.notes}</p>
                </div>
              )}
            </div>

            <form onSubmit={review} noValidate className="rounded-xl border border-white/10 bg-[#1f2126] p-4 sm:p-5 print:border-slate-200 print:bg-white">
              <div className="mb-4 flex items-center justify-between">
                <h3 className="text-sm font-semibold text-white print:text-slate-900">Dispense</h3>
                {open && <span className="text-xs font-medium text-gray-400 print:hidden">Give now</span>}
              </div>
              {open ? (
                <>
                  <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
                    <label className="flex flex-col gap-1 text-sm" htmlFor="pharmacy-name">
                      <span className="text-xs font-medium text-gray-400">Pharmacy name (shown to the patient)</span>
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
                        className="h-11 rounded-lg border border-white/10 bg-[#24262c] px-3 text-sm text-white placeholder:text-gray-500 focus:border-[#f5a623] focus:outline-none focus:ring-1 focus:ring-[#f5a623] disabled:bg-[#1b1d22] disabled:text-gray-400 print:border-slate-300 print:bg-white print:text-slate-900"
                      />
                    </label>
                    <label className="flex flex-col gap-1 text-sm" htmlFor="pharmacist-name">
                      <span className="text-xs font-medium text-gray-400">Pharmacist (optional)</span>
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
                        className="h-11 rounded-lg border border-white/10 bg-[#24262c] px-3 text-sm text-white placeholder:text-gray-500 focus:border-[#f5a623] focus:outline-none focus:ring-1 focus:ring-[#f5a623] disabled:bg-[#1b1d22] disabled:text-gray-400 print:border-slate-300 print:bg-white print:text-slate-900"
                      />
                    </label>
                  </div>

                  {step === "confirm" && (
                    <div className="mt-5 rounded-xl border border-[#f5a623]/30 bg-[#24262c] px-4 py-4" data-testid="confirm-panel">
                      <p className="text-sm font-semibold text-white">Confirm what you are giving now</p>
                      <ul className="mt-2 flex flex-col gap-1 text-sm text-gray-200">
                        {lines.map((l) => (
                          <li key={l.item.item_index} className="flex justify-between gap-3">
                            <span className="min-w-0 break-words">{l.item.drug}</span>
                            <span className="shrink-0 font-mono text-[#f5a623]">
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
                      <button
                        type="submit"
                        className="flex h-12 w-full items-center justify-center gap-2 rounded-xl bg-gradient-to-b from-[#fbbd08] to-[#f59e0b] text-sm font-semibold text-black transition-all hover:brightness-105 active:scale-[0.99]"
                      >
                        Review dispense
                      </button>
                    ) : (
                      <>
                        <button
                          type="button"
                          onClick={submit}
                          disabled={sending}
                          className="flex h-12 w-full items-center justify-center gap-2 rounded-xl bg-gradient-to-b from-[#fbbd08] to-[#f59e0b] text-sm font-semibold text-black transition-all hover:brightness-105 active:scale-[0.99] disabled:opacity-60"
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
                          className="flex h-11 w-full items-center justify-center gap-2 rounded-xl border border-white/10 bg-[#24262c] text-sm font-medium text-gray-100 transition-colors hover:bg-[#2c2f37] disabled:opacity-60"
                        >
                          Back
                        </button>
                      </>
                    )}
                  </div>
                </>
              ) : (
                <p className="text-sm text-gray-400">This prescription is not open for dispensing.</p>
              )}
            </form>
          </div>
        </section>

        <section className="mb-6 rounded-2xl border border-white/10 bg-[#26282e]/90 p-4 shadow-lg backdrop-blur-md sm:p-6 print:border-slate-200 print:bg-white print:shadow-none">
          <div className="mb-4 flex items-center justify-between">
            <h3 className="text-sm font-semibold text-white print:text-slate-900">Medication Orders</h3>
            {open && <span className="text-xs font-medium text-gray-400 print:hidden">Give now</span>}
          </div>
          <ol className="flex flex-col divide-y divide-white/10 print:divide-slate-200">
            {rx.items.map((item, n) => {
              const left = remaining(item);
              const editable = open && item.status !== "given" && step === "edit";
              const inputId = `give-${item.item_index}`;
              return (
                <li key={item.item_index} className="py-4 first:pt-0 last:pb-0" data-testid={`item-${item.item_index}`}>
                  <div className="flex flex-col gap-2 sm:flex-row sm:items-start sm:justify-between">
                    <div className="flex min-w-0 items-start gap-3">
                      <span className="mt-0.5 font-mono text-sm font-semibold text-[#f5a623]">{n + 1}</span>
                      <div className="min-w-0">
                        <h4 className="break-words text-sm font-semibold leading-snug text-white print:text-slate-900">{item.drug}</h4>
                        {meta(item) && <div className="mt-0.5 break-words text-xs text-gray-400 print:text-slate-500">{meta(item)}</div>}
                        {item.notes && <div className="mt-1 break-words text-xs italic text-gray-300 print:text-slate-600">{item.notes}</div>}
                        <div
                          className={`mt-1.5 text-xs font-medium ${item.status === "given" ? "text-emerald-300 print:text-emerald-700" : "text-gray-200 print:text-slate-700"}`}
                          data-testid={`progress-${item.item_index}`}
                        >
                          {itemProgress(item)}
                        </div>
                      </div>
                    </div>
                    <span className="ml-7 max-w-full self-start break-words rounded-md border border-white/10 bg-[#24262c] px-2.5 py-1 font-mono text-xs font-semibold text-gray-100 sm:ml-0 print:border-slate-300 print:bg-white print:text-slate-900">
                      Qty: {item.quantity_text || formatQty(item.quantity_total)}
                    </span>
                  </div>

                  {editable && (
                    <div className="ml-7 mt-3 print:hidden">
                      {item.quantity_total !== null ? (
                        <label htmlFor={inputId} className="flex items-center gap-2 text-sm text-gray-200">
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
                            className="h-10 w-24 rounded-lg border border-white/10 bg-[#24262c] px-3 font-mono text-sm text-white focus:border-[#f5a623] focus:outline-none focus:ring-1 focus:ring-[#f5a623]"
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
                            className="h-5 w-5 accent-[#f5a623]"
                          />
                          <span className="text-gray-200">Given fully</span>
                        </label>
                      )}
                    </div>
                  )}
                </li>
              );
            })}
          </ol>
        </section>

        <section className="mb-6 rounded-2xl border border-white/10 bg-[#26282e]/90 p-4 shadow-lg backdrop-blur-md sm:p-6 print:border-slate-200 print:bg-white print:shadow-none">
          <h3 className="mb-4 text-sm font-semibold text-white print:text-slate-900">Dispense History</h3>
          {rx.dispenses.length === 0 ? (
            <p className="text-sm text-gray-400 print:text-slate-500" data-testid="history-empty">Nothing has been dispensed yet.</p>
          ) : (
            <ul className="flex flex-col gap-3" data-testid="history">
              {rx.dispenses.map((d, i) => (
                <li key={`${d.at}-${i}`} className="rounded-xl border border-white/10 bg-[#1f2126] px-4 py-3 print:border-slate-200 print:bg-white">
                  <div className="flex flex-wrap items-baseline justify-between gap-x-3 gap-y-1">
                    <span className="break-words text-sm font-semibold text-white print:text-slate-900">{d.pharmacy_name}</span>
                    <span className="font-mono text-xs text-gray-400 print:text-slate-500">{formatDateTime(d.at)}</span>
                  </div>
                  <ul className="mt-1.5 flex flex-col gap-0.5 text-xs text-gray-300 print:text-slate-600">
                    {d.items.map((l) => (
                      <li key={l.item_index} className="break-words">
                        {drugName(l.item_index)}: {l.amount !== null ? formatQty(l.amount) : ""}
                        {l.amount !== null && l.complete ? ", " : ""}
                        {l.complete ? "given fully" : ""}
                      </li>
                    ))}
                  </ul>
                </li>
              ))}
            </ul>
          )}
        </section>

        <section className="mb-6 rounded-2xl border border-white/10 bg-[#26282e]/90 px-5 py-5 text-xs text-gray-400 shadow-lg backdrop-blur-md print:border-slate-200 print:bg-white print:text-slate-500">
          <p className="leading-relaxed">
            <span className="font-semibold text-gray-200 print:text-slate-700">Endod Health:</span> valid at any pharmacy until everything is given, it expires ({formatDate(rx.expires_at)}), or the hospital withdraws it.
          </p>
          <p className="mt-1 break-all font-mono text-xs text-gray-500 print:text-slate-400">Rx {rx.rx_id}</p>
        </section>

        <div className="flex flex-col gap-3 print:hidden sm:flex-row">
          <button
            type="button"
            onClick={print}
            className="flex h-11 w-full items-center justify-center gap-2 rounded-xl border border-white/10 bg-[#24262c] text-sm font-medium text-gray-100 transition-colors hover:bg-[#2c2f37]"
          >
            Print prescription
          </button>
          <button
            type="button"
            onClick={newScan}
            className="flex h-11 w-full items-center justify-center gap-2 rounded-xl border border-white/10 bg-[#24262c] text-sm font-medium text-gray-100 transition-colors hover:bg-[#2c2f37]"
          >
            Scan another prescription
          </button>
        </div>
      </main>
    </div>
  );
}
