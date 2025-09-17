import { chromium, devices, BrowserContextOptions, Browser } from "playwright";
import {
  SearchResponse,
  SearchResult,
  CommandOptions,
  HtmlResponse,
} from "./types.js";
import * as fs from "fs";
import * as path from "path";
import * as os from "os";
import logger from "./logger.js";
import { url } from "inspector";

// Fingerprint configuration interface
interface FingerprintConfig {
  deviceName: string;
  locale: string;
  timezoneId: string;
  colorScheme: "dark" | "light";
  reducedMotion: "reduce" | "no-preference";
  forcedColors: "active" | "none";
}

// Saved state file interface
interface SavedState {
  fingerprint?: FingerprintConfig;
  googleDomain?: string;
}

/**
 * Get the actual configuration of the host machine
 * @param userLocale User-specified locale (if any)
 * @returns Fingerprint configuration based on the host machine
 */
function getHostMachineConfig(userLocale?: string): FingerprintConfig {
  // Get system locale
  const systemLocale = userLocale || process.env.LANG || "en-US";

  // Get system timezone
  // Node.js does not directly provide timezone information, but it can be inferred from the timezone offset
  const timezoneOffset = new Date().getTimezoneOffset();
  let timezoneId = "America/New_York"; // Default to New York timezone

  // Roughly infer timezone based on offset
  // The timezone offset is the difference in minutes from UTC, with negative values for the eastern hemisphere
  if (timezoneOffset <= -480 && timezoneOffset > -600) {
    // UTC+8 (China, Singapore, Hong Kong, etc.)
    timezoneId = "Asia/Shanghai";
  } else if (timezoneOffset <= -540) {
    // UTC+9 (Japan, South Korea, etc.)
    timezoneId = "Asia/Tokyo";
  } else if (timezoneOffset <= -420 && timezoneOffset > -480) {
    // UTC+7 (Thailand, Vietnam, etc.)
    timezoneId = "Asia/Bangkok";
  } else if (timezoneOffset <= 0 && timezoneOffset > -60) {
    // UTC+0 (UK, etc.)
    timezoneId = "Europe/London";
  } else if (timezoneOffset <= 60 && timezoneOffset > 0) {
    // UTC-1 (parts of Europe)
    timezoneId = "Europe/Berlin";
  } else if (timezoneOffset <= 300 && timezoneOffset > 240) {
    // UTC-5 (US East)
    timezoneId = "America/New_York";
  }

  // Detect system color scheme
  // Node.js cannot directly get the system color scheme, so use a reasonable default
  // Can be inferred from the time: dark mode at night, light mode during the day
  const hour = new Date().getHours();
  const colorScheme =
    hour >= 19 || hour < 7 ? ("dark" as const) : ("light" as const);

  // Use reasonable defaults for other settings
  const reducedMotion = "no-preference" as const; // Most users do not enable reduced motion
  const forcedColors = "none" as const; // Most users do not enable forced colors

  // Choose a suitable device name
  // Choose a suitable browser based on the operating system
  const platform = os.platform();
  let deviceName = "Desktop Chrome"; // Default to Chrome

  if (platform === "darwin") {
    // macOS
    deviceName = "Desktop Safari";
  } else if (platform === "win32") {
    // Windows
    deviceName = "Desktop Edge";
  } else if (platform === "linux") {
    // Linux
    deviceName = "Desktop Firefox";
  }

  // We are using Chrome
  // deviceName = "Desktop Chrome";

  return {
    deviceName,
    locale: systemLocale,
    timezoneId,
    colorScheme,
    reducedMotion,
    forcedColors,
  };
}

/**
 * Perform a Google search and return the results
 * @param query The search keyword
 * @param options Search options
 * @returns The search results
 */
