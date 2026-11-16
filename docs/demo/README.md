# Terminal Demo Recording

This directory contains the automated terminal recording scripts for Ebb.

The recording is generated from [`terminal.tape`](terminal.tape) using [VHS](https://github.com/charmbracelet/vhs). It is reproducible across releases because every time-sensitive command fixes the evaluation date with `--as-of 2026-11-15`.

## Commands Demonstrated

1. **Check component lifecycle**:
   ```bash
   npx @velella/ebb check pkg:npm/request@2.88.2
   ```
2. **Find recommended replacement**:
   ```bash
   npx @velella/ebb replacement pkg:npm/request@2.88.2
   ```
3. **Forecast upcoming end-of-life events within a time window**:
   ```bash
   npx @velella/ebb upcoming --within 180d --ecosystem nodejs --as-of 2026-11-15
   ```
4. **Choose supported version / release line**:
   ```bash
   npx @velella/ebb versions node --as-of 2026-11-15
   ```

## Re-recording Instructions

### Prerequisites

Install [VHS](https://github.com/charmbracelet/vhs):

```bash
# macOS
brew install vhs

# Linux / Debian / Ubuntu
sudo mkdir -p /etc/apt/keyrings
curl -fsSL https://repo.charm.sh/apt/gpg.key | sudo gpg --dearmor -o /etc/apt/keyrings/charm.gpg
echo "deb [signed-by=/etc/apt/keyrings/charm.gpg] https://repo.charm.sh/apt/ * *" | sudo tee /etc/apt/sources.list.d/charm.list
sudo apt update && sudo apt install vhs
```

### Build and Run

1. Build the local package:
   ```bash
   npm run build
   ```
2. Run VHS against the tape:
   ```bash
   vhs docs/demo/terminal.tape
   ```
3. Verify that the output files (`docs/demo/terminal.svg` or `docs/demo/terminal.gif`) stay under 2 MB.
