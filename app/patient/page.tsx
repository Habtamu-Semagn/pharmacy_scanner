"use client";

export default function PatientPage() {
  return (
    <div className="font-sans antialiased bg-slate-50 min-h-screen flex flex-col text-slate-900">
      {/* Top Header */}
      <header className="fixed top-0 left-0 right-0 z-40 bg-white/90 backdrop-blur-md border-b border-slate-200 pt-safe">
        <div className="h-16 px-4 sm:px-5 max-w-xl mx-auto flex items-center justify-between">
          <div className="flex items-center gap-3">
            <div className="w-9 h-9 rounded-lg bg-white text-slate-900 border border-slate-200 flex items-center justify-center shrink-0">
              <span className="material-symbols-outlined text-[20px]">local_hospital</span>
            </div>
            <div className="min-w-0">
              <h1 className="text-sm font-semibold text-slate-900 leading-tight truncate">Felege Hiwot Hospital</h1>
              <p className="text-xs text-slate-500 leading-none mt-0.5">APTS Outpatient Pharmacy</p>
            </div>
          </div>
          <div className="flex items-center gap-2 shrink-0">
            <span className="font-mono text-xs font-medium bg-slate-100 text-slate-700 px-2.5 py-1 rounded-md border border-slate-200">OPD-03</span>
            <button
              aria-label="Print Document"
              className="w-9 h-9 flex items-center justify-center rounded-lg text-slate-600 hover:text-slate-900 hover:bg-slate-100 transition-colors"
            >
              <span className="material-symbols-outlined text-[20px]">print</span>
            </button>
          </div>
        </div>
      </header>

      {/* Main Content */}
      <main className="flex-1 w-full max-w-xl mx-auto pt-24 pb-12 px-4 sm:px-5 flex flex-col gap-6">
        <div className="bg-white rounded-2xl border border-slate-200 shadow-lg overflow-hidden">
          {/* Prescription Header */}
          <section className="px-5 sm:px-6 py-6">
            <div className="flex items-start justify-between gap-3 mb-5">
              <div className="min-w-0">
                <p className="text-xs font-semibold text-slate-500 uppercase tracking-wider mb-1">Prescription</p>
                <h2 className="text-base font-semibold text-slate-900 tracking-tight leading-snug">Felege Hiwot Comprehensive Specialized Hospital</h2>
                <p className="text-sm text-slate-500 mt-1">Bahir Dar, Amhara Region, +251 58 220 1887</p>
              </div>
              <span className="font-mono text-xs font-semibold text-slate-700 bg-slate-50 px-2.5 py-1 rounded-full border border-slate-200 whitespace-nowrap shrink-0">Regular • 30 days</span>
            </div>
            <div className="grid grid-cols-2 gap-4 pt-5 border-t border-dashed border-slate-200">
              <div>
                <span className="text-xs text-slate-400 font-medium">Serial</span>
                <div className="font-mono font-semibold text-slate-900 mt-1">FHRX-2024-098412</div>
              </div>
              <div className="text-right">
                <span className="text-xs text-slate-400 font-medium">Date</span>
                <div className="font-mono font-semibold text-slate-900 mt-1">24/10/2024</div>
              </div>
            </div>
          </section>

          {/* Patient & Clinical */}
          <section className="px-5 sm:px-6 py-6 border-t border-slate-100 bg-slate-50/40">
            <div className="flex items-center justify-between mb-4">
              <h3 className="text-sm font-semibold text-slate-900">Patient & Clinical Information</h3>
              <span className="font-mono text-xs font-medium text-slate-700 bg-white px-2.5 py-1 rounded-md border border-slate-200">MRN: FH-49821-B</span>
            </div>
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-x-6 gap-y-4 text-sm">
              <div className="flex flex-col gap-0.5">
                <span className="text-xs text-slate-400 font-medium">Patient Name</span>
                <span className="font-semibold text-slate-900">Abebe Tadesse Worku</span>
              </div>
              <div className="flex flex-col gap-0.5">
                <span className="text-xs text-slate-400 font-medium">Age & Gender</span>
                <span className="font-medium text-slate-800">42 Yrs • Male</span>
              </div>
              <div className="flex flex-col gap-0.5">
                <span className="text-xs text-slate-400 font-medium">Location</span>
                <span className="font-medium text-slate-800">Kebele 04, Bahir Dar</span>
              </div>
              <div className="flex flex-col gap-0.5">
                <span className="text-xs text-slate-400 font-medium">Allergy Status</span>
                <span className="font-medium text-slate-900 flex items-center gap-1">
                  <span className="material-symbols-outlined text-sm">check_circle</span>
                  NKDA (No Allergies)
                </span>
              </div>
            </div>
            <div className="mt-5 pt-4 border-t border-slate-200/70">
              <span className="text-xs text-slate-400 font-medium">Clinical Diagnosis</span>
              <div className="text-sm font-semibold text-slate-900 leading-relaxed mt-1">Community-Acquired Pneumonia (CAP) with Mild Dehydration</div>
              <div className="flex flex-wrap gap-2 mt-2">
                <span className="font-mono text-xs text-slate-600 bg-white px-2 py-0.5 rounded-md border border-slate-200">ICD-10: J13</span>
                <span className="font-mono text-xs text-slate-600 bg-white px-2 py-0.5 rounded-md border border-slate-200">ICD-10: E86.0</span>
              </div>
            </div>
          </section>

          {/* Medication Orders */}
          <section className="px-5 sm:px-6 py-6 border-t border-slate-100">
            <div className="flex items-center justify-between mb-4">
              <h3 className="text-sm font-semibold text-slate-900">Medication Orders</h3>
              <span className="text-xs font-mono text-slate-500">2 items</span>
            </div>
            <div className="flex flex-col divide-y divide-slate-100">
              <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-2 py-3 first:pt-0">
                <div className="flex items-start gap-3">
                  <span className="font-mono text-sm font-semibold text-slate-400 mt-0.5">1</span>
                  <div>
                    <h4 className="text-sm font-semibold text-slate-900 leading-snug">Amoxicillin 500 mg</h4>
                    <div className="text-xs text-slate-500 mt-0.5">Capsule • Oral (PO)</div>
                  </div>
                </div>
                <span className="font-mono text-xs font-semibold bg-white text-slate-900 border border-slate-300 px-2.5 py-1 rounded-md whitespace-nowrap self-start sm:self-auto">Mitte: 21 Caps</span>
              </div>
              <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-2 py-3 last:pb-0">
                <div className="flex items-start gap-3">
                  <span className="font-mono text-sm font-semibold text-slate-400 mt-0.5">2</span>
                  <div>
                    <h4 className="text-sm font-semibold text-slate-900 leading-snug">Oral Rehydration Salts (ORS) 20.5g</h4>
                    <div className="text-xs text-slate-500 mt-0.5">Powder for solution • Oral (PO)</div>
                  </div>
                </div>
                <span className="font-mono text-xs font-semibold bg-white text-slate-900 border border-slate-300 px-2.5 py-1 rounded-md whitespace-nowrap self-start sm:self-auto">Mitte: 4 Sachets</span>
              </div>
            </div>
          </section>

          {/* Prescriber */}
          <section className="px-5 sm:px-6 py-6 border-t border-slate-100">
            <h3 className="text-sm font-semibold text-slate-900 mb-4">Prescriber Verification</h3>
            <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4">
              <div className="flex flex-col gap-0.5">
                <span className="text-sm font-semibold text-slate-900">Dr. Dawit Mengistu, MD</span>
                <span className="text-xs text-slate-500">Internal Medicine Specialist</span>
                <span className="font-mono text-xs text-slate-400 mt-0.5">Lic: EFDA-MD-11842</span>
              </div>
              <div className="flex flex-col items-start sm:items-end gap-1">
                <span className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-slate-100 text-slate-900 text-xs font-semibold">
                  <span className="material-symbols-outlined text-sm text-slate-600">check_circle</span>
                  Signed & Verified
                </span>
                <span className="text-xs text-slate-400 font-mono">24/10/2024</span>
              </div>
            </div>
          </section>

          {/* Regulatory */}
          <section className="px-5 sm:px-6 py-5 border-t border-slate-100 bg-slate-50/60 text-xs text-slate-500">
            <p className="leading-relaxed">
              <span className="font-semibold text-slate-700">EFDA Standard Regulation:</span> Standard form valid 30 days. Non-controlled medicines only.
            </p>
            <p className="text-xs text-slate-400 mt-1 font-mono">
              Narcotics (Red) • Psychotropics (Blue): 15-day limit, single-item mandate.
            </p>
          </section>
        </div>

        {/* Actions */}
        <div className="flex flex-col gap-3">
          <button className="w-full h-12 bg-white text-slate-900 border border-slate-300 rounded-xl font-semibold text-sm flex items-center justify-center gap-2 hover:bg-slate-50 active:scale-[0.99] transition-all">
            <span className="material-symbols-outlined text-[18px]">check_circle</span>
            Confirm Dispensation
          </button>
          <button className="w-full h-11 bg-white text-slate-800 border border-slate-300 rounded-xl font-medium text-sm flex items-center justify-center gap-2 hover:bg-slate-50 transition-colors">
            <span className="material-symbols-outlined text-[18px] text-slate-500">archive</span>
            Print & Archive Prescription
          </button>
        </div>
      </main>
    </div>
  );
}
