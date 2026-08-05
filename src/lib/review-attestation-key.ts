import { createHmac, randomBytes, timingSafeEqual } from 'node:crypto';

export const REVIEW_ATTESTATION_KEY_ENV = 'OVERDECK_REVIEW_ATTESTATION_KEY';
export const REVIEW_ATTESTATION_TOKEN_ENV = 'OVERDECK_REVIEW_ATTESTATION_TOKEN';
export const REVIEW_ATTESTATION_VERSION = 1;
export const REVIEW_ATTESTATION_RUN_SUFFIX = 'att1';

function keyFromEnv(env: NodeJS.ProcessEnv = process.env): string | null {
  const key = env[REVIEW_ATTESTATION_KEY_ENV];
  return key && key.length >= 32 ? key : null;
}

export function ensureReviewAttestationKey(env: NodeJS.ProcessEnv = process.env): string {
  const existing = keyFromEnv(env);
  if (existing) return existing;
  const generated = randomBytes(32).toString('base64url');
  env[REVIEW_ATTESTATION_KEY_ENV] = generated;
  return generated;
}

export function hasReviewAttestationKey(env: NodeJS.ProcessEnv = process.env): boolean {
  return keyFromEnv(env) !== null;
}

export function signReviewAttestationPayload(
  payload: string,
  env: NodeJS.ProcessEnv = process.env,
): string | null {
  const key = keyFromEnv(env);
  return key ? createHmac('sha256', key).update(payload).digest('base64url') : null;
}

export function verifyReviewAttestationSignature(
  payload: string,
  signature: string,
  env: NodeJS.ProcessEnv = process.env,
): boolean {
  const expected = signReviewAttestationPayload(payload, env);
  if (!expected) return false;
  const expectedBytes = Buffer.from(expected);
  const actualBytes = Buffer.from(signature);
  return expectedBytes.length === actualBytes.length && timingSafeEqual(expectedBytes, actualBytes);
}

function reviewAgentTokenPayload(agentId: string, runId: string): string {
  return `review-artifact-attestation:v${REVIEW_ATTESTATION_VERSION}:${agentId}:${runId}`;
}

export function createReviewAgentAttestationToken(
  agentId: string,
  runId: string,
  env: NodeJS.ProcessEnv = process.env,
): string | null {
  return signReviewAttestationPayload(reviewAgentTokenPayload(agentId, runId), env);
}

export function verifyReviewAgentAttestationToken(
  agentId: string,
  runId: string,
  token: string,
  env: NodeJS.ProcessEnv = process.env,
): boolean {
  const expected = createReviewAgentAttestationToken(agentId, runId, env);
  if (!expected) return false;
  const expectedBytes = Buffer.from(expected);
  const actualBytes = Buffer.from(token);
  return expectedBytes.length === actualBytes.length && timingSafeEqual(expectedBytes, actualBytes);
}
