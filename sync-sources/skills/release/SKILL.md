---
name: release
description: Step-by-step release process with versioning
---

# Release Process

## 1. Version Bump
- Update version in package.json / pom.xml / etc.
- Update CHANGELOG.md with new version section
- Commit: `chore: bump version to X.Y.Z`

## 2. Final Verification
- Run full test suite
- Run build process
- Smoke test critical paths

## 3. Create Release
- Tag: `git tag -a vX.Y.Z -m "Release X.Y.Z"`
- Push: `git push origin main --tags`

## 4. Post-Release
- Verify deployment (if auto-deploy)
- Monitor for issues
- Announce if needed
