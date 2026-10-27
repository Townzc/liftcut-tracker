import type { Metadata } from "next";
import { AccountDeletionPage } from "@/components/auth/account-deletion-page";
export const metadata: Metadata = { robots: { index: false, follow: false }, referrer: "no-referrer" };
export default function DeleteAccountPage() { return <AccountDeletionPage />; }
