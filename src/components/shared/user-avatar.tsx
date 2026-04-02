"use client";
/* eslint-disable @next/next/no-img-element */

import { cn } from "@/lib/utils";

function getAvatarFallbackLabel(displayName?: string, email?: string): string {
  const source = (displayName || email || "U").trim();
  const first = source[0];
  return first ? first.toUpperCase() : "U";
}

interface UserAvatarProps {
  displayName?: string;
  email?: string;
  avatarUrl?: string;
  className?: string;
  textClassName?: string;
}

export function UserAvatar({ displayName, email, avatarUrl, className, textClassName }: UserAvatarProps) {
  if (avatarUrl) {
    return (
      <img
        src={avatarUrl}
        alt={displayName || email || "avatar"}
        className={cn("h-10 w-10 rounded-full border border-slate-200 object-cover", className)}
      />
    );
  }

  return (
    <div
      className={cn(
        "flex h-10 w-10 items-center justify-center rounded-full border border-slate-200 bg-emerald-100 text-sm font-semibold text-emerald-700",
        className,
      )}
    >
      <span className={cn("leading-none", textClassName)}>{getAvatarFallbackLabel(displayName, email)}</span>
    </div>
  );
}
