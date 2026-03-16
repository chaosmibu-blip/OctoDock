# Security Policy

## Reporting a Vulnerability

**Please do NOT report security vulnerabilities through public GitHub Issues.**

If you discover a security vulnerability in OctoDock, please report it responsibly:

1. Email: **security@octo-dock.com**
2. Include:
   - Description of the vulnerability
   - Steps to reproduce
   - Potential impact
   - Suggested fix (if any)

## Response Timeline

- **24 hours**: Acknowledgment of your report
- **72 hours**: Initial assessment and severity classification
- **7 days**: Fix or mitigation plan

## Scope

The following are in scope:
- Token/credential exposure
- Authentication bypass
- SQL injection
- XSS in Dashboard
- OAuth flow vulnerabilities
- MCP endpoint security

## Token Security

OctoDock encrypts all user tokens with AES-256-GCM before storing in the database. The encryption key is read from the `TOKEN_ENCRYPTION_KEY` environment variable and is never hardcoded.

## Responsible Disclosure

We appreciate your help in keeping OctoDock secure. After a fix is deployed, we will credit you in the release notes (unless you prefer to remain anonymous).
