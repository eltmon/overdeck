import { describe, expect, it } from "vitest"
import { Schema } from "effect"
import {
  ArtifactListResponse,
  ArtifactMetadataResponse,
  ArtifactPublishResponse,
  ArtifactValidationResult,
} from "./index"

const currentHash = "sha256:aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa"
const lastPublishedHash = "sha256:bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb"

const finding = {
  code: "asset.relative_path",
  message: "Relative asset paths are not allowed in artifacts.",
  severity: "error",
  line: 12,
  column: 8,
} as const

const validationPayload = {
  ok: false,
  errors: [finding],
  warnings: [{ ...finding, code: "secret.suppressed", severity: "warning" as const }],
  strictModeFindings: [{ ...finding, code: "strict.image_alt", severity: "warning" as const }],
  size: 48231,
  hash: currentHash,
} satisfies typeof ArtifactValidationResult.Encoded

const artifactPayload = {
  artifactId: "01HXYZARTIFACT000000000000",
  slug: "k3p9m2qr",
  issueId: "PAN-1205",
  workspaceId: "workspace-pan-1205",
  agentRole: "work",
  agentHarness: "claude-code",
  runId: "run-pan-1205-slot-1",
  sessionId: "session-123",
  filePath: "/tmp/workspace/comparison.html",
  currentHash,
  lastPublishedHash,
  supersedes: "01HXYZPREVIOUS0000000000",
  createdAt: "2026-05-25T00:00:00.000Z",
  updatedAt: "2026-05-25T00:10:00.000Z",
  publishedAt: "2026-05-25T00:10:00.000Z",
  title: "RAG Approach Comparison",
  description: "Side-by-side comparison of three approaches.",
} as const

const statusPayload = {
  artifactId: artifactPayload.artifactId,
  slug: artifactPayload.slug,
  filePath: artifactPayload.filePath,
  currentHash,
  lastPublishedHash,
  pendingChanges: true,
  size: 48231,
  unshared: false,
  errors: validationPayload.errors,
  warnings: validationPayload.warnings,
  strictModeFindings: validationPayload.strictModeFindings,
} as const

const urlsPayload = {
  wrapperUrl: "https://pan.localhost/s/k3p9m2qr",
  rawUrl: "https://artifacts.pan.localhost/a/k3p9m2qr",
} as const

describe("artifact contracts", () => {
  it("decodes validation results with errors, warnings, size, hash, and strict-mode findings", () => {
    const parsed = Schema.decodeUnknownSync(ArtifactValidationResult)(validationPayload)

    expect(parsed.errors).toHaveLength(1)
    expect(parsed.warnings).toHaveLength(1)
    expect(parsed.strictModeFindings[0]?.code).toBe("strict.image_alt")
    expect(parsed.size).toBe(48231)
    expect(parsed.hash).toBe(currentHash)
  })

  it("decodes metadata with full provenance and unshared state", () => {
    const parsed = Schema.decodeUnknownSync(ArtifactMetadataResponse)({
      artifact: { ...artifactPayload, unsharedAt: "2026-05-25T00:20:00.000Z" },
      status: { ...statusPayload, unshared: true, unsharedAt: "2026-05-25T00:20:00.000Z" },
      urls: urlsPayload,
    })

    expect(parsed.artifact).toMatchObject({
      artifactId: artifactPayload.artifactId,
      slug: artifactPayload.slug,
      issueId: "PAN-1205",
      workspaceId: "workspace-pan-1205",
      agentRole: "work",
      agentHarness: "claude-code",
      runId: "run-pan-1205-slot-1",
      sessionId: "session-123",
      filePath: "/tmp/workspace/comparison.html",
      currentHash,
      lastPublishedHash,
      supersedes: "01HXYZPREVIOUS0000000000",
      title: "RAG Approach Comparison",
      description: "Side-by-side comparison of three approaches.",
      unsharedAt: "2026-05-25T00:20:00.000Z",
    })
    expect(parsed.status.unshared).toBe(true)
    expect(parsed.status.pendingChanges).toBe(true)
  })

  it("decodes publish and list responses used by CLI and dashboard APIs", () => {
    const publish = Schema.decodeUnknownSync(ArtifactPublishResponse)({
      artifact: artifactPayload,
      status: statusPayload,
      urls: urlsPayload,
      validation: validationPayload,
      published: true,
    })
    const list = Schema.decodeUnknownSync(ArtifactListResponse)({
      artifacts: [{ artifact: artifactPayload, status: statusPayload, urls: urlsPayload, thumbnailUrl: "/api/artifacts/k3p9m2qr/thumbnail" }],
    })

    expect(publish.published).toBe(true)
    expect(list.artifacts[0]?.status.currentHash).toBe(currentHash)
    expect(list.artifacts[0]?.status.lastPublishedHash).toBe(lastPublishedHash)
    expect(list.artifacts[0]?.status.pendingChanges).toBe(true)
  })

  it("rejects invalid hashes and unknown harness values", () => {
    expect(() => Schema.decodeUnknownSync(ArtifactValidationResult)({
      ...validationPayload,
      hash: "sha256:not-a-real-hash",
    })).toThrow()
    expect(() => Schema.decodeUnknownSync(ArtifactMetadataResponse)({
      artifact: { ...artifactPayload, agentHarness: "unknown" },
      status: statusPayload,
      urls: urlsPayload,
    })).toThrow()
  })
})
