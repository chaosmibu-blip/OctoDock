# OctoDock Channel Plugin for Claude Code

Receive real-time events from your connected apps (Telegram, Gmail, GitHub, Notion, etc.) directly in your Claude Code session.

## Setup

1. Install the plugin:
   ```
   /plugin install octodock@claude-plugins-official
   ```

2. Configure your API key (get it from [OctoDock Dashboard](https://octo-dock.com/dashboard)):
   ```
   /octodock:configure ak_your_api_key_here
   ```

3. Start Claude Code with the channel enabled:
   ```
   claude --channels plugin:octodock@claude-plugins-official
   ```

## How it works

```
Claude Code ←(stdio)→ This Plugin (local) ←(SSE)→ OctoDock Cloud ←(APIs)→ Your Apps
```

The plugin runs locally on your machine as a Claude Code subprocess. It connects to OctoDock's cloud service via SSE to receive events, then forwards them to your Claude Code session.

## Features

- **Real-time events**: Telegram messages, Gmail emails, GitHub PRs, Notion updates, and more
- **Reply tool**: Claude Code can reply through OctoDock (e.g., respond to Telegram messages, reply to emails)
- **Auto-reconnect**: SSE connection automatically reconnects on failure

## Development

```bash
# Install dependencies
npm install

# Run locally for testing
claude --dangerously-load-development-channels ./

# Build for distribution
npm run build
```

## Privacy

- The plugin runs on YOUR machine, using YOUR network
- Events are streamed from OctoDock cloud to your local plugin only
- Your API key is stored locally in `~/.octodock/config.json`
