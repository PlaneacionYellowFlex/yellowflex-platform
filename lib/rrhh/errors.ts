export class RrhhServiceError extends Error {
  constructor(
    message: string,
    readonly status = 400,
    readonly code?: string,
  ) {
    super(message);
    this.name = "RrhhServiceError";
  }
}