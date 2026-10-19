# Security policy

## Reporting a vulnerability

Please report security issues **privately** through [GitHub's private vulnerability reporting](https://github.com/mahnoor114/pak-climate-portal/security/advisories/new), not in a public issue. Include the steps to reproduce and the impact. You will get a reply as soon as possible.

## How the project is protected

- **Secrets:** API keys and the database password are read from environment variables and are never stored in the repository.
- **Static files:** the server serves only the built app and the portal's data files. Requests for secrets or for paths outside the portal folder return 404, and the CI tests check this.
- **Deploy runner:** deployments run on a self-hosted runner. Workflows from outside contributors need the maintainer's approval before they run, and the deploy job runs only for `main`, never for pull requests.
