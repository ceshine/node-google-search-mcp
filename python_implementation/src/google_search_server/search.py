import asyncio
import json
import logging
import os
import random
import re
import sys
from datetime import datetime
from pathlib import Path
from typing import Any, Dict, List, Optional, Tuple

from bs4 import BeautifulSoup
from playwright.async_api import (
    Browser,
    BrowserContext,
    Page,
    Playwright,
    Error,
    async_playwright,
)

# --- Logger Setup ---
log_dir = Path(os.path.join(os.path.expanduser("~"), ".google-search-logs"))
log_dir.mkdir(parents=True, exist_ok=True)
log_file_path = log_dir / "google-search.log"

logging.basicConfig(level=logging.INFO, format='%(asctime)s - %(levelname)s - %(message)s')
logger = logging.getLogger(__name__)
handler = logging.FileHandler(log_file_path)
handler.setLevel(logging.DEBUG)
formatter = logging.Formatter('%(asctime)s - %(name)s - %(levelname)s - %(message)s')
handler.setFormatter(formatter)
logger.addHandler(handler)


# --- Constants ---
DEFAULT_TIMEOUT = 60000
SORRY_PATTERNS = [
    "google.com/sorry/index",
    "google.com/sorry",
    "recaptcha",
    "captcha",
    "unusual traffic",
]
GOOGLE_DOMAINS = [
    "https://www.google.com",
    "https://www.google.co.uk",
    "https://www.google.ca",
    "https://www.google.com.au",
]
SEARCH_RESULT_SELECTORS = [
    "#search",
    "#rso",
    ".g",
    "[data-sokoban-container]",
    "div[role='main']",
]
SEARCH_INPUT_SELECTORS = [
    "textarea[name='q']",
    "input[name='q']",
    "textarea[title='Search']",
    "input[title='Search']",
    "textarea[aria-label='Search']",
    "input[aria-label='Search']",
    "textarea",
]

# --- Helper Functions ---

def get_host_machine_config(locale: str = "en-US") -> Dict[str, Any]:
    platform = sys.platform
    if platform == "darwin":
        device_name = "Desktop Safari"
    elif platform == "win32":
        device_name = "Desktop Edge"
    else:
        device_name = "Desktop Firefox"

    return {
        "deviceName": device_name,
        "locale": locale,
        "timezoneId": "America/New_York",
        "colorScheme": "dark" if datetime.now().hour >= 19 or datetime.now().hour < 7 else "light",
        "reducedMotion": "no-preference",
        "forcedColors": "none",
    }

def get_random_delay(min_val: int, max_val: int) -> int:
    return random.randint(min_val, max_val)

async def _create_browser_context(
    p: Playwright,
    browser: Browser,
    state_file: Path,
    locale: str,
) -> Tuple[BrowserContext, Dict[str, Any]]:
    storage_state = str(state_file) if state_file.exists() else None
    saved_state = {}
    fingerprint_file = state_file.with_suffix(".json-fingerprint.json")
    if fingerprint_file.exists():
        with open(fingerprint_file, "r") as f:
            saved_state = json.load(f)

    device_list = ["Desktop Chrome", "Desktop Edge", "Desktop Firefox", "Desktop Safari"]

    device_name = saved_state.get("fingerprint", {}).get("deviceName")
    if not device_name or device_name not in p.devices:
        device_name = random.choice(device_list)

    device_config = p.devices[device_name]
    context_options = {**device_config}

    if "fingerprint" in saved_state:
        context_options.update({
            "locale": saved_state["fingerprint"]["locale"],
            "timezone_id": saved_state["fingerprint"]["timezoneId"],
            "color_scheme": saved_state["fingerprint"]["colorScheme"],
        })
    else:
        host_config = get_host_machine_config(locale)
        context_options.update({
            "locale": host_config["locale"],
            "timezone_id": host_config["timezoneId"],
            "color_scheme": host_config["colorScheme"],
        })
        saved_state["fingerprint"] = host_config

    context_options.update({
        "viewport": {"width": 1920, "height": 1080},
        "permissions": ["geolocation", "notifications"],
        "accept_downloads": True,
        "is_mobile": False,
        "has_touch": False,
        "java_script_enabled": True,
    })

    if storage_state:
        context_options["storage_state"] = storage_state

    context = await browser.new_context(**context_options)

    await context.add_init_script(
        """
        Object.defineProperty(navigator, 'webdriver', { get: () => false });
        Object.defineProperty(navigator, 'plugins', { get: () => [1, 2, 3, 4, 5] });
        Object.defineProperty(navigator, 'languages', { get: () => ['en-US', 'en'] });
        window.chrome = { runtime: {}, loadTimes: function() {}, csi: function() {}, app: {} };
        if (typeof WebGLRenderingContext !== 'undefined') {
            const getParameter = WebGLRenderingContext.prototype.getParameter;
            WebGLRenderingContext.prototype.getParameter = function(parameter) {
                if (parameter === 37445) { return 'Intel Inc.'; }
                if (parameter === 37446) { return 'Intel Iris OpenGL Engine'; }
                return getParameter.call(this, parameter);
            };
        }
        """
    )
    return context, saved_state

