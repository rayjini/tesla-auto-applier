# Tesla Careers Applier

Automates Tesla internship applications from a visible Chrome session using Playwright.

The repo is set up so you can keep private data out of Git:

- `profile.json` is the tracked template / shared config.
- `profile.local.json` is optional and ignored by Git.
- If `profile.local.json` exists, the script uses it instead of `profile.json`.
- `submitted_jobs.json` is created locally and ignored by Git to prevent duplicate submissions on later runs.

## Requirements

- Node.js 18+
- Google Chrome
- A Tesla account signed in on the Chrome session you use for applications

## Setup

1. Install dependencies:

```bash
npm install
```

2. Configure your profile:

- Edit `profile.json` if you are fine keeping your values in the repo.
- Prefer copying `profile.json` to `profile.local.json` and editing that if you do not want personal data committed.

3. Start Chrome with remote debugging:

```bash
/Applications/Google\ Chrome.app/Contents/MacOS/Google\ Chrome --remote-debugging-port=9222 --user-data-dir=/tmp/tesla-codex-chrome --disable-first-run-ui 'https://www.tesla.com/careers/search/?department=engineering-information-technology&type=intern&site=US'
```

4. Sign in to Tesla in that Chrome window before running submit mode.

## Running Without An Agent

List the currently eligible roles:

```bash
npm run list
```

Dry-run the full queue without submitting:

```bash
npm run dry-run
```

Submit the full eligible queue:

```bash
npm run submit
```

By default, the script skips any requisition IDs already recorded in `submitted_jobs.json`.

Submit only specific job IDs:

```bash
node scripts/apply_tesla_roles.js --mode submit --ids 269812
```

Submit multiple specific job IDs:

```bash
node scripts/apply_tesla_roles.js --mode submit --ids 269812,267004
```

Run only a limited number of jobs:

```bash
node scripts/apply_tesla_roles.js --mode submit --limit 3
```

Force a rerun even if an ID is already in the local submission history:

```bash
node scripts/apply_tesla_roles.js --mode submit --ids 269812 --ignore-history
```

## Running With An Agent

If you use Codex / ChatGPT as a local coding agent:

1. Open this repo in the agent.
2. Start the Chrome command above.
3. Ask the agent to run one of these:

- Full submit run: `node scripts/apply_tesla_roles.js --mode submit`
- Specific jobs only: `node scripts/apply_tesla_roles.js --mode submit --ids 269812`
- Dry run: `node scripts/apply_tesla_roles.js --mode dry-run`

Useful prompts:

- `Run the Tesla applier in submit mode.`
- `Run the Tesla applier only for job ID 269812.`
- `List the currently eligible Tesla roles first, then submit only the IDs I choose.`

## Profile Fields

Edit these fields in `profile.json` or `profile.local.json`:

- `firstName`: First name used in the application
- `lastName`: Last name used in the application
- `legalName`: Full legal name used for acknowledgments
- `phone`: Digits only works best
- `email`: Contact email
- `country`: Tesla country dropdown label, usually `United States`
- `resumePath`: Absolute path to your resume PDF
- `graduationDate.month`: Month label shown by Tesla, for example `April 2027`
- `graduationDate.day`: Day of month as a string, for example `30`
- `durationLabel`: Internship duration dropdown label, for example `4 months`
- `considerOtherRoles`: `yes` or `no`
- `sponsorship`: `yes` or `no`
- `formerEmployee`: `yes` or `no`
- `formerInternOrContractor`: `yes` or `no`
- `universityStudent`: `yes` or `no`
- `textConsent`: `yes` or `no`
- `thesis`: `yes` or `no`
- `gender`: Tesla EEO dropdown label
- `veteran`: Tesla veteran-status dropdown label
- `race`: Tesla race / ethnicity dropdown label
- `disability`: Tesla disability-status dropdown label

## Common Options

- `--mode list`: Print eligible roles only
- `--mode dry-run`: Fill applications without submitting
- `--mode submit`: Fill and submit applications
- `--ids 269812,267004`: Run only specific requisition IDs
- `--skip 269812,267004`: Skip specific requisition IDs
- `--limit 3`: Process only the first N matching jobs
- `--ignore-history`: Ignore `submitted_jobs.json` and reconsider previously successful IDs
- `--slow-ms 1000`: Add delays between steps if Tesla gets flaky

## Notes

- The script expects a visible Chrome window with remote debugging enabled on `127.0.0.1:9222`.
- It filters for US Tesla internships that match software / data / technical role patterns in the script.
- It includes a submit-payload fix for Tesla's occasional invalid `eeoCopyUrl` value.
- Successful submissions are written to `submitted_jobs.json` so later full reruns skip those requisition IDs.
- If Tesla shows a new or unusual question page, stop and inspect before blindly continuing.
