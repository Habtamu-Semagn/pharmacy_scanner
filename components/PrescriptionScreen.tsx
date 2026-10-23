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
  open: "bg-emerald-50 text-emerald-800 border-emerald-200",
  completed: "bg-slate-100 text-slate-700 border-slate-300",
  expired: "bg-amber-50 text-amber-800 border-amber-200",
  retracted: "bg-red-50 text-red-800 border-red-200",
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

/** `token` null means a code lookup (code and phone come from sessionStorage). */
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

  // The Idempotency-Key of a submission whose outcome is not known yet (in
  // flight, or it failed with a timeout/network/server error, so Endod may
  // already have recorded it). Any later submission of the same lines and
  // pharmacy name reuses it, even after Back or editing and undoing, so the
  // platform cannot dispense twice. It is dropped only after a definite answer
  // (success or refusal); a submission with different lines gets a new key.
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

  // Clears messages only; the pending key is matched by fingerprint in submit().
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
      // Endod may or may not have recorded it: keep the key for a retry.
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
    router.push("/");
  };

  // ------------------------------------------------------------------ render

  const header = (
    <header className="fixed top-0 left-0 right-0 z-40 bg-white/90 backdrop-blur-md border-b border-slate-200 pt-safe print:static print:border-0">
      <div className="h-16 px-4 sm:px-5 max-w-xl mx-auto flex items-center justify-between gap-3">
        <div className="flex items-center gap-3 min-w-0">
          <Link
            href="/"
            aria-label="Back to scanner"
            onClick={() => clearCodeLookup()}
            className="w-9 h-9 rounded-lg bg-white text-slate-900 border border-slate-200 flex items-center justify-center shrink-0 hover:bg-slate-50 print:hidden"
          >
            <span className="material-symbols-outlined text-[20px]">arrow_back</span>
          </Link>
          <div className="w-9 h-9 rounded-lg bg-white text-slate-900 border border-slate-200 items-center justify-center shrink-0 hidden print:flex">
            <span className="material-symbols-outlined text-[20px]">local_hospital</span>
          </div>
          <div className="min-w-0">
            <h1 className="text-sm font-semibold text-slate-900 leading-tight truncate">
              {rx?.hospital_name || "Endod prescription"}
            </h1>
            <p className="text-xs text-slate-500 leading-none mt-0.5">Endod Health prescription</p>
          </div>
        </div>
        <div className="flex items-center gap-2 shrink-0">
          {rx && (
            <span
              data-testid="rx-status"
              className={`font-mono text-xs font-semibold px-2.5 py-1 rounded-md border ${STATUS_BADGE[rx.status]}`}
            >
              {STATUS_LABEL[rx.status]}
            </span>
          )}
          {rx && (
            <button
              type="button"
              onClick={print}
              aria-label="Print prescription"
              className="w-9 h-9 flex items-center justify-center rounded-lg text-slate-600 hover:text-slate-900 hover:bg-slate-100 transition-colors print:hidden"
            >
              <span className="material-symbols-outlined text-[20px]">print</span>
            </button>
          )}
        </div>
      </div>
    </header>
  );

  if (phase.name !== "ready" || !rx) {
    return (
      <div className="font-sans antialiased bg-slate-50 min-h-screen flex flex-col text-slate-900">
        {header}
        <main className="flex-1 w-full max-w-xl mx-auto pt-24 pb-12 px-4 sm:px-5 flex flex-col gap-6">
          {phase.name === "loading" ? (
            <div className="bg-white rounded-2xl border border-slate-200 shadow-lg px-6 py-10 flex flex-col items-center gap-3" role="status">
              <span className="material-symbols-outlined text-[28px] text-slate-400 animate-spin">progress_activity</span>
              <p className="text-sm text-slate-600">Looking up the prescription...</p>
            </div>
          ) : (
            <div className="bg-white rounded-2xl border border-slate-200 shadow-lg px-6 py-8 flex flex-col items-center gap-3 text-center" role="alert">
              <span className="material-symbols-outlined text-[28px] text-slate-500">
                {phase.name === "error" && phase.noCode ? "sms" : "search_off"}
              </span>
              <p className="text-sm font-semibold text-slate-900" data-testid="rx-error">
                {phase.name === "error" ? phase.message : ""}
              </p>
              <button
                type="button"
                onClick={newScan}
                className="mt-2 h-11 px-6 bg-white text-slate-900 border border-slate-300 rounded-xl font-semibold text-sm flex items-center justify-center gap-2 hover:bg-slate-50"
              >
                <span className="material-symbols-outlined text-[18px]">qr_code_scanner</span>
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
    <div className="font-sans antialiased bg-slate-50 min-h-screen flex flex-col text-slate-900 print:bg-white">
      {header}

      <main className="flex-1 w-full max-w-xl mx-auto pt-24 pb-12 px-4 sm:px-5 flex flex-col gap-6 print:pt-4">
        {closed && (
          <div
            role="status"
            data-testid="rx-closed"
            className={`rounded-2xl border px-5 py-4 text-sm font-medium flex items-start gap-3 ${STATUS_BADGE[rx.status]}`}
          >
            <span className="material-symbols-outlined text-[20px] shrink-0">
              {rx.status === "completed" ? "task_alt" : rx.status === "expired" ? "event_busy" : "block"}
            </span>
            <span>{closed}</span>
          </div>
        )}
        {success && (
          <div
            role="status"
            data-testid="rx-success"
            className="rounded-2xl border border-emerald-200 bg-emerald-50 text-emerald-900 px-5 py-4 text-sm font-medium flex items-start gap-3 print:hidden"
          >
            <span className="material-symbols-outlined text-[20px] shrink-0">check_circle</span>
            <span>{success}</span>
          </div>
        )}

        <div className="bg-white rounded-2xl border border-slate-200 shadow-lg overflow-hidden print:shadow-none">
          {/* Prescription header */}
          <section className="px-5 sm:px-6 py-6">
            <div className="flex items-start justify-between gap-3 mb-5">
              <div className="min-w-0">
                <p className="text-xs font-semibold text-slate-500 uppercase tracking-wider mb-1">Prescription</p>
                <h2 className="text-base font-semibold text-slate-900 tracking-tight leading-snug break-words" data-testid="rx-hospital">
                  {rx.hospital_name}
                </h2>
                {rx.doctor_name && <p className="text-sm text-slate-500 mt-1 break-words">Prescribed by {rx.doctor_name}</p>}
              </div>
              <span className="font-mono text-xs font-semibold text-slate-700 bg-slate-50 px-2.5 py-1 rounded-full border border-slate-200 whitespace-nowrap shrink-0">
                {rx.items.length} {rx.items.length === 1 ? "item" : "items"}
              </span>
            </div>
            <div className="grid grid-cols-2 gap-4 pt-5 border-t border-dashed border-slate-200">
              <div>
                <span className="text-xs text-slate-400 font-medium">Written</span>
                <div className="font-mono font-semibold text-slate-900 mt-1 text-sm">{formatDate(rx.written_at)}</div>
              </div>
              <div className="text-right">
                <span className="text-xs text-slate-400 font-medium">Expires</span>
                <div className="font-mono font-semibold text-slate-900 mt-1 text-sm">{formatDate(rx.expires_at)}</div>
              </div>
            </div>
          </section>

          {/* Patient */}
          <section className="px-5 sm:px-6 py-6 border-t border-slate-100 bg-slate-50/40">
            <div className="flex items-center justify-between gap-3 mb-4">
              <h3 className="text-sm font-semibold text-slate-900">Patient</h3>
              <span className="font-mono text-xs font-medium text-slate-700 bg-white px-2.5 py-1 rounded-md border border-slate-200 truncate">
                Endod ID: {rx.patient.dedan_id || "-"}
              </span>
            </div>
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-x-6 gap-y-4 text-sm">
              <div className="flex flex-col gap-0.5 min-w-0">
                <span className="text-xs text-slate-400 font-medium">Patient Name</span>
                <span className="font-semibold text-slate-900 break-words" data-testid="rx-patient">{rx.patient.name}</span>
              </div>
              <div className="flex flex-col gap-0.5">
                <span className="text-xs text-slate-400 font-medium">Age & Sex</span>
                <span className="font-medium text-slate-800">{ageSex || "-"}</span>
              </div>
            </div>
            {rx.notes && (
              <div className="mt-5 pt-4 border-t border-slate-200/70">
                <span className="text-xs text-slate-400 font-medium">Notes from the prescriber</span>
                <p className="text-sm text-slate-900 leading-relaxed mt-1 whitespace-pre-line break-words">{rx.notes}</p>
              </div>
            )}
          </section>

          {/* Medication orders + dispense inputs */}
          <form onSubmit={review} noValidate>
            <section className="px-5 sm:px-6 py-6 border-t border-slate-100">
              <div className="flex items-center justify-between mb-4">
                <h3 className="text-sm font-semibold text-slate-900">Medication Orders</h3>
                {open && <span className="text-xs font-medium text-slate-500 print:hidden">Give now</span>}
              </div>
              <ol className="flex flex-col divide-y divide-slate-100">
                {rx.items.map((item, n) => {
                  const left = remaining(item);
                  const editable = open && item.status !== "given" && step === "edit";
                  const inputId = `give-${item.item_index}`;
                  return (
                    <li key={item.item_index} className="py-4 first:pt-0 last:pb-0" data-testid={`item-${item.item_index}`}>
                      <div className="flex flex-col sm:flex-row sm:items-start sm:justify-between gap-2">
                        <div className="flex items-start gap-3 min-w-0">
                          <span className="font-mono text-sm font-semibold text-slate-400 mt-0.5">{n + 1}</span>
                          <div className="min-w-0">
                            <h4 className="text-sm font-semibold text-slate-900 leading-snug break-words">{item.drug}</h4>
                            {meta(item) && <div className="text-xs text-slate-500 mt-0.5 break-words">{meta(item)}</div>}
                            {item.notes && <div className="text-xs text-slate-600 mt-1 italic break-words">{item.notes}</div>}
                            <div
                              className={`text-xs mt-1.5 font-medium ${item.status === "given" ? "text-emerald-700" : "text-slate-700"}`}
                              data-testid={`progress-${item.item_index}`}
                            >
                              {itemProgress(item)}
                            </div>
                          </div>
                        </div>
                        <span className="font-mono text-xs font-semibold bg-white text-slate-900 border border-slate-300 px-2.5 py-1 rounded-md self-start ml-7 sm:ml-0 max-w-full break-words">
                          Qty: {item.quantity_text || formatQty(item.quantity_total)}
                        </span>
                      </div>

                      {editable && (
                        <div className="ml-7 mt-3 print:hidden">
                          {item.quantity_total !== null ? (
                            <label htmlFor={inputId} className="flex items-center gap-2 text-sm">
                              <span className="text-slate-600">Give now</span>
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
                                className="w-24 h-10 rounded-lg border border-slate-300 px-3 font-mono text-sm text-slate-900 focus:outline-none focus:ring-2 focus:ring-slate-900"
                              />
                              <span className="text-slate-500 text-xs">of {formatQty(left)} left</span>
                            </label>
                          ) : (
                            <label htmlFor={inputId} className="flex items-center gap-2 text-sm cursor-pointer">
                              <input
                                id={inputId}
                                type="checkbox"
                                checked={!!fully[item.item_index]}
                                onChange={(e) => {
                                  resetSubmission();
                                  setFully((f) => ({ ...f, [item.item_index]: e.target.checked }));
                                }}
                                className="w-5 h-5 accent-slate-900"
                              />
                              <span className="text-slate-700">Given fully</span>
                            </label>
                          )}
                        </div>
                      )}
                    </li>
                  );
                })}
              </ol>
            </section>

            {/* Dispense history */}
            <section className="px-5 sm:px-6 py-6 border-t border-slate-100">
              <h3 className="text-sm font-semibold text-slate-900 mb-4">Dispense History</h3>
              {rx.dispenses.length === 0 ? (
                <p className="text-sm text-slate-500" data-testid="history-empty">Nothing has been dispensed yet.</p>
              ) : (
                <ul className="flex flex-col gap-3" data-testid="history">
                  {rx.dispenses.map((d, i) => (
                    <li key={`${d.at}-${i}`} className="rounded-xl border border-slate-200 px-4 py-3">
                      <div className="flex flex-wrap items-baseline justify-between gap-x-3 gap-y-1">
                        <span className="text-sm font-semibold text-slate-900 break-words">{d.pharmacy_name}</span>
                        <span className="font-mono text-xs text-slate-500">{formatDateTime(d.at)}</span>
                      </div>
                      <ul className="mt-1.5 text-xs text-slate-600 flex flex-col gap-0.5">
                        {d.items.map((l) => (
                          <li key={l.item_index} className="break-words">
                            {drugName(l.item_index)}:{" "}
                            {l.amount !== null ? formatQty(l.amount) : ""}
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

            {/* Dispense */}
            {open && (
              <section className="px-5 sm:px-6 py-6 border-t border-slate-100 bg-slate-50/60 print:hidden">
                <h3 className="text-sm font-semibold text-slate-900 mb-4">Dispense</h3>
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                  <label className="flex flex-col gap-1 text-sm" htmlFor="pharmacy-name">
                    <span className="text-xs text-slate-500 font-medium">Pharmacy name (shown to the patient)</span>
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
                      className="h-11 rounded-lg border border-slate-300 bg-white px-3 text-sm text-slate-900 focus:outline-none focus:ring-2 focus:ring-slate-900 disabled:bg-slate-100"
                    />
                  </label>
                  <label className="flex flex-col gap-1 text-sm" htmlFor="pharmacist-name">
                    <span className="text-xs text-slate-500 font-medium">Pharmacist (optional)</span>
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
                      className="h-11 rounded-lg border border-slate-300 bg-white px-3 text-sm text-slate-900 focus:outline-none focus:ring-2 focus:ring-slate-900 disabled:bg-slate-100"
                    />
                  </label>
                </div>

                {step === "confirm" && (
                  <div className="mt-5 rounded-xl border border-slate-300 bg-white px-4 py-4" data-testid="confirm-panel">
                    <p className="text-sm font-semibold text-slate-900">Confirm what you are giving now</p>
                    <ul className="mt-2 text-sm text-slate-700 flex flex-col gap-1">
                      {lines.map((l) => (
                        <li key={l.item.item_index} className="flex justify-between gap-3">
                          <span className="break-words min-w-0">{l.item.drug}</span>
                          <span className="font-mono shrink-0">
                            {l.amount !== null ? `give ${formatQty(l.amount)} (${formatQty(remaining(l.item))} left)` : "given fully"}
                          </span>
                        </li>
                      ))}
                    </ul>
                    <p className="mt-3 text-xs text-slate-500 break-words">
                      Recorded as given at <span className="font-semibold text-slate-700">{pharmacyName.trim()}</span>
                      {pharmacistName.trim() ? ` by ${pharmacistName.trim()}` : ""}. This cannot be undone.
                    </p>
                  </div>
                )}

                {formError && (
                  <div
                    role="alert"
                    data-testid="dispense-error"
                    className="mt-4 text-sm text-red-800 bg-red-50 border border-red-200 rounded-lg px-3 py-2"
                  >
                    {formError}
                  </div>
                )}

                <div className="mt-5 flex flex-col gap-3">
                  {step === "edit" ? (
                    <button
                      type="submit"
                      className="w-full h-12 bg-slate-900 text-white rounded-xl font-semibold text-sm flex items-center justify-center gap-2 hover:bg-slate-800 active:scale-[0.99] transition-all"
                    >
                      <span className="material-symbols-outlined text-[18px]">medication</span>
                      Review dispense
                    </button>
                  ) : (
                    <>
                      <button
                        type="button"
                        onClick={submit}
                        disabled={sending}
                        className="w-full h-12 bg-slate-900 text-white rounded-xl font-semibold text-sm flex items-center justify-center gap-2 hover:bg-slate-800 active:scale-[0.99] transition-all disabled:opacity-60"
                      >
                        <span className="material-symbols-outlined text-[18px]">check_circle</span>
                        {sending ? "Dispensing..." : canRetry ? "Try again" : "Confirm dispense"}
                      </button>
                      <button
                        type="button"
                        disabled={sending}
                        onClick={() => {
                          resetSubmission();
                          setStep("edit");
                        }}
                        className="w-full h-11 bg-white text-slate-800 border border-slate-300 rounded-xl font-medium text-sm flex items-center justify-center gap-2 hover:bg-slate-50 transition-colors disabled:opacity-60"
                      >
                        Back
                      </button>
                    </>
                  )}
                </div>
              </section>
            )}
          </form>

          <section className="px-5 sm:px-6 py-5 border-t border-slate-100 bg-slate-50/60 text-xs text-slate-500">
            <p className="leading-relaxed">
              <span className="font-semibold text-slate-700">Endod Health:</span> valid at any pharmacy until everything is
              given, it expires ({formatDate(rx.expires_at)}), or the hospital withdraws it.
            </p>
            <p className="text-xs text-slate-400 mt-1 font-mono break-all">Rx {rx.rx_id}</p>
          </section>
        </div>

        <div className="flex flex-col gap-3 print:hidden">
          <button
            type="button"
            onClick={print}
            className="w-full h-11 bg-white text-slate-800 border border-slate-300 rounded-xl font-medium text-sm flex items-center justify-center gap-2 hover:bg-slate-50 transition-colors"
          >
            <span className="material-symbols-outlined text-[18px] text-slate-500">print</span>
            Print prescription
          </button>
          <button
            type="button"
            onClick={newScan}
            className="w-full h-11 bg-white text-slate-800 border border-slate-300 rounded-xl font-medium text-sm flex items-center justify-center gap-2 hover:bg-slate-50 transition-colors"
          >
            <span className="material-symbols-outlined text-[18px] text-slate-500">qr_code_scanner</span>
            Scan another prescription
          </button>
        </div>
      </main>
    </div>
  );
}
