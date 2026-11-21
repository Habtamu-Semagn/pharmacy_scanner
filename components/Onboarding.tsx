"use client";

import Link from "next/link";

function ScannerIllustration() {
  return (
    <svg className="h-full w-full text-primary" fill="none" viewBox="0 0 200 200" aria-hidden="true">
      <path d="M 22 55 L 22 34 C 22 25.16 29.16 18 38 18 L 59 18" stroke="currentColor" strokeLinecap="round" strokeLinejoin="round" strokeWidth="8" />
      <path d="M 141 18 L 162 18 C 170.84 18 178 25.16 178 34 L 178 55" stroke="currentColor" strokeLinecap="round" strokeLinejoin="round" strokeWidth="8" />
      <path d="M 22 145 L 22 166 C 22 174.84 29.16 182 38 182 L 59 182" stroke="currentColor" strokeLinecap="round" strokeLinejoin="round" strokeWidth="8" />
      <path d="M 141 182 L 162 182 C 170.84 182 178 174.84 178 166 L 178 145" stroke="currentColor" strokeLinecap="round" strokeLinejoin="round" strokeWidth="8" />
      <line stroke="currentColor" strokeLinecap="round" strokeWidth="6.5" x1="20" x2="180" y1="100" y2="100" />
      <rect fill="none" height="37" rx="7" stroke="currentColor" strokeWidth="7" width="37" x="40" y="36" />
      <circle cx="58.5" cy="54.5" fill="currentColor" r="4.5" />
      <rect fill="none" height="37" rx="7" stroke="currentColor" strokeWidth="7" width="37" x="123" y="36" />
      <circle cx="141.5" cy="54.5" fill="currentColor" r="4.5" />
      <rect fill="none" height="37" rx="7" stroke="currentColor" strokeWidth="7" width="37" x="40" y="117" />
      <rect fill="currentColor" height="10" rx="2" width="10" x="53.5" y="130.5" />
      <rect fill="currentColor" height="13" rx="3.5" width="13" x="114" y="114" />
      <rect fill="currentColor" height="12" rx="3.5" width="22" x="139" y="114" />
      <rect fill="currentColor" height="11" rx="3.5" width="28" x="99" y="135" />
      <rect fill="currentColor" height="11" rx="3.5" width="24" x="137" y="135" />
      <rect fill="currentColor" height="15" rx="3.5" width="13" x="114" y="154" />
      <rect fill="currentColor" height="12" rx="3.5" width="25" x="136" y="155" />
    </svg>
  );
}

function WaveDivider() {
  return (
    <div className="w-full overflow-hidden leading-none">
      <svg className="relative block h-[62px] w-full" fill="none" preserveAspectRatio="none" viewBox="0 0 390 62" aria-hidden="true">
        <path d="M 0,22 C 45,22 45,62 120,62 L 270,62 C 345,62 345,22 390,22 L 390,62 L 0,62 Z" fill="#FBF9F6" />
      </svg>
    </div>
  );
}

function ContinueDock() {
  return (
    <div className="pointer-events-auto absolute -bottom-[2px] left-1/2 z-30 flex -translate-x-1/2 flex-col items-center">
      <div className="relative w-full flex justify-center items-end">
        <svg className="w-44 h-24 block translate-y-[1px] text-accent-deep" fill="none" viewBox="0 0 176 96" aria-hidden="true">
          <path d="M 0 96 C 28 96 46 64 64 30 C 74 11 80 4 88 4 C 96 4 102 11 112 30 C 130 64 148 96 176 96 Z" fill="currentColor" />
        </svg>
        <Link
          href="/scan"
          aria-label="Continue to scanner"
          data-testid="onboarding-continue"
          className="absolute top-0 -translate-y-3 flex h-14 w-14 items-center justify-center rounded-[9999px] border-2 border-accent-deep bg-surface shadow-md transition-all hover:brightness-95 active:scale-95 p-0"
        >
          <svg className="h-5 w-5 text-on-cta" fill="none" stroke="currentColor" strokeLinecap="round" strokeLinejoin="round" strokeWidth="2.5" viewBox="0 0 24 24" aria-hidden="true">
            <line x1="5" x2="19" y1="12" y2="12" />
            <polyline points="12 5 19 12 12 19" />
          </svg>
        </Link>
      </div>
    </div>
  );
}

export default function OnboardingScreen() {
  return (
    <main className="relative flex min-h-dvh w-full flex-col bg-bg">
      <section className="relative flex min-h-[46dvh] flex-1 items-center justify-center bg-surface-alt px-6 pb-20 pt-16 sm:min-h-[54dvh] sm:pb-24 sm:pt-20">
        <div className="relative flex h-52 w-52 items-center justify-center sm:h-60 sm:w-60">
          <ScannerIllustration />
        </div>
      </section>

      <div className="relative z-10 -mt-[62px] w-full">
        <WaveDivider />
        <section className="relative -mt-px bg-bg px-6 pb-24 pt-10 text-center sm:px-8 sm:pt-12">
          <div className="mx-auto max-w-2xl">
            <h1 className="mb-3 text-[34px] font-bold tracking-tight text-heading sm:text-[40px]">Get Started</h1>
            <p className="mx-auto mb-8 max-w-xl text-[15px] font-medium leading-[1.7] text-body sm:text-base">
              Scan a patient’s Endod prescription QR code, or enter the 6-digit SMS code to view and record what you dispense.
            </p>
          </div>
          <ContinueDock />
        </section>
      </div>
    </main>
  );
}
