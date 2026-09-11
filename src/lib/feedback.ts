import { toast } from "sonner";

/** The API's `message` when there is one, else the fallback — calm, one line. */
export function errorText(e: unknown, fallback: string): string {
  return e instanceof Error && e.message ? e.message : fallback;
}

export function toastError(e: unknown, fallback: string) {
  toast.error(errorText(e, fallback));
}
