"use client";

import Link from "next/link";
import type { ReactNode } from "react";

export function AuthExperience({
  title,
  description,
  children,
}: {
  title: string;
  description: string;
  children: ReactNode;
}) {
  return (
    <section className="mx-auto flex min-h-[calc(100dvh-4rem)] w-full max-w-sm flex-col justify-center py-12">
      <Link href="/" className="mb-12 self-center text-2xl font-semibold tracking-tight">
        liftcut.
      </Link>
      <div className="mb-8 text-center">
        <h1 className="text-2xl font-semibold">{title}</h1>
        <p className="mt-3 text-sm leading-6 text-muted-foreground">{description}</p>
      </div>
      {children}
    </section>
  );
}
