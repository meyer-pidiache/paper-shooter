# Security scanning

The Security workflow runs only on manual dispatch and scans changes from the configured base.
Strix sends its LLM
requests to the deployed [OmniRoute](https://omniroute.hagicode.com/) OpenAI-compatible endpoint
with the model `openai/auto`, so OmniRoute chooses the provider and model for each request. The
workflow installs a pinned Strix release and verifies its SHA-256 before running it. Moving to a
new release means updating `STRIX_VERSION` and `STRIX_SHA256` together.

Configure these under **Settings → Secrets and variables → Actions**:

| Name                 | Kind     | Required | Purpose                                                                                     |
| -------------------- | -------- | -------- | ------------------------------------------------------------------------------------------- |
| `OMNIROUTE_BASE_URL` | Variable | Yes      | HTTPS OpenAI-compatible base ending in `/v1`, e.g. `https://router.example/v1`              |
| `OMNIROUTE_API_KEY`  | Secret   | Yes      | OmniRoute API key, sent only as a bearer token                                              |
| `STRIX_FAIL_ON`      | Variable | No       | Minimum severity that fails the check; defaults to `high`                                   |
| `STRIX_MAX_BUDGET`   | Variable | No       | Estimated LLM spend threshold in USD per scan (default `10`). Actual charges can exceed it. |
| `STRIX_SARIF_UPLOAD` | Variable | No       | Set to `true` to upload SARIF findings to Code Scanning                                     |

Before scanning, the workflow calls `GET <base>/models` and fails with an explicit error if the
configuration is missing, the URL format is wrong, the key is rejected or the endpoint cannot be
reached. The check also fails if Strix exits with a setup error, if a finding meets `STRIX_FAIL_ON`
or if the run status is anything other than `completed`. A passing check does not guarantee full
coverage of the diff or establish the amount billed by the provider. The reported cost depends on
pricing and usage data, and requests already in flight can exceed the configured threshold.
Findings below the severity threshold still appear in the report. When generated, the
`strix_runs/` report is retained as the `strix-report` artifact for 14 days. Only the separate
Code Scanning upload job receives `security-events: write`.