async def _navigate_and_search(page: Page, query: str, timeout: int, saved_state: Dict) -> None:
    selected_domain = saved_state.get("googleDomain")
    if not selected_domain:
        selected_domain = random.choice(GOOGLE_DOMAINS)
        saved_state["googleDomain"] = selected_domain

    logger.info(f"Navigating to {selected_domain}")
    await page.goto(selected_domain, timeout=timeout, wait_until="networkidle")
    logger.info(f"Navigated to {page.url}")

    if any(pattern in page.url for pattern in SORRY_PATTERNS):
        logger.warning("Human verification page detected on initial navigation.")
        raise Error("Human verification page detected.")

    search_input = None
    for selector in SEARCH_INPUT_SELECTORS:
        search_input = await page.query_selector(selector)
        if search_input:
            break

    if not search_input:
        raise Error("Could not find search box.")

    await search_input.click()
    await page.keyboard.type(query, delay=get_random_delay(10, 30))
    await asyncio.sleep(get_random_delay(100, 300) / 1000)
    async with page.expect_navigation(wait_until="networkidle", timeout=timeout):
        await page.keyboard.press("Enter")

    if any(pattern in page.url for pattern in SORRY_PATTERNS):
        raise Error("Human verification page detected after search.")

    results_found = False
    for selector in SEARCH_RESULT_SELECTORS:
        if await page.query_selector(selector):
            results_found = True
            break

    if not results_found:
        raise Error("Could not find search results element.")

async def _extract_results(page: Page, limit: int) -> List[Dict[str, str]]:
    results = await page.evaluate(
        """(limit) => {
            const results = [];
            const seenUrls = new Set();
            const selectorSets = [
                { container: '#search div[data-hveid]', title: 'h3', snippet: '.VwiC3b' },
                { container: '#rso div[data-hveid]', title: 'h3', snippet: '[data-sncf="1"]' },
                { container: '.g', title: 'h3', snippet: 'div[style*="webkit-line-clamp"]' },
                { container: 'div[jscontroller][data-hveid]', title: 'h3', snippet: 'div[role="text"]' },
            ];

            for (const selectors of selectorSets) {
                if (results.length >= limit) break;
                const containers = document.querySelectorAll(selectors.container);
                for (const container of containers) {
                    if (results.length >= limit) break;
                    const titleElement = container.querySelector(selectors.title);
                    if (!titleElement) continue;
                    const title = titleElement.textContent.trim();
                    const linkElement = titleElement.closest('a');
                    const link = linkElement ? linkElement.href : '';
                    if (!link || !link.startsWith('http') || seenUrls.has(link)) continue;

                    let snippet = '';
                    const snippetElement = container.querySelector(selectors.snippet);
                    if (snippetElement) {
                        snippet = snippetElement.textContent.trim();
                    }

                    if (title && link) {
                        results.push({ title, link, snippet });
                        seenUrls.add(link);
                    }
                }
            }
            return results.slice(0, limit);
        }""",
        limit,
    )
    return results

# --- Main Functions ---

async def google_search(
    query: str,
    limit: int = 10,
    timeout: int = DEFAULT_TIMEOUT,
    state_file: str = "./browser-state.json",
    no_save_state: bool = False,
    locale: str = "en-US",
    headless: bool = True,
    **kwargs,
) -> Dict[str, Any]:

    async def perform_search(p: Playwright, headless_mode: bool) -> Dict[str, Any]:
        browser = await p.chromium.launch(
            headless=headless_mode,
            args=[
                "--disable-blink-features=AutomationControlled",
                "--disable-features=IsolateOrigins,site-per-process",
                "--disable-site-isolation-trials",
                "--disable-web-security",
                "--no-sandbox",
                "--disable-setuid-sandbox",
                "--disable-dev-shm-usage",
                "--disable-accelerated-2d-canvas",
                "--no-first-run",
                "--no-zygote",
                "--disable-gpu",
                "--hide-scrollbars",
                "--mute-audio",
                "--disable-background-networking",
                "--disable-background-timer-throttling",
                "--disable-backgrounding-occluded-windows",
                "--disable-breakpad",
                "--disable-component-extensions-with-background-pages",
                "--disable-extensions",
                "--disable-features=TranslateUI",
                "--disable-ipc-flooding-protection",
                "--disable-renderer-backgrounding",
                "--enable-features=NetworkService,NetworkServiceInProcess",
                "--force-color-profile=srgb",
                "--metrics-recording-only",
            ],
            ignore_default_args=["--enable-automation"],
        )
        context = None
        try:
            state_file_path = Path(state_file)
            context, saved_state = await _create_browser_context(p, browser, state_file_path, locale)
            page = await context.new_page()

            await _navigate_and_search(page, query, timeout, saved_state)
            results = await _extract_results(page, limit)

            if not no_save_state:
                await context.storage_state(path=str(state_file_path))
                fingerprint_file = state_file_path.with_suffix(".json-fingerprint.json")
                with open(fingerprint_file, "w") as f:
                    json.dump(saved_state, f, indent=2)

            return {"query": query, "results": results}

        except Error as e:
            if "Human verification" in str(e) and headless_mode:
                logger.warning("Human verification detected, restarting in headed mode.")
                await browser.close()
                return await perform_search(p, False)
            else:
                logger.error(f"An error occurred during search: {e}")
                return {"query": query, "results": [], "error": str(e)}
        finally:
            if context: await context.close()
            if browser: await browser.close()

    async with async_playwright() as p:
        return await perform_search(p, headless)