export async function googleSearch(
  query: string,
  options: CommandOptions = {},
  existingBrowser?: Browser,
): Promise<SearchResponse> {
  // Set default options
  const {
    limit = 10,
    timeout = 60000,
    stateFile = "./browser-state.json",
    noSaveState = false,
    locale = "en-US", // Default to English
    headless = true,
  } = options;

  // Ignore the incoming headless parameter and always start in headless mode
  let useHeadless = headless;

  logger.info({ options }, "Initializing browser...");

  // Check if a state file exists
  let storageState: string | undefined = undefined;
  let savedState: SavedState = {};

  // Fingerprint configuration file path
  const fingerprintFile = stateFile.replace(".json", "-fingerprint.json");

  if (fs.existsSync(stateFile)) {
    logger.info(
      { stateFile },
      "Browser state file found, will use saved browser state to avoid anti-bot detection",
    );
    storageState = stateFile;

    // Try to load the saved fingerprint configuration
    if (fs.existsSync(fingerprintFile)) {
      try {
        const fingerprintData = fs.readFileSync(fingerprintFile, "utf8");
        savedState = JSON.parse(fingerprintData);
        logger.info("Loaded saved browser fingerprint configuration");
      } catch (e) {
        logger.warn(
          { error: e },
          "Failed to load fingerprint configuration file, will create a new one",
        );
      }
    }
  } else {
    logger.info(
      { stateFile },
      "Browser state file not found, will create a new browser session and fingerprint",
    );
  }

  // Use only desktop device list
  const deviceList = [
    "Desktop Chrome",
    "Desktop Edge",
    "Desktop Firefox",
    "Desktop Safari",
  ];

  // Timezone list
  const timezoneList = [
    "America/New_York",
    "Europe/London",
    "Asia/Shanghai",
    "Europe/Berlin",
    "Asia/Tokyo",
  ];

  // Google domain list
  const googleDomains = [
    "https://www.google.com",
    "https://www.google.co.uk",
    "https://www.google.ca",
    "https://www.google.com.au",
  ];

  // Get random device configuration or use the saved one
  const getDeviceConfig = (): [string, any] => {
    if (
      savedState.fingerprint?.deviceName &&
      devices[savedState.fingerprint.deviceName]
    ) {
      // Use the saved device configuration
      return [
        savedState.fingerprint.deviceName,
        devices[savedState.fingerprint.deviceName],
      ];
    } else {
      // Choose a random device
      const randomDevice =
        deviceList[Math.floor(Math.random() * deviceList.length)];
      return [randomDevice, devices[randomDevice]];
    }
  };

  // Get a random delay time
  const getRandomDelay = (min: number, max: number) => {
    return Math.floor(Math.random() * (max - min + 1)) + min;
  };

  // Define a function to perform the search, reusable for headless and headed modes
  async function performSearch(headless: boolean): Promise<SearchResponse> {
    let browser: Browser;
    let browserWasProvided = false;

    if (existingBrowser) {
      browser = existingBrowser;
      browserWasProvided = true;
      logger.info("Using existing browser instance");
    } else {
      logger.info(
        { headless },
        `Preparing to launch browser in ${headless ? "headless" : "headed"} mode...`,
      );

      // Initialize the browser, adding more parameters to avoid detection
      browser = await chromium.launch({
        headless,
        timeout: timeout * 2, // Increase browser launch timeout
        args: [
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
        ignoreDefaultArgs: ["--enable-automation"],
      });

      logger.info("Browser launched successfully!");
    }

    // Get device configuration - use saved or randomly generated
    const [deviceName, deviceConfig] = getDeviceConfig();

    // Create browser context options
    let contextOptions: BrowserContextOptions = {
      ...deviceConfig,
    };

    // If there is a saved fingerprint configuration, use it; otherwise, use the host machine's actual settings
    if (savedState.fingerprint) {
      contextOptions = {
        ...contextOptions,
        locale: savedState.fingerprint.locale,
        timezoneId: savedState.fingerprint.timezoneId,
        colorScheme: savedState.fingerprint.colorScheme,
        reducedMotion: savedState.fingerprint.reducedMotion,
        forcedColors: savedState.fingerprint.forcedColors,
      };
      logger.info("Using saved browser fingerprint configuration");
    } else {
      // Get the host machine's actual settings
      const hostConfig = getHostMachineConfig(locale);

      // If a different device type is needed, re-get the device configuration
      if (hostConfig.deviceName !== deviceName) {
        logger.info(
          { deviceType: hostConfig.deviceName },
          "Using device type based on host machine settings",
        );
        // Use the new device configuration
        contextOptions = { ...devices[hostConfig.deviceName] };
      }

      contextOptions = {
        ...contextOptions,
        locale: hostConfig.locale,
        timezoneId: hostConfig.timezoneId,
        colorScheme: hostConfig.colorScheme,
        reducedMotion: hostConfig.reducedMotion,
        forcedColors: hostConfig.forcedColors,
      };

      // Save the newly generated fingerprint configuration
      savedState.fingerprint = hostConfig;
      logger.info(
        {
          locale: hostConfig.locale,
          timezone: hostConfig.timezoneId,
          colorScheme: hostConfig.colorScheme,
          deviceType: hostConfig.deviceName,
        },
        "Generated new browser fingerprint configuration based on the host machine",
      );
    }

    // Add common options - ensure desktop configuration is used
    contextOptions = {
      ...contextOptions,
      permissions: ["geolocation", "notifications"],
      acceptDownloads: true,
      isMobile: false, // Force desktop mode
      hasTouch: false, // Disable touch functionality
      javaScriptEnabled: true,
    };

    if (storageState) {
      logger.info("Loading saved browser state...");
    }

    const context = await browser.newContext(
      storageState ? { ...contextOptions, storageState } : contextOptions,
    );

    // Set additional browser properties to avoid detection
    await context.addInitScript(() => {
      // Override navigator properties
      Object.defineProperty(navigator, "webdriver", { get: () => false });
      Object.defineProperty(navigator, "plugins", {
        get: () => [1, 2, 3, 4, 5],
      });
      Object.defineProperty(navigator, "languages", {
        get: () => ["en-US", "en"],
      });

      // Override window properties
      // @ts-ignore - Ignore error that chrome property does not exist
      (window as any).chrome = {
        runtime: {},
        loadTimes: function () {},
        csi: function () {},
        app: {},
      };

      // Add WebGL fingerprint randomization
      if (typeof WebGLRenderingContext !== "undefined") {
        const getParameter = WebGLRenderingContext.prototype.getParameter;
        WebGLRenderingContext.prototype.getParameter = function (
          parameter: number,
        ) {
          // Randomize UNMASKED_VENDOR_WEBGL and UNMASKED_RENDERER_WEBGL
          if (parameter === 37445) {
            return "Intel Inc.";
          }
          if (parameter === 37446) {
            return "Intel Iris OpenGL Engine";
          }
          return getParameter.call(this, parameter);
        };
      }
    });

    const page = await context.newPage();

    // Set additional page properties
    await page.addInitScript(() => {
      // Simulate real screen size and color depth
      Object.defineProperty(window.screen, "width", { get: () => 1920 });
      Object.defineProperty(window.screen, "height", { get: () => 1080 });
      Object.defineProperty(window.screen, "colorDepth", { get: () => 24 });
      Object.defineProperty(window.screen, "pixelDepth", { get: () => 24 });
    });

    try {
      // Use the saved Google domain or choose one randomly
      let selectedDomain: string;
      if (savedState.googleDomain) {
        selectedDomain = savedState.googleDomain;
        logger.info({ domain: selectedDomain }, "Using saved Google domain");
      } else {
        selectedDomain =
          googleDomains[Math.floor(Math.random() * googleDomains.length)];
        // Save the selected domain
        savedState.googleDomain = selectedDomain;
        logger.info(
          { domain: selectedDomain },
          "Randomly selected Google domain",
        );
      }

      logger.info("Navigating to Google search page...");

      // Navigate to the Google search page
      const response = await page.goto(selectedDomain, {
        timeout,
        waitUntil: "networkidle",
      });

      // Check if redirected to a human verification page
      const currentUrl = page.url();
      const sorryPatterns = [
        "google.com/sorry/index",
        "google.com/sorry",
        "recaptcha",
        "captcha",
        "unusual traffic",
      ];

      const isBlockedPage = sorryPatterns.some(
        (pattern) =>
          currentUrl.includes(pattern) ||
          (response && response.url().toString().includes(pattern)),
      );

      if (isBlockedPage) {
        if (headless) {
          logger.warn(
            "Human verification page detected, restarting browser in headed mode...",
          );

          // Close the current page and context
          await page.close();
          await context.close();

          // If the browser was provided externally, do not close it, but create a new browser instance
          if (browserWasProvided) {
            logger.info(
              "Encountered human verification with an external browser instance, creating a new browser instance...",
            );
            // Create a new browser instance, no longer using the externally provided one
            const newBrowser = await chromium.launch({
              headless: false, // Use headed mode
              timeout: timeout * 2,
              args: [
                "--disable-blink-features=AutomationControlled",
                // Other parameters are the same as before
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
              ignoreDefaultArgs: ["--enable-automation"],
            });

            // Perform the search with the new browser instance
            try {
              const tempContext = await newBrowser.newContext(contextOptions);
              const tempPage = await tempContext.newPage();

              // Code to handle human verification can be added here
              // ...

              // Close the temporary browser when done
              await newBrowser.close();

              // Re-run the search
              return performSearch(false);
            } catch (error) {
              await newBrowser.close();
              throw error;
            }
          } else {
            // If the browser was not provided externally, close it and re-run the search
            await browser.close();
            return performSearch(false); // Re-run the search in headed mode
          }
        } else {
          logger.warn(
            "Human verification page detected, please complete the verification in the browser...",
          );
          // Wait for the user to complete verification and be redirected back to the search page
          await page.waitForNavigation({
            timeout: timeout * 2,
            url: (url) => {
              const urlStr = url.toString();
              return sorryPatterns.every(
                (pattern) => !urlStr.includes(pattern),
              );
            },
          });
          logger.info("Human verification complete, continuing search...");
        }
      }

      logger.info({ query }, "Entering search keyword");

      // Wait for the search box to appear - try several possible selectors
      const searchInputSelectors = [
        "textarea[name='q']",
        "input[name='q']",
        "textarea[title='Search']",
        "input[title='Search']",
        "textarea[aria-label='Search']",
        "input[aria-label='Search']",
        "textarea",
      ];

      let searchInput = null;
      for (const selector of searchInputSelectors) {
        searchInput = await page.$(selector);
        if (searchInput) {
          logger.info({ selector }, "Found search box");
          break;
        }
      }

      if (!searchInput) {
        logger.error("Could not find search box");
        throw new Error("Could not find search box");
      }

      // Click the search box directly to reduce delay
      await searchInput.click();

      // Type the entire query string directly instead of character by character
      await page.keyboard.type(query, { delay: getRandomDelay(10, 30) });

      // Reduce delay before pressing Enter
      await page.waitForTimeout(getRandomDelay(100, 300));
      await page.keyboard.press("Enter");

      logger.info("Waiting for page to load...");

      // Wait for the page to finish loading
      await page.waitForLoadState("networkidle", { timeout });

      // Check if the URL after searching is redirected to a human verification page
      const searchUrl = page.url();
      const isBlockedAfterSearch = sorryPatterns.some((pattern) =>
        searchUrl.includes(pattern),
      );

      if (isBlockedAfterSearch) {
        if (headless) {
          logger.warn(
            "Human verification page detected after search, restarting browser in headed mode...",
          );

          // Close the current page and context
          await page.close();
          await context.close();

          // If the browser was provided externally, do not close it, but create a new browser instance
          if (browserWasProvided) {
            logger.info(
              "Encountered human verification after search with an external browser instance, creating a new browser instance...",
            );
            // Create a new browser instance, no longer using the externally provided one
            const newBrowser = await chromium.launch({
              headless: false, // Use headed mode
              timeout: timeout * 2,
              args: [
                "--disable-blink-features=AutomationControlled",
                // Other parameters are the same as before
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
              ignoreDefaultArgs: ["--enable-automation"],
            });

            // Perform the search with the new browser instance
            try {
              const tempContext = await newBrowser.newContext(contextOptions);
              const tempPage = await tempContext.newPage();

              // Code to handle human verification can be added here
              // ...

              // Close the temporary browser when done
              await newBrowser.close();

              // Re-run the search
              return performSearch(false);
            } catch (error) {
              await newBrowser.close();
              throw error;
            }
          } else {
            // If the browser was not provided externally, close it and re-run the search
            await browser.close();
            return performSearch(false); // Re-run the search in headed mode
          }
        } else {
          logger.warn(
            "Human verification page detected after search, please complete the verification in the browser...",
          );
          // Wait for the user to complete verification and be redirected back to the search page
          await page.waitForNavigation({
            timeout: timeout * 2,
            url: (url) => {
              const urlStr = url.toString();
              return sorryPatterns.every(
                (pattern) => !urlStr.includes(pattern),
              );
            },
          });
          logger.info("Human verification complete, continuing search...");

          // Wait for the page to reload
          await page.waitForLoadState("networkidle", { timeout });
        }
      }

      logger.info({ url: page.url() }, "Waiting for search results to load...");

      // Try several possible search result selectors
      const searchResultSelectors = [
        "#search",
        "#rso",
        ".g",
        "[data-sokoban-container]",
        "div[role='main']",
      ];

      let resultsFound = false;
      for (const selector of searchResultSelectors) {
        try {
          await page.waitForSelector(selector, { timeout: timeout / 2 });
          logger.info({ selector }, "Found search results");
          resultsFound = true;
          break;
        } catch (e) {
          // Continue to the next selector
        }
      }

      if (!resultsFound) {
        // If search results are not found, check if redirected to a human verification page
        const currentUrl = page.url();
        const isBlockedDuringResults = sorryPatterns.some((pattern) =>
          currentUrl.includes(pattern),
        );

        if (isBlockedDuringResults) {
          if (headless) {
            logger.warn(
              "Human verification page detected while waiting for search results, restarting browser in headed mode...",
            );

            // Close the current page and context
            await page.close();
            await context.close();

            // If the browser was provided externally, do not close it, but create a new browser instance
            if (browserWasProvided) {
              logger.info(
                "Encountered human verification while waiting for search results with an external browser instance, creating a new browser instance...",
              );
              // Create a new browser instance, no longer using the externally provided one
              const newBrowser = await chromium.launch({
                headless: false, // Use headed mode
                timeout: timeout * 2,
                args: [
                  "--disable-blink-features=AutomationControlled",
                  // Other parameters are the same as before
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
                ignoreDefaultArgs: ["--enable-automation"],
              });

              // Perform the search with the new browser instance
              try {
                const tempContext = await newBrowser.newContext(contextOptions);
                const tempPage = await tempContext.newPage();

                // Code to handle human verification can be added here
                // ...

                // Close the temporary browser when done
                await newBrowser.close();

                // Re-run the search
                return performSearch(false);
              } catch (error) {
                await newBrowser.close();
                throw error;
              }
            } else {
              // If the browser was not provided externally, close it and re-run the search
              await browser.close();
              return performSearch(false); // Re-run the search in headed mode
            }
          } else {
            logger.warn(
              "Human verification page detected while waiting for search results, please complete the verification in the browser...",
            );
            // Wait for the user to complete verification and be redirected back to the search page
            await page.waitForNavigation({
              timeout: timeout * 2,
              url: (url) => {
                const urlStr = url.toString();
                return sorryPatterns.every(
                  (pattern) => !urlStr.includes(pattern),
                );
              },
            });
            logger.info("Human verification complete, continuing search...");

            // Try waiting for search results again
            for (const selector of searchResultSelectors) {
              try {
                await page.waitForSelector(selector, { timeout: timeout / 2 });
                logger.info(
                  { selector },
                  "Found search results after verification",
                );
                resultsFound = true;
                break;
              } catch (e) {
                // Continue to the next selector
              }
            }

            if (!resultsFound) {
              logger.error("Could not find search results element");
              throw new Error("Could not find search results element");
            }
          }
        } else {
          // If it's not a human verification issue, throw an error
          logger.error("Could not find search results element");
          throw new Error("Could not find search results element");
        }
      }

      // Reduce wait time
      await page.waitForTimeout(getRandomDelay(200, 500));

      logger.info("Extracting search results...");

      let results: SearchResult[] = []; // Declare results before the evaluate call

      // Extract search results - using logic ported from google-search-extractor.cjs
      results = await page.evaluate((maxResults: number): SearchResult[] => {
        // Add return type
        const results: { title: string; link: string; snippet: string }[] = [];
        const seenUrls = new Set<string>(); // For deduplication

        // Define multiple sets of selectors, sorted by priority (refer to google-search-extractor.cjs)
        const selectorSets = [
          {
            container: "#search div[data-hveid]",
            title: "h3",
            snippet: ".VwiC3b",
          },
          {
            container: "#rso div[data-hveid]",
            title: "h3",
            snippet: '[data-sncf="1"]',
          },
          {
            container: ".g",
            title: "h3",
            snippet: 'div[style*="webkit-line-clamp"]',
          },
          {
            container: "div[jscontroller][data-hveid]",
            title: "h3",
            snippet: 'div[role="text"]',
          },
        ];

        // Alternative snippet selectors
        const alternativeSnippetSelectors = [
          ".VwiC3b",
          '[data-sncf="1"]',
          'div[style*="webkit-line-clamp"]',
          'div[role="text"]',
        ];

        // Try each set of selectors
        for (const selectors of selectorSets) {
          if (results.length >= maxResults) break; // Stop if the limit is reached

          const containers = document.querySelectorAll(selectors.container);

          for (const container of containers) {
            if (results.length >= maxResults) break;

            const titleElement = container.querySelector(selectors.title);
            if (!titleElement) continue;

            const title = (titleElement.textContent || "").trim();

            // Find the link
            let link = "";
            const linkInTitle = titleElement.querySelector("a");
            if (linkInTitle) {
              link = linkInTitle.href;
            } else {
              let current: Element | null = titleElement;
              while (current && current.tagName !== "A") {
                current = current.parentElement;
              }
              if (current && current instanceof HTMLAnchorElement) {
                link = current.href;
              } else {
                const containerLink = container.querySelector("a");
                if (containerLink) {
                  link = containerLink.href;
                }
              }
            }

            // Filter invalid or duplicate links
            if (!link || !link.startsWith("http") || seenUrls.has(link))
              continue;

            // Find the snippet
            let snippet = "";
            const snippetElement = container.querySelector(selectors.snippet);
            if (snippetElement) {
              snippet = (snippetElement.textContent || "").trim();
            } else {
              // Try other snippet selectors
              for (const altSelector of alternativeSnippetSelectors) {
                const element = container.querySelector(altSelector);
                if (element) {
                  snippet = (element.textContent || "").trim();
                  break;
                }
              }

              // If a snippet is still not found, try a generic method
              if (!snippet) {
                const textNodes = Array.from(
                  container.querySelectorAll("div"),
                ).filter(
                  (el) =>
                    !el.querySelector("h3") &&
                    (el.textContent || "").trim().length > 20,
                );
                if (textNodes.length > 0) {
                  snippet = (textNodes[0].textContent || "").trim();
                }
              }
            }

            // Only add results with a title and a link
            if (title && link) {
              results.push({ title, link, snippet });
              seenUrls.add(link); // Record the processed URL
            }
          }
        }

        // If the main selectors did not find enough results, try a more generic method (as a supplement)
        if (results.length < maxResults) {
          const anchorElements = Array.from(
            document.querySelectorAll("a[href^='http']"),
          );
          for (const el of anchorElements) {
            if (results.length >= maxResults) break;

            // Check if el is an HTMLAnchorElement
            if (!(el instanceof HTMLAnchorElement)) {
              continue;
            }
            const link = el.href;
            // Filter out navigation links, image links, existing links, etc.
            if (
              !link ||
              seenUrls.has(link) ||
              link.includes("google.com/") ||
              link.includes("accounts.google") ||
              link.includes("support.google")
            ) {
              continue;
            }

            const title = (el.textContent || "").trim();
            if (!title) continue; // Skip links without text content

            // Try to get surrounding text as a snippet
            let snippet = "";
            let parent = el.parentElement;
            for (let i = 0; i < 3 && parent; i++) {
              const text = (parent.textContent || "").trim();
              // Ensure the snippet text is different from the title and has a certain length
              if (text.length > 20 && text !== title) {
                snippet = text;
                break; // Stop searching upwards once a suitable snippet is found
              }
              parent = parent.parentElement;
            }

            results.push({ title, link, snippet });
            seenUrls.add(link);
          }
        }

        return results.slice(0, maxResults); // Ensure not to exceed the limit
      }, limit); // Pass limit to the evaluate function

      logger.info(
        { count: results.length },
        "Successfully retrieved search results",
      );

      try {
        // Save browser state (unless the user specified not to)
        if (!noSaveState) {
          logger.info({ stateFile }, "Saving browser state...");

          // Ensure the directory exists
          const stateDir = path.dirname(stateFile);
          if (!fs.existsSync(stateDir)) {
            fs.mkdirSync(stateDir, { recursive: true });
          }

          // Save state
          await context.storageState({ path: stateFile });
          logger.info("Browser state saved successfully!");

          // Save fingerprint configuration
          try {
            fs.writeFileSync(
              fingerprintFile,
              JSON.stringify(savedState, null, 2),
              "utf8",
            );
            logger.info({ fingerprintFile }, "Fingerprint configuration saved");
          } catch (fingerprintError) {
            logger.error(
              { error: fingerprintError },
              "Error saving fingerprint configuration",
            );
          }
        } else {
          logger.info("Not saving browser state as per user settings");
        }
      } catch (error) {
        logger.error({ error }, "Error saving browser state");
      }

      // Only close the browser if it was not provided externally
      if (!browserWasProvided) {
        logger.info("Closing browser...");
        await browser.close();
      } else {
        logger.info("Keeping browser instance open");
      }

      // Return the search results
      return {
        query,
        results, // results is now accessible in this scope
      };
    } catch (error) {
      logger.error({ error }, "An error occurred during the search process");

      try {
        // Try to save the browser state even if an error occurred
        if (!noSaveState) {
          logger.info({ stateFile }, "Saving browser state...");
          const stateDir = path.dirname(stateFile);
          if (!fs.existsSync(stateDir)) {
            fs.mkdirSync(stateDir, { recursive: true });
          }
          await context.storageState({ path: stateFile });

          // Save fingerprint configuration
          try {
            fs.writeFileSync(
              fingerprintFile,
              JSON.stringify(savedState, null, 2),
              "utf8",
            );
            logger.info({ fingerprintFile }, "Fingerprint configuration saved");
          } catch (fingerprintError) {
            logger.error(
              { error: fingerprintError },
              "Error saving fingerprint configuration",
            );
          }
        }
      } catch (stateError) {
        logger.error({ error: stateError }, "Error saving browser state");
      }

      // Only close the browser if it was not provided externally
      if (!browserWasProvided) {
        logger.info("Closing browser...");
        await browser.close();
      } else {
        logger.info("Keeping browser instance open");
      }

      // Return an error message or an empty result
      // logger.error has already logged the error, so here we return a mock result with the error message
      return {
        query,
        results: [
          {
            title: "Search failed",
            link: "",
            snippet: `Could not complete the search, error message: ${
              error instanceof Error ? error.message : String(error)
            }`,
          },
        ],
      };
    }
    // The finally block has been removed because resource cleanup is already handled in the try and catch blocks
  }

  // First, try to perform the search in headless mode
  return performSearch(useHeadless);
}

/**
 * Get the raw HTML of the Google search results page
 * @param query The search keyword
 * @param options Search options
 * @param saveToFile Whether to save the HTML to a file (optional)
 * @param outputPath HTML output file path (optional, defaults to './google-search-html/[query]-[timestamp].html')
 * @returns A response object containing the HTML content
 */
export async function getGoogleSearchPageHtml(
  query: string,
  options: CommandOptions = {},
  saveToFile: boolean = false,
  outputPath?: string,
): Promise<HtmlResponse> {
  // Set default options, consistent with googleSearch
  const {
    timeout = 60000,
    stateFile = "./browser-state.json",
    noSaveState = false,
    locale = "en-US", // Default to English
  } = options;

  // Ignore the incoming headless parameter and always start in headless mode
  let useHeadless = true;

  logger.info({ options }, "Initializing browser to get search page HTML...");

  // Reuse the browser initialization code from googleSearch
  // Check if a state file exists
  let storageState: string | undefined = undefined;
  let savedState: SavedState = {};

  // Fingerprint configuration file path
  const fingerprintFile = stateFile.replace(".json", "-fingerprint.json");

  if (fs.existsSync(stateFile)) {
    logger.info(
      { stateFile },
      "Browser state file found, will use saved browser state to avoid anti-bot detection",
    );
    storageState = stateFile;

    // Try to load the saved fingerprint configuration
    if (fs.existsSync(fingerprintFile)) {
      try {
        const fingerprintData = fs.readFileSync(fingerprintFile, "utf8");
        savedState = JSON.parse(fingerprintData);
        logger.info("Loaded saved browser fingerprint configuration");
      } catch (e) {
        logger.warn(
          { error: e },
          "Failed to load fingerprint configuration file, will create a new one",
        );
      }
    }
  } else {
    logger.info(
      { stateFile },
      "Browser state file not found, will create a new browser session and fingerprint",
    );
  }

  // Use only desktop device list
  const deviceList = [
    "Desktop Chrome",
    "Desktop Edge",
    "Desktop Firefox",
    "Desktop Safari",
  ];

  // Google domain list
  const googleDomains = [
    "https://www.google.com",
    "https://www.google.co.uk",
    "https://www.google.ca",
    "https://www.google.com.au",
  ];

  // Get random device configuration or use the saved one
  const getDeviceConfig = (): [string, any] => {
    if (
      savedState.fingerprint?.deviceName &&
      devices[savedState.fingerprint.deviceName]
    ) {
      // Use the saved device configuration
      return [
        savedState.fingerprint.deviceName,
        devices[savedState.fingerprint.deviceName],
      ];
    } else {
      // Choose a random device
      const randomDevice =
        deviceList[Math.floor(Math.random() * deviceList.length)];
      return [randomDevice, devices[randomDevice]];
    }
  };

  // Get a random delay time
  const getRandomDelay = (min: number, max: number) => {
    return Math.floor(Math.random() * (max - min + 1)) + min;
  };

  // Define a dedicated function to get the HTML
  async function performSearchAndGetHtml(
    headless: boolean,
  ): Promise<HtmlResponse> {
    let browser: Browser;

    // Initialize the browser, adding more parameters to avoid detection
    browser = await chromium.launch({
      headless,
      timeout: timeout * 2, // Increase browser launch timeout
      args: [
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
      ignoreDefaultArgs: ["--enable-automation"],
    });

    logger.info("Browser launched successfully!");

    // Get device configuration - use saved or randomly generated
    const [deviceName, deviceConfig] = getDeviceConfig();

    // Create browser context options
    let contextOptions: BrowserContextOptions = {
      ...deviceConfig,
    };

    // If there is a saved fingerprint configuration, use it; otherwise, use the host machine's actual settings
    if (savedState.fingerprint) {
      contextOptions = {
        ...contextOptions,
        locale: savedState.fingerprint.locale,
        timezoneId: savedState.fingerprint.timezoneId,
        colorScheme: savedState.fingerprint.colorScheme,
        reducedMotion: savedState.fingerprint.reducedMotion,
        forcedColors: savedState.fingerprint.forcedColors,
      };
      logger.info("Using saved browser fingerprint configuration");
    } else {
      // Get the host machine's actual settings
      const hostConfig = getHostMachineConfig(locale);

      // If a different device type is needed, re-get the device configuration
      if (hostConfig.deviceName !== deviceName) {
        logger.info(
          { deviceType: hostConfig.deviceName },
          "Using device type based on host machine settings",
        );
        // Use the new device configuration
        contextOptions = { ...devices[hostConfig.deviceName] };
      }

      contextOptions = {
        ...contextOptions,
        locale: hostConfig.locale,
        timezoneId: hostConfig.timezoneId,
        colorScheme: hostConfig.colorScheme,
        reducedMotion: hostConfig.reducedMotion,
        forcedColors: hostConfig.forcedColors,
      };

      // Save the newly generated fingerprint configuration
      savedState.fingerprint = hostConfig;
      logger.info(
        {
          locale: hostConfig.locale,
          timezone: hostConfig.timezoneId,
          colorScheme: hostConfig.colorScheme,
          deviceType: hostConfig.deviceName,
        },
        "Generated new browser fingerprint configuration based on the host machine",
      );
    }

    // Add common options - ensure desktop configuration is used
    contextOptions = {
      ...contextOptions,
      permissions: ["geolocation", "notifications"],
      acceptDownloads: true,
      isMobile: false, // Force desktop mode
      hasTouch: false, // Disable touch functionality
      javaScriptEnabled: true,
    };

    if (storageState) {
      logger.info("Loading saved browser state...");
    }

    const context = await browser.newContext(
      storageState ? { ...contextOptions, storageState } : contextOptions,
    );

    // Set additional browser properties to avoid detection
    await context.addInitScript(() => {
      // Override navigator properties
      Object.defineProperty(navigator, "webdriver", { get: () => false });
      Object.defineProperty(navigator, "plugins", {
        get: () => [1, 2, 3, 4, 5],
      });
      Object.defineProperty(navigator, "languages", {
        get: () => ["en-US", "en"],
      });

      // Override window properties
      // @ts-ignore - Ignore error that chrome property does not exist
      (window as any).chrome = {
        runtime: {},
        loadTimes: function () {},
        csi: function () {},
        app: {},
      };

      // Add WebGL fingerprint randomization
      if (typeof WebGLRenderingContext !== "undefined") {
        const getParameter = WebGLRenderingContext.prototype.getParameter;
        WebGLRenderingContext.prototype.getParameter = function (
          parameter: number,
        ) {
          // Randomize UNMASKED_VENDOR_WEBGL and UNMASKED_RENDERER_WEBGL
          if (parameter === 37445) {
            return "Intel Inc.";
          }
          if (parameter === 37446) {
            return "Intel Iris OpenGL Engine";
          }
          return getParameter.call(this, parameter);
        };
      }
    });

    const page = await context.newPage();

    // Set additional page properties
    await page.addInitScript(() => {
      // Simulate real screen size and color depth
      Object.defineProperty(window.screen, "width", { get: () => 1920 });
      Object.defineProperty(window.screen, "height", { get: () => 1080 });
      Object.defineProperty(window.screen, "colorDepth", { get: () => 24 });
      Object.defineProperty(window.screen, "pixelDepth", { get: () => 24 });
    });

    try {
      // Use the saved Google domain or choose one randomly
      let selectedDomain: string;
      if (savedState.googleDomain) {
        selectedDomain = savedState.googleDomain;
        logger.info({ domain: selectedDomain }, "Using saved Google domain");
      } else {
        selectedDomain =
          googleDomains[Math.floor(Math.random() * googleDomains.length)];
        // Save the selected domain
        savedState.googleDomain = selectedDomain;
        logger.info(
          { domain: selectedDomain },
          "Randomly selected Google domain",
        );
      }

      logger.info("Navigating to Google search page...");

      // Navigate to the Google search page
      const response = await page.goto(selectedDomain, {
        timeout,
        waitUntil: "networkidle",
      });

      // Check if redirected to a human verification page
      const currentUrl = page.url();
      const sorryPatterns = [
        "google.com/sorry/index",
        "google.com/sorry",
        "recaptcha",
        "captcha",
        "unusual traffic",
      ];

      const isBlockedPage = sorryPatterns.some(
        (pattern) =>
          currentUrl.includes(pattern) ||
          (response && response.url().toString().includes(pattern)),
      );

      if (isBlockedPage) {
        if (headless) {
          logger.warn(
            "Human verification page detected, restarting browser in headed mode...",
          );

          // Close the current page and context
          await page.close();
          await context.close();
          await browser.close();

          // Re-run in headed mode
          return performSearchAndGetHtml(false);
        } else {
          logger.warn(
            "Human verification page detected, please complete the verification in the browser...",
          );
          // Wait for the user to complete verification and be redirected back to the search page
          await page.waitForNavigation({
            timeout: timeout * 2,
            url: (url) => {
              const urlStr = url.toString();
              return sorryPatterns.every(
                (pattern) => !urlStr.includes(pattern),
              );
            },
          });
          logger.info("Human verification complete, continuing search...");
        }
      }

      logger.info({ query }, "Entering search keyword");

      // Wait for the search box to appear - try several possible selectors
      const searchInputSelectors = [
        "textarea[name='q']",
        "input[name='q']",
        "textarea[title='Search']",
        "input[title='Search']",
        "textarea[aria-label='Search']",
        "input[aria-label='Search']",
        "textarea",
      ];

      let searchInput = null;
      for (const selector of searchInputSelectors) {
        searchInput = await page.$(selector);
        if (searchInput) {
          logger.info({ selector }, "Found search box");
          break;
        }
      }

      if (!searchInput) {
        logger.error("Could not find search box");
        throw new Error("Could not find search box");
      }

      // Click the search box directly to reduce delay
      await searchInput.click();

      // Type the entire query string directly instead of character by character
      await page.keyboard.type(query, { delay: getRandomDelay(10, 30) });

      // Reduce delay before pressing Enter
      await page.waitForTimeout(getRandomDelay(100, 300));
      await page.keyboard.press("Enter");

      logger.info("Waiting for search results page to load...");

      // Wait for the page to finish loading
      await page.waitForLoadState("networkidle", { timeout });

      // Check if the URL after searching is redirected to a human verification page
      const searchUrl = page.url();
      const isBlockedAfterSearch = sorryPatterns.some((pattern) =>
        searchUrl.includes(pattern),
      );

      if (isBlockedAfterSearch) {
        if (headless) {
          logger.warn(
            "Human verification page detected after search, restarting browser in headed mode...",
          );

          // Close the current page and context
          await page.close();
          await context.close();
          await browser.close();

          // Re-run in headed mode
          return performSearchAndGetHtml(false);
        } else {
          logger.warn(
            "Human verification page detected after search, please complete the verification in the browser...",
          );
          // Wait for the user to complete verification and be redirected back to the search page
          await page.waitForNavigation({
            timeout: timeout * 2,
            url: (url) => {
              const urlStr = url.toString();
              return sorryPatterns.every(
                (pattern) => !urlStr.includes(pattern),
              );
            },
          });
          logger.info("Human verification complete, continuing search...");

          // Wait for the page to reload
          await page.waitForLoadState("networkidle", { timeout });
        }
      }

      // Get the current page URL
      const finalUrl = page.url();
      logger.info(
        { url: finalUrl },
        "Search results page loaded, preparing to extract HTML...",
      );

      // Add extra wait time to ensure the page is fully loaded and stable
      logger.info("Waiting for page to stabilize...");
      await page.waitForTimeout(1000); // Wait for 1 second to let the page fully stabilize

      // Wait for network to be idle again to ensure all async operations are complete
      await page.waitForLoadState("networkidle", { timeout });

      // Get the page HTML content
      const fullHtml = await page.content();

      // Remove CSS and JavaScript content, keeping only pure HTML
      // Remove all <style> tags and their content
      let html = fullHtml.replace(
        /<style\b[^<]*(?:(?!<\/style>)<[^<]*)*<\/style>/gi,
        "",
      );
      // Remove all <link rel="stylesheet"> tags
      html = html.replace(/<link\s+[^>]*rel=["']stylesheet["'][^>]*>/gi, "");
      // Remove all <script> tags and their content
      html = html.replace(
        /<script\b[^<]*(?:(?!<\/script>)<[^<]*)*<\/script>/gi,
        "",
      );

      logger.info(
        {
          originalLength: fullHtml.length,
          cleanedLength: html.length,
        },
        "Successfully retrieved and cleaned page HTML content",
      );

      // If needed, save the HTML to a file and take a screenshot
      let savedFilePath: string | undefined = undefined;
      let screenshotPath: string | undefined = undefined;

      if (saveToFile) {
        // Generate a default filename (if not provided)
        if (!outputPath) {
          // Ensure the directory exists
          const outputDir = "./google-search-html";
          if (!fs.existsSync(outputDir)) {
            fs.mkdirSync(outputDir, { recursive: true });
          }

          // Generate filename: query-timestamp.html
          const timestamp = new Date()
            .toISOString()
            .replace(/:/g, "-")
            .replace(/\./g, "-");
          const sanitizedQuery = query
            .replace(/[^a-zA-Z0-9]/g, "_")
            .substring(0, 50);
          outputPath = `${outputDir}/${sanitizedQuery}-${timestamp}.html`;
        }

        // Ensure the file directory exists
        const fileDir = path.dirname(outputPath);
        if (!fs.existsSync(fileDir)) {
          fs.mkdirSync(fileDir, { recursive: true });
        }

        // Write the HTML file
        fs.writeFileSync(outputPath, html, "utf8");
        savedFilePath = outputPath;
        logger.info(
          { path: outputPath },
          "Cleaned HTML content has been saved to file",
        );

        // Save a screenshot of the web page
        // Generate screenshot filename (based on the HTML filename, but with a .png extension)
        const screenshotFilePath = outputPath.replace(/\.html$/, ".png");

        // Take a screenshot of the entire page
        logger.info("Taking a screenshot of the web page...");
        await page.screenshot({
          path: screenshotFilePath,
          fullPage: true,
        });

        screenshotPath = screenshotFilePath;
        logger.info(
          { path: screenshotFilePath },
          "Web page screenshot has been saved",
        );
      }

      try {
        // Save browser state (unless the user specified not to)
        if (!noSaveState) {
          logger.info({ stateFile }, "Saving browser state...");

          // Ensure the directory exists
          const stateDir = path.dirname(stateFile);
          if (!fs.existsSync(stateDir)) {
            fs.mkdirSync(stateDir, { recursive: true });
          }

          // Save state
          await context.storageState({ path: stateFile });
          logger.info("Browser state saved successfully!");

          // Save fingerprint configuration
          try {
            fs.writeFileSync(
              fingerprintFile,
              JSON.stringify(savedState, null, 2),
              "utf8",
            );
            logger.info({ fingerprintFile }, "Fingerprint configuration saved");
          } catch (fingerprintError) {
            logger.error(
              { error: fingerprintError },
              "Error saving fingerprint configuration",
            );
          }
        } else {
          logger.info("Not saving browser state as per user settings");
        }
      } catch (error) {
        logger.error({ error }, "Error saving browser state");
      }

      // Close the browser
      logger.info("Closing browser...");
      await browser.close();

      // Return the HTML response
      return {
        query,
        html,
        url: finalUrl,
        savedPath: savedFilePath,
        screenshotPath: screenshotPath,
        originalHtmlLength: fullHtml.length,
      };
    } catch (error) {
      logger.error({ error }, "An error occurred while getting the page HTML");

      try {
        // Try to save the browser state even if an error occurred
        if (!noSaveState) {
          logger.info({ stateFile }, "Saving browser state...");
          const stateDir = path.dirname(stateFile);
          if (!fs.existsSync(stateDir)) {
            fs.mkdirSync(stateDir, { recursive: true });
          }
          await context.storageState({ path: stateFile });

          // Save fingerprint configuration
          try {
            fs.writeFileSync(
              fingerprintFile,
              JSON.stringify(savedState, null, 2),
              "utf8",
            );
            logger.info({ fingerprintFile }, "Fingerprint configuration saved");
          } catch (fingerprintError) {
            logger.error(
              { error: fingerprintError },
              "Error saving fingerprint configuration",
            );
          }
        }
      } catch (stateError) {
        logger.error({ error: stateError }, "Error saving browser state");
      }

      // Close the browser
      logger.info("Closing browser...");
      await browser.close();

      // Return an error message
      throw new Error(
        `Failed to get Google search page HTML: ${error instanceof Error ? error.message : String(error)}`,
      );
    }
  }

  // First, try to execute in headless mode
  return performSearchAndGetHtml(useHeadless);
}
