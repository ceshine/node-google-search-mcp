# Google Search Tool

This is a Node.js tool based on Playwright that can bypass search engine anti-crawling mechanisms to perform Google searches and extract results. It can be used directly as a command-line tool or as a Model Context Protocol (MCP) server to provide real-time search capabilities for AI assistants like Claude.

[![Star History Chart](https://api.star-history.com/svg?repos=web-agent-master/google-search&type=Date)](https://star-history.com/#web-agent-master/google-search&Date)

## Core Highlights

- **Localized SERP API Alternative**: No need to rely on paid search engine results API services; searches are performed entirely locally.
- **Advanced Anti-Bot Detection Bypass Technology**:
  - Intelligent browser fingerprint management to simulate real user behavior.
  - Automatic saving and restoring of browser state to reduce verification frequency.
  - Smart switching between headless/headed modes, automatically switching to headed mode for user verification when needed.
  - Randomization of various device and regional settings to reduce detection risk.
- **Raw HTML Retrieval**: Ability to retrieve the raw HTML of the search results page (with CSS and JavaScript removed) for analyzing and debugging extraction strategies when Google's page structure changes.
- **Web Page Screenshot Function**: Automatically captures and saves a full-page screenshot while saving HTML content.
- **MCP Server Integration**: Provides real-time search capabilities for AI assistants like Claude without requiring additional API keys.
- **Completely Open Source and Free**: All code is open source with no usage restrictions, allowing for free customization and extension.

## Technical Features

- Developed with TypeScript for type safety and a better development experience.
- Based on Playwright for browser automation, supporting multiple browser engines.
- Supports command-line arguments for search keywords.
- Supports acting as an MCP server to provide search capabilities for AI assistants like Claude.
- Returns search results with titles, links, and snippets.
- Supports retrieving the raw HTML of the search results page for analysis.
- Outputs results in JSON format.
- Supports headless and headed modes (for debugging).
- Provides detailed log output.
- Robust error handling mechanism.
- Supports saving and restoring browser state to effectively avoid anti-bot detection.

## Installation

```bash
# Install from source
git clone https://github.com/web-agent-master/google-search.git
cd google-search
# Install dependencies
npm install
# or with yarn
yarn
# or with pnpm
pnpm install

# Compile TypeScript code
npm run build
# or with yarn
yarn build
# or with pnpm
pnpm build

# Link the package globally (required for MCP functionality)
npm link
# or with yarn
yarn link
# or with pnpm
pnpm link
```

### Special Instructions for Windows Environment

This tool has been specially adapted for the Windows environment:

1.  Provided `.cmd` files to ensure the command-line tool works correctly in Windows Command Prompt and PowerShell.
2.  Log files are stored in the system's temporary directory instead of the Unix/Linux `/tmp` directory.
3.  Added Windows-specific process signal handling to ensure the server can be shut down properly.
4.  Uses cross-platform file path handling to support Windows path separators.

## Usage

### Command-Line Tool

```bash
# Use directly from the command line
google-search "search keywords"

# Use with command-line options
google-search --limit 5 --timeout 60000 --no-headless "search keywords"


# Or use npx
npx google-search-cli "search keywords"

# Run in development mode
pnpm dev "search keywords"

# Run in debug mode (shows browser UI)
pnpm debug "search keywords"

# Get the raw HTML of the search results page
google-search "search keywords" --get-html

# Get HTML and save to a file
google-search "search keywords" --get-html --save-html

# Get HTML and save to a specified file
google-search "search keywords" --get-html --save-html --html-output "./output.html"
```

#### Command-Line Options

-   `-l, --limit <number>`: Limit the number of results (default: 10)
-   `-t, --timeout <number>`: Timeout in milliseconds (default: 60000)
-   `--no-headless`: Show browser UI (for debugging)
-   `--remote-debugging-port <number>`: Enable remote debugging port (default: 9222)
-   `--state-file <path>`: Path to the browser state file (default: ./browser-state.json)
-   `--no-save-state`: Do not save browser state
-   `--get-html`: Get the raw HTML of the search results page instead of parsed results
-   `--save-html`: Save the HTML to a file (use with --get-html)
-   `--html-output <path>`: Specify the HTML output file path (use with --get-html and --save-html)
-   `-V, --version`: Display version number
-   `-h, --help`: Display help information

#### Output Example

```json
{
  "query": "deepseek",
  "results": [
    {
      "title": "DeepSeek",
      "link": "https://www.deepseek.com/",
      "snippet": "DeepSeek-R1 is now live and open source, rivaling OpenAI's Model o1. Available on web, app, and API. Click for details. Into ..."
    },
    {
      "title": "DeepSeek",
      "link": "https://www.deepseek.com/",
      "snippet": "DeepSeek-R1 is now live and open source, rivaling OpenAI's Model o1. Available on web, app, and API. Click for details. Into ..."
    },
    {
      "title": "deepseek-ai/DeepSeek-V3",
      "link": "https://github.com/deepseek-ai/DeepSeek-V3",
      "snippet": "We present DeepSeek-V3, a strong Mixture-of-Experts (MoE) language model with 671B total parameters with 37B activated for each token."
    }
    // More results...
  ]
}
```

#### HTML Output Example

When using the `--get-html` option, the output will include information about the HTML content:

```json
{
  "query": "playwright automation",
  "url": "https://www.google.com/",
  "originalHtmlLength": 1291733,
  "cleanedHtmlLength": 456789,
  "htmlPreview": "<!DOCTYPE html><html itemscope=\"\" itemtype=\"http://schema.org/SearchResultsPage\" lang=\"en-US\"><head><meta charset=\"UTF-8\"><meta content=\"dark light\" name=\"color-scheme\"><meta content=\"origin\" name=\"referrer\">..."
}
```

If the `--save-html` option is also used, the output will include the file path where the HTML was saved:

```json
{
  "query": "playwright automation",
  "url": "https://www.google.com/",
  "originalHtmlLength": 1292241,
  "cleanedHtmlLength": 458976,
  "savedPath": "./google-search-html/playwright_automation-2025-04-06T03-30-06-852Z.html",
  "screenshotPath": "./google-search-html/playwright_automation-2025-04-06T03-30-06-852Z.png",
  "htmlPreview": "<!DOCTYPE html><html itemscope=\"\" itemtype=\"http://schema.org/SearchResultsPage\" lang=\"en-US\">..."
}
```

### MCP Server

This project provides a Model Context Protocol (MCP) server function, allowing AI assistants like Claude to use Google search capabilities directly. MCP is an open protocol that enables AI assistants to securely access external tools and data.

```bash
# Build the project
pnpm build
```

#### Integration with Claude Desktop

1.  Edit the Claude Desktop configuration file:
    *   Mac: `~/Library/Application Support/Claude/claude_desktop_config.json`
    *   Windows: `%APPDATA%\Claude\claude_desktop_config.json`
        *   Usually located at `C:\Users\username\AppData\Roaming\Claude\claude_desktop_config.json`
        *   You can directly access it by typing `%APPDATA%\Claude` in the Windows Explorer address bar.

2.  Add the server configuration and restart Claude:

```json
{
  "mcpServers": {
    "google-search": {
      "command": "npx",
      "args": ["google-search-mcp"]
    }
  }
}
```

In a Windows environment, you can also use the following configuration schemes:

1.  Using cmd.exe with npx:

```json
{
  "mcpServers": {
    "google-search": {
      "command": "cmd.exe",
      "args": ["/c", "npx", "google-search-mcp"]
    }
  }
}
```

2.  Using node with the full path (recommended if you encounter problems with the above method):

```json
{
  "mcpServers": {
    "google-search": {
      "command": "node",
      "args": ["C:/your/path/to/google-search/dist/mcp-server.js"]
    }
  }
}
```

Note: For the second method, you must replace `C:/your/path/to/google-search` with the actual full path where you installed the google-search package.

After integration, you can use the search function directly in Claude, such as "Search for the latest AI research".

## Project Structure

```
google-search/
├── package.json          # Project configuration and dependencies
├── tsconfig.json         # TypeScript configuration
├── src/
│   ├── index.ts          # Entry file (command-line parsing and main logic)
│   ├── search.ts         # Search functionality implementation (Playwright browser automation)
│   ├── mcp-server.ts     # MCP server implementation
│   └── types.ts          # Type definitions (interfaces and type declarations)
├── dist/                 # Compiled JavaScript files
├── bin/                  # Executable files
│   └── google-search     # Command-line entry script
├── README.md             # Project documentation
└── .gitignore            # Git ignore file
```

## Technology Stack

-   **TypeScript**: Development language, providing type safety and a better development experience.
-   **Node.js**: Runtime environment for executing JavaScript/TypeScript code.
-   **Playwright**: For browser automation, supporting multiple browsers.
-   **Commander**: For parsing command-line arguments and generating help messages.
-   **Model Context Protocol (MCP)**: An open protocol for integration with AI assistants.
-   **MCP SDK**: Development toolkit for implementing MCP servers.
-   **Zod**: A schema definition library for validation and type safety.
-   **pnpm**: An efficient package management tool that saves disk space and installation time.

## Development Guide

All commands can be run from the project root directory:

```bash
# Install dependencies
pnpm install

# Install Playwright browsers
pnpm run postinstall

# Compile TypeScript code
pnpm build

# Clean compiled output
pnpm clean
```

### CLI Development

```bash
# Run in development mode
pnpm dev "search keywords"

# Run in debug mode (shows browser UI)
pnpm debug "search keywords"

# Run the compiled code
pnpm start "search keywords"

# Test the search functionality
pnpm test
```

### MCP Server Development

```bash
# Run MCP server in development mode
pnpm mcp

# Run the compiled MCP server
pnpm mcp:build
```

## Error Handling

The tool has a robust error handling mechanism built-in:

-   Provides friendly error messages when the browser fails to start.
-   Automatically returns an error status for network connection issues.
-   Provides detailed logs when search result parsing fails.
-   Gracefully exits and returns useful information in case of a timeout.

## Notes

### General Notes

-   This tool is for learning and research purposes only.
-   Please comply with Google's terms of use and policies.
-   Do not send requests too frequently to avoid being blocked by Google.
-   A proxy may be required to access Google in some regions.
-   Playwright needs to install browsers, which will be downloaded automatically on first use.

### State File

-   The state file contains browser cookies and storage data; please keep it safe.
-   Using a state file can effectively avoid Google's anti-bot detection and improve search success rates.

### MCP Server

-   The MCP server requires Node.js v16 or higher.
-   When using the MCP server, please ensure that Claude Desktop is updated to the latest version.
-   When configuring Claude Desktop, please use an absolute path to the MCP server file.

### Special Notes for Windows Environment

-   In a Windows environment, administrator rights may be required to install Playwright browsers on the first run.
-   If you encounter permission issues, try running Command Prompt or PowerShell as an administrator.
-   Windows Firewall may block Playwright's browser network connections; please allow access when prompted.
-   The browser state file is saved by default to `.google-search-browser-state.json` in the user's home directory.
-   Log files are saved in the `google-search-logs` folder in the system's temporary directory.

## Comparison with Commercial SERP APIs

Compared to paid search engine results API services (like SerpAPI), this project offers the following advantages:

-   **Completely Free**: No need to pay for API calls.
-   **Local Execution**: All searches are performed locally, without relying on third-party services.
-   **Privacy Protection**: Search queries are not recorded by third parties.
-   **Customizability**: Completely open source, can be modified and extended as needed.
-   **No Usage Limits**: Not limited by the number or frequency of API calls.
-   **MCP Integration**: Natively supports integration with AI assistants like Claude.
