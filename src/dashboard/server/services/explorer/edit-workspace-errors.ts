/**
 * Edit-workspace route error (PAN-5191 D-F19).
 *
 * Edit-workspace services throw an EditWorkspaceError when a request fails
 * for a reason the operator can act on. The route module answers it with
 * `{ error: message, code }` and `status`; any other error goes through
 * `explorerErrorResponse`.
 */
export class EditWorkspaceError extends Error {
  constructor(
    readonly code: string,
    readonly status: number,
    message: string,
  ) {
    super(message);
    this.name = 'EditWorkspaceError';
  }
}
