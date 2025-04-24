# WebDriverAgent MCP Server

<h1 align="center">
	<br>
	<img src="assets/mcp-wdalogo.png" alt="MCP_WDA" width="50%" style="max-width: 300px;">
	<br>
	<br>
	<br>
</h1>

This is a Model Context Protocol (MCP) server that provides tools for building and signing WebDriverAgent for iOS.

## Overview

The WebDriverAgent MCP Server exposes functionality to:

1. Build WebDriverAgent using Xcode
2. Package it into an IPA file
3. Sign the IPA with a mobile provisioning profile

This server is particularly useful for automating the process of preparing WebDriverAgent for use with Appium on iOS devices.

## Installation

1. Clone this repository
2. Install dependencies:

```bash
npm install
```

3. Build the project:

```bash
npm run build
```

## Configuration

To use this MCP server with Claude, you need to add it to your MCP settings configuration file. The location of this file depends on your platform:

- For Cursor: `/Users/[username]/Library/Application Support/Cursor/User/globalStorage/saoudrizwan.claude-dev/settings/cline_mcp_settings.json`
- For Claude Desktop: `/Users/[username]/Library/Application Support/Claude/claude_desktop_config.json`
- For Cline or other MCP clients: Check your client's documentation for the configuration file location

Add the following configuration to the `mcpServers` object in the settings file:

```json
{
  "mcpServers": {
    "mcp-wda": {
      "command": "npx",
      "args": ["mcp-webdriveragent"],
      "autoApprove": [],
      "timeout": 300
    }
  }
}
```

This configuration uses `npx` to run the globally or locally installed `mcp-webdriveragent` package.

## Available Tools

The server provides a workflow of tools that should be used in sequence:

### 1. list_provisioning_profiles

Lists all iOS provisioning profiles available on the system.

**Parameters:**

- `profileUuid` (required): UUID of the selected provisioning profile

**Example Usage:**

```javascript
<use_mcp_tool>
<server_name>mcp-wda</server_name>
<tool_name>list_provisioning_profiles</tool_name>
<arguments>
{
  "profileUuid": "00000000-0000-0000-0000-000000000000"
}
</arguments>
</use_mcp_tool>
```

### 2. is_free_account

Confirms if the selected provisioning profile is from a free or enterprise account.

**Parameters:**

- `isFreeAccount` (required): Boolean indicating if the profile is from a free account (true) or enterprise account (false)

**Example Usage:**

```javascript
<use_mcp_tool>
<server_name>mcp-wda</server_name>
<tool_name>is_free_account</tool_name>
<arguments>
{
  "isFreeAccount": true
}
</arguments>
</use_mcp_tool>
```

### 3. build_and_sign_wda

Builds and signs WebDriverAgent for iOS using the selected provisioning profile.

**Parameters:**

- `selectedProvisioningProfile` (required): Object containing the selected profile details (UUID, name, bundleId, filePath)
- `isFreeAccount` (required): Boolean indicating if the profile is from a free account (true) or enterprise account (false)

**Example Usage:**

```javascript
<use_mcp_tool>
<server_name>mcp-wda</server_name>
<tool_name>build_and_sign_wda</tool_name>
<arguments>
{
  "selectedProvisioningProfile": {
    "value": "00000000-0000-0000-0000-000000000000",
    "name": "iOS Team Provisioning Profile: com.example.WebDriverAgentRunner",
    "bundleId": "com.example.WebDriverAgentRunner",
    "filePath": "/Users/username/Library/MobileDevice/Provisioning Profiles/profile.mobileprovision"
  },
  "isFreeAccount": true
}
</arguments>
</use_mcp_tool>
```

## Requirements

- macOS with Xcode installed
- Node.js 14 or higher
- Valid iOS provisioning profile for signing
- Appium WebDriverAgent dependencies (installed automatically)

## Development

To run the server in development mode with automatic recompilation:

```bash
npm run dev
```

## License

MIT
