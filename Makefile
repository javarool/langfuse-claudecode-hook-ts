HOOK_DIR := $(HOME)/.claude/hooks/langfuse-claudecode-ts

.PHONY: build install setup uninstall

build:
	npm install
	npx tsc

# Copy to global hook dir, build there, register in ~/.claude/settings.json
install: build
	@node scripts/install.js $(HOOK_DIR)

# Configure credentials for the current project (.claude/settings.local.json)
setup:
	@node scripts/setup.js

# Remove hook from ~/.claude/settings.json and delete hook dir
uninstall:
	@node scripts/uninstall.js $(HOOK_DIR)
