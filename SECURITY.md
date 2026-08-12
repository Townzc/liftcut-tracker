# Security policy

## Supported version

Security fixes are applied to the current default branch and the production
deployment at [www.liftcuttracker.com](https://www.liftcuttracker.com/).

## Reporting a vulnerability

Please do not open a public issue for a suspected vulnerability or include
secrets, account data, or health records in a report. Use GitHub's private
vulnerability reporting feature on this repository when available. If it is not
available, contact the maintainer through the email listed on the maintainer's
GitHub profile and include only the minimum information needed to reproduce the
issue safely.

Useful reports include:

- affected route, feature, or commit;
- impact and realistic attack scenario;
- minimal reproduction steps;
- suggested mitigation, if known.

The maintainer will acknowledge a complete report as soon as practical, keep
the reporter informed during triage, and coordinate disclosure after a fix is
available.

## Security boundaries

- AI provider keys are server-only and must never use a `NEXT_PUBLIC_` prefix.
- Supabase Row Level Security policies are the primary authorization boundary
  for user-owned data.
- Guest data stays in the current browser until the user chooses to register
  and migrate it.
- Exercise and nutrition guidance is educational and must not be treated as a
  medical diagnosis or emergency service.
