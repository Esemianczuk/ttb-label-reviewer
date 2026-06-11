export function humanizeApiError(error: unknown): string {
  if (error instanceof Error) return error.message;
  return "The console could not complete that request.";
}
