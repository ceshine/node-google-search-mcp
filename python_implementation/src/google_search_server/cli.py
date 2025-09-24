import argparse
import asyncio
import json
from .search import google_search, get_google_search_page_html

def main():
    parser = argparse.ArgumentParser(
        description="A Google search CLI tool based on Playwright"
    )
    parser.add_argument("query", help="Search keyword")
    parser.add_argument(
        "-l", "--limit", type=int, default=10, help="Limit the number of results"
    )
    parser.add_argument(
        "-t", "--timeout", type=int, default=30000, help="Timeout in milliseconds"
    )
    parser.add_argument(
        "--no-headless",
        action="store_true",
        help="Deprecated: Always tries headless mode first, and automatically switches to headed mode if human verification is encountered",
    )
    parser.add_argument(
        "--state-file",
        default="./browser-state.json",
        help="Path to the browser state file",
    )
    parser.add_argument(
        "--no-save-state", action="store_true", help="Do not save browser state"
    )
    parser.add_argument(
        "--get-html",
        action="store_true",
        help="Get the raw HTML of the search results page instead of parsed results",
    )
    parser.add_argument(
        "--save-html", action="store_true", help="Save the HTML to a file"
    )
    parser.add_argument("--html-output", help="HTML output file path")

    args = parser.parse_args()

    async def run():
        try:
            if args.get_html:
                html_result = await get_google_search_page_html(
                    query=args.query,
                    options=vars(args),
                    save_to_file=args.save_html,
                    output_path=args.html_output,
                )
                if args.save_html and html_result.get("savedPath"):
                    print(f"HTML has been saved to file: {html_result['savedPath']}")

                output_result = {
                    "query": html_result.get("query"),
                    "url": html_result.get("url"),
                    "originalHtmlLength": html_result.get("originalHtmlLength"),
                    "cleanedHtmlLength": len(html_result.get("html", "")),
                    "savedPath": html_result.get("savedPath"),
                    "screenshotPath": html_result.get("screenshotPath"),
                    "htmlPreview": html_result.get("html", "")[:500] + ("..." if len(html_result.get("html", "")) > 500 else ""),
                }
                print(json.dumps(output_result, indent=2))
            else:
                results = await google_search(**vars(args))
                print(json.dumps(results, indent=2))
        except Exception as e:
            print(f"Error: {e}")
            exit(1)

    asyncio.run(run())

if __name__ == "__main__":
    main()
