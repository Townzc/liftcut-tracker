import type { Metadata } from "next";

import { BeginnerDemo } from "@/components/demo/beginner-demo";

export const metadata: Metadata = {
  title: {
    absolute: "Beginner Exercise Demo | LiftCut Tracker",
  },
  description:
    "A free bilingual beginner exercise explorer with clear steps, easier variations, and safety-aware guidance.",
  alternates: {
    canonical: "https://www.liftcuttracker.com/demo",
  },
  openGraph: {
    title: "LiftCut Tracker Beginner Exercise Demo",
    description:
      "Start with clear movement steps, conservative doses, and safety-aware guidance — no signup required.",
    url: "https://www.liftcuttracker.com/demo",
    siteName: "LiftCut Tracker",
    type: "website",
  },
};

export default function DemoPage() {
  return <BeginnerDemo />;
}
