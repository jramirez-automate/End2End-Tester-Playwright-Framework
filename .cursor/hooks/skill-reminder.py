#!/usr/bin/env python3
"""Nudge the e2e skills when a prompt is about tests, before any spec is edited."""
import json
import re
import sys

try:
    data = json.load(sys.stdin)
except Exception:
    sys.exit(0)

prompt = data.get("prompt") or ""
if not re.search(r"(\be2e\b|playwright|\.spec\.ts\b|page object|flaky)", prompt, re.IGNORECASE):
    sys.exit(0)

print(
    json.dumps(
        {
            "hookSpecificOutput": {
                "hookEventName": "UserPromptSubmit",
                "additionalContext": (
                    "End-to-end work detected. Load the e2e-testing-patterns skill "
                    "before writing or editing a Playwright spec or page object, "
                    "follow AGENTS.md, and check docs/APP-MAP.md for the route and "
                    "any existing helper."
                ),
            }
        }
    )
)
