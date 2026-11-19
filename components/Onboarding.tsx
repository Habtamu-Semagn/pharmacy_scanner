"use client";

import Link from "next/link";

function ScannerIllustration() {
  return (
    <svg className="h-full w-full text-white" fill="none" viewBox="0 0 200 200" aria-hidden="true">
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
        <path d="M 0,22 C 45,22 45,62 120,62 L 270,62 C 345,62 345,22 390,22 L 390,62 L 0,62 Z" fill="#ffffff" />
      </svg>
    </div>
  );
}

function ContinueDock() {
  return (
    <div className="pointer-events-auto absolute -bottom-[2px] left-1/2 flex -translate-x-1/2 flex-col items-center">
      <div className="relative flex h-[72px] w-[154px] items-start justify-center">
        <svg className="absolute inset-0 h-full w-full text-[#19191b]" fill="none" viewBox="0 0 138 64" aria-hidden="true">
          <path d="M 0,64 C 36,64 36,12 69,12 C 102,12 102,64 138,64 Z" fill="currentColor" />
        </svg>
        <Link
          href="/scan"
          aria-label="Continue to scanner"
          data-testid="onboarding-continue"
          className="relative z-10 -mt-3 flex h-[56px] w-[56px] cursor-pointer items-center justify-center rounded-full border-[3px] border-[#19191b] bg-[#F8B133] shadow-md transition-all hover:brightness-105 active:scale-95"
        >
          <svg className="h-5 w-5 stroke-[2.8] text-[#19191b]" fill="none" stroke="currentColor" viewBox="0 0 24 24" aria-hidden="true">
            <path d="M13.5 4.5L21 12m0 0l-7.5 7.5M21 12H3" strokeLinecap="round" strokeLinejoin="round" />
          </svg>
        </Link>
      </div>
    </div>
  );
}

export default function OnboardingScreen() {
  return (
    <main className="relative flex min-h-dvh w-full flex-col bg-[#19191b]">
      <section className="relative flex min-h-[46dvh] flex-1 items-center justify-center bg-rings px-6 pb-20 pt-16 sm:min-h-[54dvh] sm:pb-24 sm:pt-20">
        <div className="relative flex h-52 w-52 items-center justify-center sm:h-60 sm:w-60">
          <ScannerIllustration />
        </div>
      </section>

      <div className="relative z-10 -mt-[62px] w-full">
        <WaveDivider />
        <section className="relative -mt-px bg-white px-6 pb-24 pt-4 text-center sm:px-8 sm:pt-6">
          <div className="mx-auto max-w-2xl">
            <h1 className="mb-3 text-[34px] font-bold tracking-tight text-gray-900 sm:text-[40px]">Get Started</h1>
            <p className="mx-auto max-w-xl text-[15px] font-medium leading-[1.7] text-gray-500 sm:text-base">
              Scan a patient’s Endod prescription QR code, or enter the 6-digit SMS code and phone number to view and record what you dispense.
            </p>
          </div>
          <ContinueDock />
        </section>
      </div>
    </main>
  );
}
