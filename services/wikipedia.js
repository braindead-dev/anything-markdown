const { fetch } = require("undici");
const TurndownService = require("turndown");

const turndown = new TurndownService({
  headingStyle: "atx",
  codeBlockStyle: "fenced",
});

// Simplify output: drop images, tables, references sections, nav boxes
function preprocessWikipediaHtml(html) {
  // Remove tables, infoboxes, navboxes, thumbnails, and reference superscripts
  return html
    .replace(/<table[\s\S]*?<\/table>/gi, "")
    .replace(/<figure[\s\S]*?<\/figure>/gi, "")
    .replace(/<img[\s\S]*?>/gi, "")
    .replace(/<sup[^>]*class="reference"[\s\S]*?<\/sup>/gi, "")
    .replace(/<style[\s\S]*?<\/style>/gi, "")
    .replace(/<script[\s\S]*?<\/script>/gi, "");
}

async function fetchWikipediaHtml(slug) {
  const encoded = encodeURIComponent(slug);
  const url = `https://en.wikipedia.org/api/rest_v1/page/html/${encoded}`;
  const response = await fetch(url, {
    headers: {
      accept:
        'text/html; charset=UTF-8; profile="https://www.mediawiki.org/wiki/Specs/HTML/2.7.0"',
      "user-agent": "anything-markdown/1.0 (https://github.com/braindead-dev)",
    },
  });
  if (!response.ok) {
    const text = await response.text().catch(() => "");
    const message = text && text.length < 500 ? text : response.statusText;
    const error = new Error(
      `wikipedia fetch failed: ${response.status} ${message}`,
    );
    error.status = response.status;
    throw error;
  }
  return response.text();
}

async function convertWikipediaToMarkdown(slug) {
  const html = await fetchWikipediaHtml(slug);
  const cleaned = preprocessWikipediaHtml(html);
  const markdown = turndown.turndown(cleaned);
  // Trim excessive blank lines
  return markdown
    .replace(/[\t ]+$/gm, "")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

module.exports = {
  convertWikipediaToMarkdown,
};
