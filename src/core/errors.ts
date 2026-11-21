export class HttpError extends Error {
  constructor(
    readonly status: number,
    readonly code: string,
    readonly field?: string,
    readonly extra?: Record<string, number>,
  ) {
    super(code);
    this.name = "HttpError";
  }

  body(): { error: string; field?: string; retryAfter?: number } {
    const body: { error: string; field?: string; retryAfter?: number } = { error: this.code };
    if (this.field !== undefined) body.field = this.field;
    const retryAfter = this.extra?.retryAfter;
    if (retryAfter !== undefined) body.retryAfter = retryAfter;
    return body;
  }
}
