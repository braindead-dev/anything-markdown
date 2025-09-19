const { fetch } = require("undici");
const TurndownService = require("turndown");

const turndown = new TurndownService({
  headingStyle: "atx",
  codeBlockStyle: "fenced",
});

// Rewrite relative links to absolute Wikipedia links
// ./Foo -> https://en.wikipedia.org/wiki/Foo
// /wiki/Foo -> https://en.wikipedia.org/wiki/Foo
// //example.com -> https://example.com
// #fragment -> keep as-is
turndown.addRule("absoluteLinks", {
  filter: "a",
  replacement: function (content, node) {
    const href = node.getAttribute("href") || "";
    let url = href;
    if (href.startsWith("./")) {
      url = "https://en.wikipedia.org/wiki/" + href.slice(2);
    } else if (href.startsWith("/wiki/")) {
      url = "https://en.wikipedia.org" + href;
    } else if (href.startsWith("//")) {
      url = "https:" + href;
    } else if (href.startsWith("#")) {
      url = href; // keep fragment
    }
    if (!url) return content || "";
    return "[" + (content || "") + "](" + url + ")";
  },
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
      "user-agent": "anything-markdown/1.0 (https://github.com/henry)",
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

async function fetchWikipediaTitle(slug) {
  const encoded = encodeURIComponent(slug);
  const url = `https://en.wikipedia.org/api/rest_v1/page/summary/${encoded}`;
  const response = await fetch(url, {
    headers: {
      accept: "application/json",
      "user-agent": "anything-markdown/1.0 (https://github.com/henry)",
    },
  });
  if (!response.ok) {
    // Fallback to slug formatting if summary fails
    return decodeURIComponent(slug).replace(/_/g, " ");
  }
  const data = await response.json();
  return (
    (data && (data.title || data.displaytitle)) ||
    decodeURIComponent(slug).replace(/_/g, " ")
  );
}

async function convertWikipediaToMarkdown(slug) {
  const [html, title] = await Promise.all([
    fetchWikipediaHtml(slug),
    fetchWikipediaTitle(slug),
  ]);
  const cleaned = preprocessWikipediaHtml(html);
  const bodyMarkdown = turndown.turndown(cleaned);
  const markdown = `# ${title}\n\n${bodyMarkdown}`;
  // Trim excessive blank lines
  return markdown
    .replace(/[\t ]+$/gm, "")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

module.exports = {
  convertWikipediaToMarkdown,
};
