import type { Metadata } from "next";
import Link from "next/link";
import { AuthShell } from "@/components/brand";
import { ForgotForm } from "./forgot-form";

export const metadata: Metadata = { title: "Account help · Hackathon Studio" };

export default function ForgotPage() {
  return (
    <AuthShell
      title="Account help"
      subtitle="An admin will check and send you a reset link"
      footer={
        <Link href="/login" className="font-semibold text-brand-deep">
          ← Back to sign in
        </Link>
      }
    >
      <aside
        aria-labelledby="reset-email-note"
        className="mb-6 rounded-xl border-2 border-amber-400 bg-amber-50 p-5 text-amber-950 dark:border-amber-500 dark:bg-amber-950 dark:text-amber-100"
      >
        <h2 id="reset-email-note" className="text-lg font-bold">
          Check your Junk or Spam folder
        </h2>
        <p className="mt-2 text-base leading-relaxed">
          Your password reset email may appear in Junk or Spam instead of your inbox.
          Please check these folders closely for “Reset your KMIDS Hack Portal password”
          from no-reply@kmidshackportal.com. If you find it there, mark it as not junk or spam.
        </p>
      </aside>
      <ForgotForm />
    </AuthShell>
  );
}
