#!/usr/bin/env bash
# Builds the Linux agent binary. Same mitigations as build.ps1: no packer,
# no aggressive stripping - see agent/README.md for the reasoning.
set -euo pipefail
cd "$(dirname "$0")/.."

VERSION="${1:-0.1.0}"

CGO_ENABLED=0 go build -trimpath -ldflags "-X main.version=$VERSION" -o dist/omniprint-agent ./cmd/agent
