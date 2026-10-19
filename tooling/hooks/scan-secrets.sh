#!/bin/sh
# Pre-commit: scan the staged changes for secrets. lefthook runs this file, because on Windows
# it can't run a multi-line `run:` script (sh reports "unexpected end of file").
if ! command -v gitleaks >/dev/null 2>&1; then
  echo "gitleaks is not installed, so this commit can't be checked for secrets."
  echo "Install it, then commit again:"
  echo "  Windows: winget install Gitleaks.Gitleaks"
  echo "  Any system with Go: go install github.com/zricethezav/gitleaks/v8@v8.30.1"
  exit 1
fi
exec gitleaks git --pre-commit --staged --redact --no-banner
