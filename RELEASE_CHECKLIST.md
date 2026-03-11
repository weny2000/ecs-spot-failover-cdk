# 🚀 Release Checklist

This checklist helps you complete the remaining steps to publish this project as a CDK Construct Library.

## ✅ Completed Items

### Critical Fixes (From AWS Hero OSS Review)
- [x] Fixed Clone URL in README (was pointing to wrong repo)
- [x] Fixed Fargate Spot pricing ($0.01232 → $0.02049/vCPU/hour for us-east-1)
- [x] Added GitHub Actions CI badge to README
- [x] Fixed package.json repository URLs
- [x] Added blog link and background story to README

### CDK Construct Library Structure
- [x] Created `lib/index.ts` for npm package exports
- [x] Created `src/constructs/fargate-spot-failover-construct.ts` - reusable construct
- [x] Added `.npmignore` for package publishing
- [x] Updated `package.json` with `publishConfig` and `files` array
- [x] Fixed `@aws-sdk/client-xray` package name

### PENDING Task Monitoring (Critical Feature)
- [x] Created `src/lambda/pending-task-monitor.ts` - detects tasks stuck in PENDING
- [x] Added EventBridge scheduled rule (1-minute interval)
- [x] Updated main stack to include PENDING monitoring
- [x] Updated architecture diagram in README
- [x] Added documentation for proactive monitoring

### Documentation
- [x] Updated CHANGELOG.md with release notes
- [x] Fixed CONTRIBUTING.md URLs
- [x] Added CDK Construct Library usage section to README
- [x] Added Construct Hub badge placeholder

## 📋 Remaining Steps

### 1. Create GitHub Release

```bash
# Create a git tag for the first release
git tag -a v1.0.0 -m "Release v1.0.0 - Initial stable release"
git push origin v1.0.0

# Or create release via GitHub UI
# Go to: https://github.com/weny2000/ecs-spot-failover-cdk/releases/new
```

### 2. Publish to npm

```bash
# Login to npm (one-time setup)
npm login

# Build the project
npm run build

# Publish to npm (dry run first)
npm publish --dry-run

# Publish for real
npm publish --access public
```

### 3. Publish to Construct Hub

After publishing to npm, the package will automatically appear on [Construct Hub](https://constructs.dev/) within 24 hours.

To ensure proper indexing:
- [ ] Verify `package.json` has `keywords` including `"cdk"`, `"aws-cdk"`, `"constructs"`
- [ ] Ensure README has proper installation instructions
- [ ] Check that `lib/index.ts` exports all public APIs

### 4. Add Blog Link (Qiita)

After publishing, update the README with the actual Qiita blog URL:

```markdown
- **Blog Post (Japanese)**: [Fargate Spot で月$42K が $21K になった話](https://qiita.com/weny/items/YOUR-ACTUAL-BLOG-URL)
```

Also add a link in your Qiita blog back to this GitHub repo:

```
→ 完全な CDK 実装は GitHub で公開しています: 
https://github.com/weny2000/ecs-spot-failover-cdk
```

### 5. Fix Unit Tests (Optional but Recommended)

The test files have some issues:

```bash
# Fix missing Lambda files in tests
# Update test/unit/lambda/fargate-failback-orchestrator.test.ts
# Update test/unit/lambda/cleanup-orchestrator.test.ts

# Fix AWS SDK X-Ray import in integration tests
# Update test/integration/failover.integration.test.ts
```

### 6. Enable GitHub Features

- [ ] Enable GitHub Discussions for community support
- [ ] Set up branch protection rules for `main`
- [ ] Configure CODEOWNERS file for PR reviews

### 7. Social Sharing

After release:
- [ ] Tweet about the release with cost savings highlights
- [ ] Post on LinkedIn targeting AWS/DevOps communities
- [ ] Share on relevant Reddit communities (r/aws, r/devops)
- [ ] Submit to AWS Open Source newsletter

## 📊 Expected Impact

After completing these steps:

| Metric | Before | After (Expected) |
|--------|--------|------------------|
| GitHub Stars | 2 | 50+ |
| npm Downloads | 0 | 100+/month |
| Construct Hub | Not listed | Listed |
| Community Issues/PRs | 0 | 5+ |
| AWS Hero Path | Example | Reusable Library |

## 🎯 Success Criteria

This project will achieve **Community Highlight ✨ → Recommended Tool 🛠️** status when:

1. **Published to npm** with proper semantic versioning
2. **Listed on Construct Hub** for discoverability
3. **50+ GitHub Stars** indicating community interest
4. **3+ external contributions** showing adoption
5. **Linked with Qiita blog** for traffic cross-pollination

---

**Next Action**: Create GitHub Release v1.0.0 → Publish to npm → Wait for Construct Hub indexing
