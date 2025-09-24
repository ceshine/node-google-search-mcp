import asyncio
import json
import os
import random
from pathlib import Path
from typing import Any, Dict, List, Optional, Tuple

from bs4 import BeautifulSoup
from playwright.async_api import (
    Browser,
    BrowserContext,
    Page,
    Playwright,
    async_playwright,
)

DEFAULT_TIMEOUT = 60000


class GoogleSearch:
    def __init__(
        self,
        playwright: Playwright,
        browser: Browser,
        state_file: Path = Path("./browser-state.json"),
        no_save_state: bool = False,
        locale: str = "en-US",
        headless: bool = True,
    ):
        self.playwright = playwright
        self.browser = browser
        self.state_file = state_file
        self.no_save_state = no_save_state
        self.locale = locale
        self.headless = headless
        self.fingerprint_file = self.state_file.with_name(
            f"{self.state_file.stem}-fingerprint.json"
        )
        self.saved_state: Dict[str, Any] = {}

    async def search(
        self,
        query: str,
        limit: int = 10,
        timeout: int = DEFAULT_TIMEOUT,
    ) -> Dict[str, Any]:
        page = None
        context = None
        try:
            context, page = await self._create_page(timeout)

            await page.goto("https://www.google.com", timeout=timeout)

            # Wait for the search box to appear
            search_input = await self._find_search_box(page)
            if not search_input:
                raise Exception("Could not find search box")

            await search_input.type(query, delay=random.randint(10, 30))
            await asyncio.sleep(random.uniform(0.1, 0.3))
            await page.keyboard.press("Enter")

            await page.wait_for_load_state("networkidle", timeout=timeout)

            results = await self._extract_results(page, limit)

            return {"query": query, "results": results}
        finally:
            if page:
                await page.close()
            if context:
                await context.storage_state(path=self.state_file)
                await context.close()

    async def _create_page(self, timeout: int) -> Tuple[BrowserContext, Page]:
        storage_state = self.state_file if self.state_file.exists() else None
        if self.fingerprint_file.exists():
            with open(self.fingerprint_file, "r") as f:
                self.saved_state = json.load(f)

        device_name, device_config = self._get_device_config()

        context_options: Dict[str, Any] = {
            **device_config,
        }

        if self.saved_state.get("fingerprint"):
            context_options.update(
                {
                    "locale": self.saved_state["fingerprint"]["locale"],
                    "timezone_id": self.saved_state["fingerprint"]["timezoneId"],
                    "color_scheme": self.saved_state["fingerprint"]["colorScheme"],
                    "reduced_motion": self.saved_state["fingerprint"]["reducedMotion"],
                    "forced_colors": self.saved_state["fingerprint"]["forcedColors"],
                }
            )
        else:
            host_config = self._get_host_machine_config()
            if host_config["deviceName"] != device_name:
                device_name, device_config = self._get_device_config(
                    host_config["deviceName"]
                )
                context_options.update(device_config)

            context_options.update(
                {
                    "locale": host_config["locale"],
                    "timezone_id": host_config["timezoneId"],
                    "color_scheme": host_config["colorScheme"],
                    "reduced_motion": host_config["reducedMotion"],
                    "forced_colors": host_config["forcedColors"],
                }
            )
            self.saved_state["fingerprint"] = host_config

        context_options.update(
            {
                "permissions": ["geolocation", "notifications"],
                "accept_downloads": True,
                "is_mobile": False,
                "has_touch": False,
                "java_script_enabled": True,
            }
        )

        if storage_state:
            context_options["storage_state"] = storage_state

        context = await self.browser.new_context(**context_options)

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

        page = await context.new_page()

        await page.add_init_script(
            """
            Object.defineProperty(window.screen, 'width', { get: () => 1920 });
            Object.defineProperty(window.screen, 'height', { get: () => 1080 });
            Object.defineProperty(window.screen, 'colorDepth', { get: () => 24 });
            Object.defineProperty(window.screen, 'pixelDepth', { get: () => 24 });
        """
        )

        return context, page

    def _get_device_config(
        self, device_name: Optional[str] = None
    ) -> Tuple[str, Dict[str, Any]]:
        device_list = [
            "Desktop Chrome",
            "Desktop Edge",
            "Desktop Firefox",
            "Desktop Safari",
        ]
        if (
            device_name is None
            and self.saved_state.get("fingerprint")
            and self.saved_state["fingerprint"]["deviceName"] in self.playwright.devices
        ):
            device_name = self.saved_state["fingerprint"]["deviceName"]
        elif device_name is None:
            device_name = random.choice(device_list)

        return device_name, self.playwright.devices[device_name]

    def _get_host_machine_config(self) -> Dict[str, Any]:
        # This is a simplified version of the TypeScript implementation
        # as getting the real host machine config is more complex in Python.
        return {
            "deviceName": "Desktop Chrome",
            "locale": self.locale,
            "timezoneId": "America/New_York",
            "colorScheme": "dark",
            "reducedMotion": "no-preference",
            "forcedColors": "none",
        }

    async def _find_search_box(self, page: Page):
        search_input_selectors = [
            "textarea[name='q']",
            "input[name='q']",
            "textarea[title='Search']",
            "input[title='Search']",
            "textarea[aria-label='Search']",
            "input[aria-label='Search']",
            "textarea",
        ]
        for selector in search_input_selectors:
            element = await page.query_selector(selector)
            if element:
                return element
        return None

    async def _extract_results(self, page: Page, limit: int) -> List[Dict[str, str]]:
        html = await page.content()
        soup = BeautifulSoup(html, "html.parser")
        results = []
        seen_urls = set()

        selector_sets = [
            {"container": "#search div[data-hveid]", "title": "h3", "snippet": ".VwiC3b"},
            {"container": "#rso div[data-hveid]", "title": "h3", "snippet": '[data-sncf="1"]'},
            {"container": ".g", "title": "h3", "snippet": 'div[style*="webkit-line-clamp"]'},
            {
                "container": "div[jscontroller][data-hveid]",
                "title": "h3",
                "snippet": 'div[role="text"]',
            },
        ]

        for selectors in selector_sets:
            if len(results) >= limit:
                break
            containers = soup.select(selectors["container"])
            for container in containers:
                if len(results) >= limit:
                    break

                title_element = container.select_one(selectors["title"])
                if not title_element:
                    continue

                title = title_element.get_text(strip=True)
                link_element = title_element.find("a")
                link = link_element["href"] if link_element else ""

                if not link or not link.startswith("http") or link in seen_urls:
                    continue

                snippet_element = container.select_one(selectors["snippet"])
                snippet = snippet_element.get_text(strip=True) if snippet_element else ""

                if title and link:
                    results.append({"title": title, "link": link, "snippet": snippet})
                    seen_urls.add(link)

        return results


async def google_search(
    query: str,
    limit: int = 10,
    timeout: int = DEFAULT_TIMEOUT,
    state_file: str = "./browser-state.json",
    no_save_state: bool = False,
    locale: str = "en-US",
    headless: bool = True,
) -> Dict[str, Any]:
    async with async_playwright() as p:
        browser = await p.chromium.launch(headless=headless)
        searcher = GoogleSearch(
            p,
            browser,
            Path(state_file),
            no_save_state,
            locale,
            headless,
        )
        try:
            return await searcher.search(query, limit, timeout)
        finally:
            await browser.close()
