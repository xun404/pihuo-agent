# Security Policy

## Supported versions

Security fixes are applied to the latest release. Older releases and source
snapshots are not maintained as separate security-support branches.

## Reporting a vulnerability

Please use GitHub's private vulnerability reporting for this repository:

1. Open the repository's **Security** tab.
2. Choose **Report a vulnerability**.
3. Include affected versions, reproduction steps, impact, and any suggested
   mitigation.

Please do not open a public issue for an unpatched vulnerability, and do not
include exploit code, credentials, API keys, or decrypted Router Agents state
in public reports.

Reports are reviewed on a best-effort basis. We will acknowledge a valid
report, investigate it, and coordinate disclosure when a fix is available.

Router Agents stores provider secrets locally in encrypted form, but security
reports must still assume that exported logs, screenshots, and state files can
contain sensitive project information.
