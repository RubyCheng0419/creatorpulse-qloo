// An error that already knows its HTTP status and any extra response fields.
export class ApiError extends Error {
  constructor(message: string, public status: number, public extra: Record<string, unknown> = {}) {
    super(message);
  }
}

// A caught value, read safely. Thrown values here are Errors, some carrying the HTTP status
// (Qloo, Gemini), Qloo's attempt log (`http`) or `final` (Qloo: not worth a retry).
export type CaughtError = Partial<Error> & { status?: number; http?: string; final?: boolean };
export const caught = (e: unknown): CaughtError => (typeof e === 'object' && e !== null ? (e as CaughtError) : { message: String(e) });
export const errorMessage = (e: unknown): string => caught(e).message || String(e);
