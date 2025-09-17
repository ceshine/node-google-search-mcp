#!/usr/bin/env node

import { Command } from "commander";
import { googleSearch, getGoogleSearchPageHtml } from "./search.js";
import { CommandOptions } from "./types.js";

// Get package information
import packageJson from "../package.json" with { type: "json" };

// Create command-line program
const program = new Command();

// Configure command-line options
program
  .name("google-search")
  .description("A Google search CLI tool based on Playwright")
  .version(packageJson.version)
  .argument("<query>", "Search keyword")
  .option("-l, --limit <number>", "Limit the number of results", parseInt, 10)
  .option("-t, --timeout <number>", "Timeout in milliseconds", parseInt, 30000)
  .option(
    "--no-headless",
    "Deprecated: Always tries headless mode first, and automatically switches to headed mode if human verification is encountered",
  )
  .option(
    "--state-file <path>",
    "Path to the browser state file",
    "./browser-state.json",
  )
  .option("--no-save-state", "Do not save browser state")
  .option(
    "--get-html",
    "Get the raw HTML of the search results page instead of parsed results",
  )
  .option("--save-html", "Save the HTML to a file")
  .option("--html-output <path>", "HTML output file path")
  .action(
    async (
      query: string,
      options: CommandOptions & {
        getHtml?: boolean;
        saveHtml?: boolean;
        htmlOutput?: string;
      },
    ) => {
      try {
        if (options.getHtml) {
          // Get HTML
          const htmlResult = await getGoogleSearchPageHtml(
            query,
            options,
            options.saveHtml || false,
            options.htmlOutput,
          );

          // If HTML was saved to a file, include the file path information in the output
          if (options.saveHtml && htmlResult.savedPath) {
            console.log(`HTML has been saved to file: ${htmlResult.savedPath}`);
          }

          // Output the result (without the full HTML to avoid excessive console output)
          const outputResult = {
            query: htmlResult.query,
            url: htmlResult.url,
            originalHtmlLength: htmlResult.originalHtmlLength, // Original HTML length (including CSS and JavaScript)
            cleanedHtmlLength: htmlResult.html.length, // Cleaned HTML length (excluding CSS and JavaScript)
            savedPath: htmlResult.savedPath,
            screenshotPath: htmlResult.screenshotPath, // Web page screenshot save path
            // Only output the first 500 characters of the HTML as a preview
            htmlPreview:
              htmlResult.html.substring(0, 500) +
              (htmlResult.html.length > 500 ? "..." : ""),
          };

          console.log(JSON.stringify(outputResult, null, 2));
        } else {
          // Perform a regular search
          const results = await googleSearch(query, options);

          // Output the results
          console.log(JSON.stringify(results, null, 2));
        }
      } catch (error) {
        console.error("Error:", error);
        process.exit(1);
      }
    },
  );

// Parse command-line arguments
program.parse(process.argv);
