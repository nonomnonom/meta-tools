# Security policy

## Reporting a vulnerability

Do not report vulnerabilities in a public issue or pull request. Use GitHub's private vulnerability reporting for this repository when it is enabled. If private reporting is unavailable, contact the repository maintainer through the contact options on the `Nonomxyz` GitHub profile and share only the details needed to investigate.

Include the affected version or commit, the impact, and steps to reproduce. Do not include live access tokens, app secrets, or real account data. The maintainer can request a minimal reproduction using redacted values.

## Credentials and API access

Treat Meta and Threads tokens and `META_TOKEN_ENCRYPTION_KEY` as secrets. In per-user mode, the server encrypts OAuth credentials in its SQLite database; protect persistent storage and backups as sensitive data. Use least-privilege permissions, rotate any exposed credential, and do not enable shared-token mode for untrusted MCP users. Tool availability does not grant Meta permissions or bypass app review.

The encryption key is required to read existing connection records. Back it up separately from the database and do not rotate or replace it without first re-encrypting the records; losing it makes saved credentials unrecoverable. Pair OAuth callback grants with `meta_complete_connection` only from the MCP identity that should own that Meta account.
