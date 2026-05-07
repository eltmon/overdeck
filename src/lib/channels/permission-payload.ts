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
}):
  | { ok: true; value: NormalizedChannelPermissionRequestFields }
  | { ok: false; error: string } {
  const requestId = typeof input.requestId === 'string' ? input.requestId.trim() : '';
  if (!requestId) {
    return { ok: false, error: 'requestId is required' };
  }
  if (utf8ByteLength(requestId) > CHANNEL_PERMISSION_LIMITS.requestIdBytes) {
    return {
      ok: false,
      error: `requestId exceeds ${CHANNEL_PERMISSION_LIMITS.requestIdBytes} bytes`,
    };
  }

  const toolName = typeof input.toolName === 'string' ? input.toolName.trim() : '';
  if (!toolName) {
    return { ok: false, error: 'toolName is required' };
  }
  if (utf8ByteLength(toolName) > CHANNEL_PERMISSION_LIMITS.toolNameBytes) {
    return {
      ok: false,
      error: `toolName exceeds ${CHANNEL_PERMISSION_LIMITS.toolNameBytes} bytes`,
    };
  }

  const description = typeof input.description === 'string' ? input.description.trim() : '';
  if (!description) {
    return { ok: false, error: 'description is required' };
  }
  if (utf8ByteLength(description) > CHANNEL_PERMISSION_LIMITS.descriptionBytes) {
    return {
      ok: false,
      error: `description exceeds ${CHANNEL_PERMISSION_LIMITS.descriptionBytes} bytes`,
    };
  }

  const inputPreview = normalizePermissionInputPreview(input.inputPreview);
  if (utf8ByteLength(inputPreview) > CHANNEL_PERMISSION_LIMITS.inputPreviewBytes) {
    return {
      ok: false,
      error: `inputPreview exceeds ${CHANNEL_PERMISSION_LIMITS.inputPreviewBytes} bytes`,
    };
  }

  return {
    ok: true,
    value: {
      requestId,
      toolName,
      description,
      inputPreview,
    },
  };
}
