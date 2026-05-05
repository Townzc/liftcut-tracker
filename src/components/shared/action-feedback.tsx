import { CheckCircle2, TriangleAlert } from "lucide-react";

import { Alert, AlertDescription } from "@/components/ui/alert";

export function ActionFeedback({
  message,
  error,
  className,
}: {
  message?: string | null;
  error?: string | null;
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
          <AlertDescription>{message}</AlertDescription>
        </Alert>
      ) : null}
      {error ? (
        <Alert variant="destructive" className="border-rose-200 bg-rose-50">
          <TriangleAlert className="h-4 w-4" />
          <AlertDescription>{error}</AlertDescription>
        </Alert>
      ) : null}
    </div>
  );
}
