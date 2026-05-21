import { CheckCircle2, TriangleAlert } from "lucide-react";

import type { ReactNode } from "react";

import { Alert, AlertAction, AlertDescription, AlertTitle } from "@/components/ui/alert";

export function ActionFeedback({
  message,
  error,
  title,
  errorTitle,
  action,
  className,
}: {
  message?: string | null;
  error?: string | null;
  title?: string;
  errorTitle?: string;
  action?: ReactNode;
  className?: string;
}) {
  if (!message && !error) {
    return null;
  }

  return (
    <div className={className ?? "space-y-2"}>
      {message ? (
        <Alert className="border-emerald-200 bg-emerald-50 text-emerald-900">
          <CheckCircle2 className="h-4 w-4" />
          {title ? <AlertTitle>{title}</AlertTitle> : null}
          <AlertDescription>{message}</AlertDescription>
          {action ? <AlertAction>{action}</AlertAction> : null}
        </Alert>
      ) : null}
      {error ? (
        <Alert variant="destructive" className="border-rose-200 bg-rose-50">
          <TriangleAlert className="h-4 w-4" />
          {errorTitle ? <AlertTitle>{errorTitle}</AlertTitle> : null}
          <AlertDescription>{error}</AlertDescription>
        </Alert>
      ) : null}
    </div>
  );
}
