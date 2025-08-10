# Hivemind

Collaborative Obsidian notes with real-time synchronization.

Hivemind enables seamless collaboration on Obsidian notes through team-based sharing and real-time
synchronization. Share individual notes with your team, create collaborative workspaces, and keep
everyone in sync automatically.

## Features

- **Real-time collaboration**: Share notes with team members and see changes instantly
- **Team management**: Create teams, join existing ones, and manage team memberships
- **Auto-sync**: Automatically sync team documents to designated folders
- **Share links**: Generate shareable links for easy document access
- **File recovery**: Automatic recovery of missing shared notes

## Getting Started

### Prerequisites

- Obsidian (minimum version 0.15.0)
- A Keepsync server for real-time synchronization
  - Go to the [Tonk repository](https://github.com/tonk-labs/tonk) to install the Tonk CLI
  - Create a server with `tonk server create`
- Node.js (for development)

### Installation

1. Download the latest release from the releases page
2. Extract the files to your vault's plugins folder: `VaultFolder/.obsidian/plugins/hivemind/`
3. Enable the plugin in Obsidian's settings
4. Configure your sync server URL and user ID in the plugin settings

### Configuration

1. Open Obsidian Settings → Community Plugins → Hivemind
2. Set your **User ID** (unique identifier for collaboration)
3. Set your **Sync Server URL** (WebSocket server for real-time sync)
4. Click "Save & Connect" to establish connection

## Usage

### Sharing Notes

**Right-click method:**

1. Right-click on any markdown file
2. Select "🔗 Share with team"
3. Choose your team from the list

**Command palette:**

- `Hivemind: Share current note with team`
- `Hivemind: Unshare current note`

### Team Management

**Create a team:**

- Use command: `Hivemind: Create a new team`
- Enter team ID and display name

**Join a team:**

- Use command: `Hivemind: Join a team`
- Enter the team ID provided by team admin

**Join from share link:**

- Use command: `Hivemind: Join document from share link`
- Paste the `hivemind://` link

### Auto-Sync

Enable auto-sync to automatically download and sync all team documents:

1. Go to plugin settings
2. Find your team in the Teams section
3. Click "Enable Auto-sync"
4. Configure sync folder (default: "Shared")

### Share Links

Generate shareable links for easy collaboration:

1. Right-click on a shared note
2. Select "📋 Copy share link"
3. Share the `hivemind://` link with team members

## Commands

All commands are available through the command palette (Ctrl/Cmd + P):

- **Share current note with team** - Share the active note with your team
- **Unshare current note** - Stop sharing the active note
- **Create a new team** - Create a new collaboration team
- **Join a team** - Join an existing team by ID
- **Join document from share link** - Join using a hivemind:// link
- **Leave a team** - Leave a team (removes access to team documents)
- **Reconnect to sync server** - Reconnect if connection is lost
- **Recover missing shared notes** - Restore any missing shared documents

## Development

### Building from Source

```bash
# Clone the repository
git clone https://github.com/tonklabs/hivemind-obsidian-plugin.git
cd hivemind-obsidian-plugin

# Install dependencies
npm install

# Build for development (watch mode)
npm run dev

# Build for production
npm run build
```

### Manual Installation

1. Build the plugin using the steps above
2. Copy `main.js`, `styles.css`, and `manifest.json` to your vault's plugins folder:
   ```
   VaultFolder/.obsidian/plugins/hivemind/
   ```
3. Reload Obsidian and enable the plugin

## Architecture

Hivemind uses [Keepsync](https://github.com/tonk-labs/tonk/tree/main/packages/keepsync) for
real-time synchronization, built on Automerge CRDTs for conflict-free collaborative editing.

## Support

- **Issues**: Report bugs and feature requests on
  [GitHub Issues](https://github.com/jackddouglas/hivemind)

## License

MIT License - see [LICENSE](LICENSE) for details.
