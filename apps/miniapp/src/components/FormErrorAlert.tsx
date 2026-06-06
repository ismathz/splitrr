import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { cn } from "@/lib/utils";

export function FormErrorAlert({
  message,
  title,
  className,
}: {
  message: string | null | undefined;
  /** Optional short heading (e.g. “Couldn’t read receipt”). */
  title?: string;
  className?: string;
}) {
  if (!message?.trim()) return null;
  return (
    <Alert variant="destructive" className={cn("py-3", className)}>
      {title ? <AlertTitle>{title}</AlertTitle> : null}
      <AlertDescription
        className={title ? "text-destructive/90" : undefined}
      >
        {message.trim()}
      </AlertDescription>
    </Alert>
  );
}
