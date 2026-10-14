export type ErrorStatus = 400 | 403 | 404 | 409 | 422 | 501;

/** An expected failure with an HTTP status; surfaced as-is by the API and MCP layers. */
export class DomainError extends Error {
  constructor(message: string, readonly status: ErrorStatus = 400) {
    super(message);
    this.name = "DomainError";
  }
}
