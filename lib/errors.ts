// An error that already knows its HTTP status and any extra response fields.
export class ApiError extends Error {
  constructor(message: string, public status: number, public extra: Record<string, unknown> = {}) {
    super(message);
  }
}
