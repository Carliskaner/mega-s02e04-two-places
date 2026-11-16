# S02E04 Two Places Worker

This repository contains the manually triggered GitHub Actions worker for job 2 and its local MCP stdio bridge. The workflow pins `gpt-6-luna`, caps the Copilot session at 25 included AI credits, and uploads only a hybrid-encrypted result artifact with a 7-day retention period.

The job endpoint is supplied at runtime through the `JOB_2_MCP_URL` repository secret. It is not stored in this repository, the MCP configuration, command arguments, or the model prompt. The Copilot token is supplied through `COPILOT_GITHUB_TOKEN`.

The private decryption key belongs only in the ignored local evidence directory. Never upload plaintext receipts or results. The workflow is manual-only; do not dispatch it until the course tool cost and current job-link validity have been checked.
