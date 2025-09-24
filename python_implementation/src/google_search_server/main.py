import asyncio
from fastmcp import FastMCP
from .search import google_search

mcp = FastMCP("Google Search 🚀")

@mcp.tool
def search(query: str, limit: int = 10, timeout: int = 60000) -> str:
    """
    Uses the Google search engine to query real-time web information,
    returning search results including titles, links, and snippets.
    """
    results = google_search(query, limit, timeout)
    import json
    return json.dumps(results, indent=2)

if __name__ == "__main__":
    mcp.run()
