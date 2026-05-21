import { Data, Effect } from 'effect';

export const CHANNEL_PERMISSION_LIMITS = {
  requestIdBytes: 128,
  toolNameBytes: 128,
  descriptionBytes: 2 * 1024,
  inputPreviewBytes: 16 * 1024,
} as const;

export interface NormalizedChannelPermissionRequestFields {
  requestId: string;
  toolName: string;
  description: string;
  inputPreview: string;
}

/** A permission request field failed validation. */
export class PermissionPayloadValidationError extends Data.TaggedError(
  'PermissionPayloadValidationError',
)<{
  readonly field: string;
  readonly message: string;
}> {}

export function utf8ByteLength(value: string): number {
  return Buffer.byteLength(value, 'utf8');
}

export function normalizePermissionInputPreview(value: unknown): string {
  return typeof value === 'string' ? value : '';
}

export function normalizeChannelPermissionRequestFields(input: {
  requestId: unknown;
  toolName: unknown;
  description: unknown;
  inputPreview?: unknown;
}): Effect.Effect<NormalizedChannelPermissionRequestFields, PermissionPayloadValidationError> {
  return Effect.gen(function* () {
    const requestId = typeof input.requestId === 'string' ? input.requestId.trim() : '';
    if (!requestId) {
      return yield* Effect.fail(
        new PermissionPayloadValidationError({ field: 'requestId', message: 'requestId is required' }),
      );
    }
    if (utf8ByteLength(requestId) > CHANNEL_PERMISSION_LIMITS.requestIdBytes) {
      return yield* Effect.fail(
        new PermissionPayloadValidationError({
          field: 'requestId',
          message: `requestId exceeds ${CHANNEL_PERMISSION_LIMITS.requestIdBytes} bytes`,
        }),
      );
    }

    const toolName = typeof input.toolName === 'string' ? input.toolName.trim() : '';
    if (!toolName) {
      return yield* Effect.fail(
        new PermissionPayloadValidationError({ field: 'toolName', message: 'toolName is required' }),
      );
    }
    if (utf8ByteLength(toolName) > CHANNEL_PERMISSION_LIMITS.toolNameBytes) {
      return yield* Effect.fail(
        new PermissionPayloadValidationError({
          field: 'toolName',
          message: `toolName exceeds ${CHANNEL_PERMISSION_LIMITS.toolNameBytes} bytes`,
        }),
      );
    }

    const description = typeof input.description === 'string' ? input.description.trim() : '';
    if (!description) {
      return yield* Effect.fail(
        new PermissionPayloadValidationError({
          field: 'description',
          message: 'description is required',
        }),
      );
    }
    if (utf8ByteLength(description) > CHANNEL_PERMISSION_LIMITS.descriptionBytes) {
      return yield* Effect.fail(
        new PermissionPayloadValidationError({
          field: 'description',
          message: `description exceeds ${CHANNEL_PERMISSION_LIMITS.descriptionBytes} bytes`,
        }),
      );
    }

    const inputPreview = normalizePermissionInputPreview(input.inputPreview);
    if (utf8ByteLength(inputPreview) > CHANNEL_PERMISSION_LIMITS.inputPreviewBytes) {
      return yield* Effect.fail(
        new PermissionPayloadValidationError({
          field: 'inputPreview',
          message: `inputPreview exceeds ${CHANNEL_PERMISSION_LIMITS.inputPreviewBytes} bytes`,
        }),
      );
    }

    return { requestId, toolName, description, inputPreview };
  });
}
