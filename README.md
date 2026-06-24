# langfuse-claudecode-hook-ts

TypeScript port of [langfuse-claudecode-hook](https://github.com/chanyeongkil/langfuse-claudecode-hook) — a Claude Code Stop hook that sends conversation traces to [Langfuse](https://langfuse.com) for observability.

Each assistant turn produces a trace with a span, an LLM generation, and a tool observation per tool call.

## Installation

### Quick install (recommended)

```bash
# 1. Clone anywhere
git clone <this-repo> ~/langfuse-claudecode-ts
cd ~/langfuse-claudecode-ts

# 2. Build and register the hook globally (~/.claude/settings.json)
make install

# 3. Configure credentials for your project (run from project root)
cd /your/project
make -C ~/langfuse-claudecode-ts setup
```

### What `make install` does

1. Builds the TypeScript source
2. Copies everything to `~/.claude/hooks/langfuse-claudecode-ts/`
3. Adds the Stop hook to `~/.claude/settings.json` automatically

### Per-project credentials

`make setup` runs an interactive prompt and writes `.claude/settings.local.json` in the current directory:

```json
{
  "env": {
    "TRACE_TO_LANGFUSE": "true",
    "LANGFUSE_PUBLIC_KEY": "pk-lf-...",
    "LANGFUSE_SECRET_KEY": "sk-lf-...",
    "LANGFUSE_BASE_URL": "https://cloud.langfuse.com",
    "CC_LANGFUSE_USER_ID": "you@example.com",
    "CC_LANGFUSE_ENVIRONMENT": "my-project"
  }
}
```

Add `.claude/settings.local.json` to your `.gitignore`.

### Uninstall

```bash
make uninstall
```

Removes the hook from `~/.claude/settings.json` and deletes `~/.claude/hooks/langfuse-claudecode-ts/`.

### Manual setup (without make)

<details>
<summary>Expand</summary>

```bash
git clone <this-repo> ~/.claude/hooks/langfuse-claudecode-ts
cd ~/.claude/hooks/langfuse-claudecode-ts
npm install && npm run build
```

Add to `~/.claude/settings.json`:

```json
{
  "hooks": {
    "Stop": [
      {
        "hooks": [
          {
            "type": "command",
            "command": "node ~/.claude/hooks/langfuse-claudecode-ts/dist/index.js"
          }
        ]
      }
    ]
  }
}
```

</details>

## Configuration

| Variable | Required | Default | Description |
|---|---|---|---|
| `TRACE_TO_LANGFUSE` | yes | — | Set to `"true"` to enable tracing |
| `LANGFUSE_PUBLIC_KEY` | yes | — | Langfuse project public key |
| `LANGFUSE_SECRET_KEY` | yes | — | Langfuse project secret key |
| `LANGFUSE_BASE_URL` | no | `https://cloud.langfuse.com` | Langfuse host URL |
| `CC_LANGFUSE_USER_ID` | no | — | User ID for traces (e.g. email) |
| `CC_LANGFUSE_ENVIRONMENT` | no | — | Environment name (lowercase, max 40 chars) |
| `CC_LANGFUSE_DEBUG` | no | `false` | Verbose debug logging |
| `CC_LANGFUSE_MAX_CHARS` | no | `20000` | Max characters before truncation |

## Troubleshooting

```bash
# Check hook logs
tail -f ~/.claude/state/langfuse_hook.log

# Test manually
echo '{}' | TRACE_TO_LANGFUSE=true LANGFUSE_PUBLIC_KEY=pk-lf-... LANGFUSE_SECRET_KEY=sk-lf-... \
  node ~/.claude/hooks/langfuse-claudecode-ts/dist/index.js
```

## License

MIT
