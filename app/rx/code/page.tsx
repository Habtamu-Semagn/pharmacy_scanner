import type { Metadata } from "next";
import PrescriptionScreen from "@/components/PrescriptionScreen";

export const metadata: Metadata = {
  title: "Prescription - Endod Health",
  robots: { index: false, follow: false },
};

// Code + phone lookups land here. The code and phone stay out of the URL:
// the scanner page keeps them in this tab's sessionStorage.
export default function RxCodePage() {
  return <PrescriptionScreen token={null} />;
}
