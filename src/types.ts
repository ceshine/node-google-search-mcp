/**
 * Search result interface
 */
export interface SearchResult {
  title: string;
  link: string;
  snippet: string;
}

/**
 * Search response interface
 */
export interface SearchResponse {
  query: string;
  results: SearchResult[];
}

/**
 * Command-line options interface
 */
export interface CommandOptions {
  limit?: number;
  timeout?: number;
  headless?: boolean; // Deprecated, but kept for compatibility with existing code
  stateFile?: string;
  noSaveState?: boolean;
  locale?: string; // Search result language, defaults to English (en-US)
}

/**
 * HTML response interface - for getting the raw search page HTML
 */
export interface HtmlResponse {
  query: string;    // The search query
  html: string;     // The page's HTML content (cleaned, without CSS and JavaScript)
  url: string;      // The URL of the search results page
  savedPath?: string; // Optional, the path where the HTML is saved if it is saved to a file
  screenshotPath?: string; // Optional, the path where the web page screenshot is saved
  originalHtmlLength?: number; // Original HTML length (including CSS and JavaScript)
}
