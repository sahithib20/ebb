# VHS Tape: Ebb Terminal Demo
# Generates terminal.gif / terminal.svg for README and documentation.
# Re-record using: vhs docs/demo/terminal.tape

Output docs/demo/terminal.gif

Set Shell "bash"
Set FontSize 14
Set Width 860
Set Height 520
Set Theme "Catppuccin Frappe"
Set FontFamily "JetBrains Mono, Menlo, monospace"
Set Padding 20
Set TypingSpeed 35ms

# 1. Check a deprecated package
Type "npx @velella/ebb check pkg:npm/request@2.88.2"
Enter
Sleep 2.5s

# 2. Get recommended replacement
Type "npx @velella/ebb replacement pkg:npm/request@2.88.2"
Enter
Sleep 2s

# 3. Forecast upcoming end-of-life events
Type "npx @velella/ebb upcoming --within 180d --ecosystem nodejs --as-of 2026-11-15"
Enter
Sleep 2.5s

# 4. Find which version to install
Type "npx @velella/ebb versions node --as-of 2026-11-15"
Enter
Sleep 3s
