# Contributing to ECS Fargate Spot Failover

Thank you for your interest in contributing to this project! We welcome contributions from the community.

## 🌟 How to Contribute

### Reporting Issues

If you find a bug or have a suggestion:

1. Check if the issue already exists in the [issue tracker](https://github.com/yourusername/ecs-fargate-spot-failover/issues)
2. If not, create a new issue with:
   - Clear title and description
   - Steps to reproduce (for bugs)
   - Expected vs actual behavior
   - Environment details (OS, Node.js version, AWS region)
   - Relevant logs or screenshots

### Submitting Changes

1. **Fork the repository**
   ```bash
   git clone https://github.com/yourusername/ecs-fargate-spot-failover.git
   cd ecs-fargate-spot-failover
   ```

2. **Create a branch**
   ```bash
   git checkout -b feature/your-feature-name
   # or
   git checkout -b fix/your-bug-fix
   ```

3. **Make your changes**
   - Follow the existing code style
   - Add/update tests as needed
   - Update documentation

4. **Test your changes**
   ```bash
   npm install
   npm run build
   npm test
   npm run cdk synth
   ```

5. **Commit your changes**
   ```bash
   git add .
   git commit -m "feat: add your feature description"
   ```

   Follow [Conventional Commits](https://www.conventionalcommits.org/):
   - `feat:` New feature
   - `fix:` Bug fix
   - `docs:` Documentation changes
   - `style:` Code style changes (formatting, etc.)
   - `refactor:` Code refactoring
   - `test:` Test changes
   - `chore:` Build/dependency changes

6. **Push and create PR**
   ```bash
   git push origin feature/your-feature-name
   ```
   Then create a Pull Request on GitHub.

## 📋 Development Setup

### Prerequisites

- Node.js >= 18.x
- AWS CLI configured
- AWS CDK >= 2.x
- TypeScript >= 5.x

### Local Development

```bash
# Install dependencies
npm install

# Watch mode for TypeScript
npm run watch

# Build project
npm run build

# Run tests
npm test

# Synthesize CloudFormation template
npm run synth

# Deploy to dev environment
npm run deploy
```

### Project Structure

```
ecs-fargate-spot-failover/
├── src/
│   ├── app.ts                          # CDK app entry
│   ├── ecs-fargate-spot-failover-stack.ts  # Main stack
│   └── lambda/                         # Lambda functions
│       ├── cleanup-orchestrator.ts
│       ├── fargate-failback-orchestrator.ts
│       ├── spot-error-detector.ts
│       └── spot-success-monitor.ts
├── docs/                               # Documentation
├── examples/                           # Example configurations
├── scripts/                            # Helper scripts
├── test/                               # Unit tests
├── cdk.json                            # CDK configuration
├── tsconfig.json                       # TypeScript config
└── package.json
```

## 📝 Code Style

### TypeScript

- Use strict TypeScript configuration
- Explicit return types for public functions
- JSDoc comments for complex functions
- Prefer `interface` over `type` for object definitions

Example:
```typescript
/**
 * Updates error count in DynamoDB
 * @param serviceName - The ECS service name
 * @returns The updated error count
 */
async function updateErrorCount(serviceName: string): Promise<number> {
  // implementation
}
```

### CDK Best Practices

- Use constructs for reusable components
- Add meaningful descriptions to resources
- Use proper removal policies
- Tag resources appropriately

### Lambda Best Practices

- Keep functions focused and single-purpose
- Use environment variables for configuration
- Proper error handling with try-catch
- Log important events

## 🧪 Testing

### Unit Tests

```bash
# Run all tests
npm test

# Run with coverage
npm test -- --coverage

# Watch mode
npm test -- --watch
```

### Integration Tests

Before submitting PR:
1. Deploy to a test AWS account
2. Verify all Lambda functions work
3. Test failover scenario manually
4. Verify cleanup works correctly

### Test Checklist

- [ ] `npm run build` succeeds
- [ ] `npm test` passes
- [ ] `cdk synth` generates valid template
- [ ] No TypeScript errors
- [ ] Code follows project style

## 📖 Documentation

- Update README.md if changing user-facing features
- Update relevant docs in `docs/` folder
- Add JSDoc comments to new functions
- Update CHANGELOG.md with your changes

## 🎯 Areas for Contribution

### High Priority

- [ ] Multi-region support
- [ ] Additional notification channels (Slack, PagerDuty)
- [ ] CloudWatch Dashboard
- [ ] Cost optimization analytics

### Nice to Have

- [ ] Support for EC2 launch type
- [ ] Integration with AWS Systems Manager
- [ ] Blue/Green deployment support
- [ ] Custom metrics and alarms

### Documentation

- [ ] More deployment examples
- [ ] Video tutorials
- [ ] Best practices guide
- [ ] Troubleshooting FAQ

## 🏆 Recognition

Contributors will be recognized in:
- README.md contributors section
- Release notes
- Project documentation

## ❓ Questions?

- Open an issue for questions
- Join discussions in existing issues
- Check documentation first

## 📜 Code of Conduct

### Our Standards

- Be respectful and inclusive
- Accept constructive criticism
- Focus on what's best for the community
- Show empathy towards others

### Unacceptable Behavior

- Harassment or discrimination
- Trolling or insulting comments
- Personal or political attacks
- Publishing others' private information

## 🔒 Security

If you discover a security vulnerability:

1. **DO NOT** open a public issue
2. Email security@yourproject.com with details
3. Allow time for remediation before disclosure

## 📄 License

By contributing, you agree that your contributions will be licensed under the MIT License.

---

Thank you for contributing! 🚀
