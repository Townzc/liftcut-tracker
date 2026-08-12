# Contributing to LiftCut Tracker

Thanks for helping make fitness tracking clearer and more approachable for
beginners. Contributions are welcome across product code, accessibility,
translations, tests, documentation, deployment, and the LiftCut-Coach research
pipeline.

## Before opening a change

1. Search the existing issues and pull requests.
2. Open an issue for large product or schema changes so the scope can be agreed
   before implementation.
3. Never include real API keys, private health data, production database dumps,
   or third-party media without a compatible license.

## Local setup

```bash
npm install
cp .env.example .env.local
npm run dev
```

Supabase and AI credentials are optional for most UI work. Without them, use
guest mode and the public `/demo` route.

## Quality checks

Run the checks that match your change before opening a pull request:

```bash
npm test
npm run lint
npm run build
```

Please add or update tests for behavior changes. For UI changes, include a short
testing note covering desktop and mobile layouts, keyboard use, and both Chinese
and English where applicable.

## Pull request expectations

- Keep each pull request focused on one outcome.
- Explain what changed, why it matters, and how it was verified.
- Call out database migrations, environment variables, data-source licenses,
  and user-facing health guidance explicitly.
- Prefer conservative wording for health-related copy. The app should support
  informed choices, not present itself as a doctor or diagnose conditions.

By contributing, you agree that your contribution is licensed under the
project's [MIT License](LICENSE).
