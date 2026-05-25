import { describe, expect, it } from "vitest"
import { Schema } from "effect"
import {
  ArtifactCreateResponse,
  ArtifactListResponse,
  ArtifactMetadata,
  ArtifactStatusResponse,
  ArtifactValidationResult,
  WorkspaceArtifactsResponse,
} from "./artifacts"

const decodeArtifactMetadata = Schema.decodeUnknownSync(ArtifactMetadata)
const decodeArtifactValidationResult = Schema.decodeUnknownSync(ArtifactValidationResult)
const decodeArtifactStatusResponse = Schema.decodeUnknownSync(ArtifactStatusResponse)
const decodeArtifactCreateResponse = Schema.decodeUnknownSync(ArtifactCreateResponse)
const decodeArtifactListResponse = Schema.decodeUnknownSync(ArtifactListResponse)
const decodeWorkspaceArtifactsResponse = Schema.decodeUnknownSync(WorkspaceArtifactsResponse)

const metadata = {
  artifactId: "01JZ0000000000000000000000",
  slug: "k3p9m2qr",
  issueId: "PAN-1205",
  workspaceId: "feature-pan-1205-slot-2",
  agentRole: "work",
  agentHarness: "claude-code",
  runId: "RUN-42",
  sessionId: "session-123",
  filePath: "/tmp/comparison.html",
  currentHash: "sha256:def456",
  lastPublishedHash: "sha256:abc123",
  supersedes: "01JY0000000000000000000000",
  title: "RAG Approach Comparison",
  description: "Compares three implementation options.",
  createdAt: "2026-05-25T00:00:00.000Z",
  publishedAt: "2026-05-25T00:01:00.000Z",
  unsharedAt: null,
} satisfies typeof ArtifactMetadata.Encoded

const validation = {
  ok: false,
  filePath: "/tmp/comparison.html",
  size: 48231,
  hash: "sha256:def456",
  strict: true,
  errors: [
    {
      code: "secret_detected",
      message: "GitHub token detected",
      line: 18,
      column: 5,
      rule: "github_pat",
    },
  ],
  warnings: [
    {
      code: "high_entropy_string",
      message: "High-entropy string detected",
      line: 22,
      strict: true,
    },
  ],
} satisfies typeof ArtifactValidationResult.Encoded

const urls = {
  wrapperUrl: "https://pan.localhost/s/k3p9m2qr",
  rawUrl: "https://artifacts.pan.localhost/a/k3p9m2qr",
}

describe("artifact contracts", () => {
  it("decodes provenance metadata with publish and unshare state", () => {
    const parsed = decodeArtifactMetadata(metadata)

    expect(parsed.artifactId).toBe("01JZ0000000000000000000000")
    expect(parsed.slug).toBe("k3p9m2qr")
    expect(parsed.issueId).toBe("PAN-1205")
    expect(parsed.workspaceId).toBe("feature-pan-1205-slot-2")
    expect(parsed.agentRole).toBe("work")
    expect(parsed.agentHarness).toBe("claude-code")
    expect(parsed.runId).toBe("RUN-42")
    expect(parsed.sessionId).toBe("session-123")
    expect(parsed.filePath).toBe("/tmp/comparison.html")
    expect(parsed.currentHash).toBe("sha256:def456")
    expect(parsed.lastPublishedHash).toBe("sha256:abc123")
    expect(parsed.supersedes).toBe("01JY0000000000000000000000")
    expect(parsed.title).toBe("RAG Approach Comparison")
    expect(parsed.description).toBe("Compares three implementation options.")
    expect(parsed.createdAt).toBe("2026-05-25T00:00:00.000Z")
    expect(parsed.publishedAt).toBe("2026-05-25T00:01:00.000Z")
    expect(parsed.unsharedAt).toBeNull()
  })

  it("decodes validation and status responses with strict findings and pending changes", () => {
    const parsedValidation = decodeArtifactValidationResult(validation)
    const parsedStatus = decodeArtifactStatusResponse({
      artifact: metadata,
      filePath: metadata.filePath,
      currentHash: metadata.currentHash,
      lastPublishedHash: metadata.lastPublishedHash,
      pendingChanges: true,
      validation,
    })

    expect(parsedValidation.errors[0].code).toBe("secret_detected")
    expect(parsedValidation.warnings[0].strict).toBe(true)
    expect(parsedStatus.currentHash).toBe("sha256:def456")
    expect(parsedStatus.lastPublishedHash).toBe("sha256:abc123")
    expect(parsedStatus.pendingChanges).toBe(true)
  })

  it("decodes create responses and dashboard artifact payloads", () => {
    const createResponse = decodeArtifactCreateResponse({
      artifact: metadata,
      urls,
      validation: { ...validation, ok: true, errors: [] },
      published: true,
    })
    const listResponse = decodeArtifactListResponse({
      artifacts: [
        {
          artifact: metadata,
          urls,
          status: "pending_changes",
          pendingChanges: true,
          thumbnailUrl: "https://pan.localhost/api/artifacts/k3p9m2qr/thumbnail",
        },
      ],
    })
    const workspaceResponse = decodeWorkspaceArtifactsResponse({
      issueId: "PAN-1205",
      workspaceId: "feature-pan-1205-slot-2",
      artifacts: listResponse.artifacts,
    })

    expect(createResponse.urls.rawUrl).toBe("https://artifacts.pan.localhost/a/k3p9m2qr")
    expect(listResponse.artifacts[0].status).toBe("pending_changes")
    expect(workspaceResponse.artifacts).toHaveLength(1)
  })

  it("rejects unknown roles, harnesses, and validation codes", () => {
    expect(() => decodeArtifactMetadata({ ...metadata, agentRole: "developer" })).toThrow()
    expect(() => decodeArtifactMetadata({ ...metadata, agentHarness: "unknown" })).toThrow()
    expect(() => decodeArtifactValidationResult({
      ...validation,
      errors: [{ ...validation.errors[0], code: "xss_detected" }],
    })).toThrow()
  })
})
