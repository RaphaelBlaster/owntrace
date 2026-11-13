# Security and Privacy Baseline

OwnTrace may eventually process sensitive identity, email metadata, OAuth tokens, breach information, and account records. The project therefore starts with these rules:

- Never commit `.env` files, credentials, OAuth secrets, tokens, production data, or real user data.
- Keep authentication tokens out of frontend local storage; prefer secure httpOnly cookies.
- Validate inputs, minimize stored data, and request the least OAuth privilege required.
- Store derived email metadata rather than full inbox content wherever possible.
- Never log passwords, OAuth tokens, or sensitive email content.
- Configure CORS, secure cookies, rate limits, and security headers before production authentication is enabled.
- Encrypt sensitive stored credentials or tokens when those integrations are introduced.

## Authentication controls

- Passwords are hashed with bcrypt and the stored `passwordHash` is excluded from normal queries and API serialization.
- Session JWTs use an explicit issuer, audience, algorithm allowlist, seven-day expiry, and an httpOnly cookie.
- Development cookies use `SameSite=Lax`; production additionally requires `Secure` cookies through `NODE_ENV=production`.
- Unsafe browser requests require an `Origin` listed in `CLIENT_ORIGINS`, in addition to the CORS allowlist.
- Helmet, JSON body limits, general API rate limiting, and tighter registration/login rate limiting are enabled. See [RATE_LIMITING.md](RATE_LIMITING.md).
- Authentication failures avoid exposing whether an email exists, and unexpected errors do not return internal details.

These controls reduce common risks but are not a claim that the application is deployment-ready. OAuth state, provider-token encryption, account-level authorization, CSRF review for future mutations, and production infrastructure remain milestone-specific work.
