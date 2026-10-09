# Security policy

## Reporting a vulnerability

Do not report vulnerabilities in a public issue or pull request. Use GitHub's private vulnerability reporting for this repository when it is enabled. If private reporting is unavailable, contact the repository maintainer through the contact options on the `Nonomxyz` GitHub profile and share only the details needed to investigate.

Include the affected version or commit, the impact, and steps to reproduce. Do not include live access tokens, app secrets, or real account data. The maintainer can request a minimal reproduction using redacted values.

## Credentials and API access

Treat Meta and Threads tokens as secrets. Use least-privilege permissions, store credentials in the MCP client's secret manager, and rotate any token that may have been exposed. Tool availability does not grant Meta permissions or bypass app review.