async def get_google_search_page_html(
    query: str,
    options: Dict[str, Any],
    save_to_file: bool = False,
    output_path: Optional[str] = None,
) -> Dict[str, Any]:

    timeout = options.get("timeout", DEFAULT_TIMEOUT)
    state_file = options.get("state_file", "./browser-state.json")
    no_save_state = options.get("no_save_state", False)
    locale = options.get("locale", "en-US")
    headless = not options.get("no_headless", False)

    async def perform_search_and_get_html(p: Playwright, headless_mode: bool, output_path: Optional[str]) -> Dict[str, Any]:
        browser = await p.chromium.launch(
            headless=headless_mode,
            args=[
                "--disable-blink-features=AutomationControlled",
                "--disable-features=IsolateOrigins,site-per-process",
                "--disable-site-isolation-trials",
                "--disable-web-security",
                "--no-sandbox",
                "--disable-setuid-sandbox",
                "--disable-dev-shm-usage",
                "--disable-accelerated-2d-canvas",
                "--no-first-run",
                "--no-zygote",
                "--disable-gpu",
                "--hide-scrollbars",
                "--mute-audio",
                "--disable-background-networking",
                "--disable-background-timer-throttling",
                "--disable-backgrounding-occluded-windows",
                "--disable-breakpad",
                "--disable-component-extensions-with-background-pages",
                "--disable-extensions",
                "--disable-features=TranslateUI",
                "--disable-ipc-flooding-protection",
                "--disable-renderer-backgrounding",
                "--enable-features=NetworkService,NetworkServiceInProcess",
                "--force-color-profile=srgb",
                "--metrics-recording-only",
            ],
            ignore_default_args=["--enable-automation"],
        )
        context = None
        try:
            state_file_path = Path(state_file)
            context, saved_state = await _create_browser_context(p, browser, state_file_path, locale)
            page = await context.new_page()

            await _navigate_and_search(page, query, timeout, saved_state)

            full_html = await page.content()
            soup = BeautifulSoup(full_html, "html.parser")
            for tag in soup(["script", "style"]):
                tag.decompose()
            html = str(soup)

            result = {
                "query": query,
                "html": html,
                "url": page.url,
                "originalHtmlLength": len(full_html),
            }

            if save_to_file:
                if not output_path:
                    output_dir = Path("./google-search-html")
                    output_dir.mkdir(exist_ok=True)
                    timestamp = datetime.now().strftime("%Y%m%d_%H%M%S")
                    sanitized_query = re.sub(r'[^a-zA-Z0-9]', '_', query)[:50]
                    output_path = str(output_dir / f"{sanitized_query}-{timestamp}.html")

                with open(output_path, "w", encoding="utf-8") as f:
                    f.write(html)
                result["savedPath"] = output_path

                screenshot_path = Path(output_path).with_suffix(".png")
                await page.screenshot(path=str(screenshot_path), full_page=True)
                result["screenshotPath"] = str(screenshot_path)

            if not no_save_state:
                await context.storage_state(path=str(state_file_path))
                fingerprint_file = state_file_path.with_suffix(".json-fingerprint.json")
                with open(fingerprint_file, "w") as f:
                    json.dump(saved_state, f, indent=2)

            return result

        except Error as e:
            if "Human verification" in str(e) and headless_mode:
                logger.warning("Human verification detected, restarting in headed mode.")
                await browser.close()
                return await perform_search_and_get_html(p, False, output_path)
            else:
                logger.error(f"An error occurred while getting HTML: {e}")
                raise e
        finally:
            if context: await context.close()
            if browser: await browser.close()

    async with async_playwright() as p:
        return await perform_search_and_get_html(p, headless, output_path)
