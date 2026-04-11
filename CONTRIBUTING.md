# Contributing to UniFlow OA Copilot

Thank you for your interest in contributing to UniFlow OA Copilot!

## Development Setup

1. Fork the repository
2. Clone your fork: `git clone https://github.com/your-username/uniflow-oa.git`
3. Install dependencies: `pnpm install`
4. Set up environment: `cp .env.example .env`
5. Start infrastructure: `docker compose up -d postgres redis minio`
6. Run migrations: `pnpm db:migrate`
7. Start development: `pnpm dev`

## Code Style

- We use ESLint and Prettier for code formatting
- Run `pnpm lint` to check for issues
- Run `pnpm format` to auto-format code
- Follow TypeScript best practices
- Write meaningful commit messages

## Testing

- Write unit tests for new features
- Ensure all tests pass: `pnpm test`
- Add integration tests for API endpoints
- Run E2E tests before submitting: `pnpm test:e2e`

## Pull Request Process

1. Create a feature branch: `git checkout -b feature/your-feature`
2. Make your changes
3. Add tests for your changes
4. Ensure all tests pass
5. Update documentation if needed
6. Commit your changes with clear messages
7. Push to your fork
8. Create a Pull Request

## Commit Message Format

```
type(scope): subject

body

footer
```

Types:
- `feat`: New feature
- `fix`: Bug fix
- `docs`: Documentation changes
- `style`: Code style changes (formatting)
- `refactor`: Code refactoring
- `test`: Adding or updating tests
- `chore`: Maintenance tasks

Example:
```
feat(assistant): add intent detection for delegate action

Implemented intent detection for delegation requests.
Added keyword matching and entity extraction.

Closes #123
```

## Code Review

- All PRs require at least one approval
- Address review comments promptly
- Keep PRs focused and reasonably sized
- Update your PR based on feedback

## Reporting Issues

- Use GitHub Issues
- Provide clear reproduction steps
- Include error messages and logs
- Specify your environment (OS, Node version, etc.)

## Questions?

- Open a GitHub Discussion
- Check existing issues and PRs
- Read the documentation

Thank you for contributing!
