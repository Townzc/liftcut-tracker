import type { Metadata } from "next";
import { ResetPasswordForm } from "@/components/auth/reset-password-form";

export const metadata: Metadata = { robots: { index: false, follow: false }, referrer: "no-referrer" };
export default function ResetPasswordPage() { return <ResetPasswordForm />; }
