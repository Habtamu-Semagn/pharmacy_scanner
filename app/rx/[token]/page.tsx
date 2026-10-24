import { Suspense } from "react";
import type { Metadata } from "next";
import PrescriptionScreen from "@/components/PrescriptionScreen";

export const metadata: Metadata = {
  title: "Prescription - Endod Health",
  robots: { index: false, follow: false },
};

// Opened from the QR (https://pharmacy.endod-health.com/rx/<token>), either
// by the scanner on `/` or directly by a phone camera app.
export default function RxTokenPage({ params }: { params: Promise<{ token: string }> }) {
  return (
    <Suspense fallback={null}>
      {params.then(({ token }) => (
        <PrescriptionScreen token={token} />
      ))}
    </Suspense>
  );
}
