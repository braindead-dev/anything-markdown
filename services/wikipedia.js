const { fetch } = require("undici");
const TurndownService = require("turndown");
const { gfm } = require("turndown-plugin-gfm");

const turndown = new TurndownService({
  headingStyle: "atx",
  codeBlockStyle: "fenced",
});

turndown.use(gfm);

// Convert any HTML table to GFM pipe table (handles captions and <th>)
turndown.addRule("wikitableToMarkdown", {
  filter: function (node) {
    return node.nodeName && node.nodeName.toLowerCase() === "table";
  },
  replacement: function (_content, node) {
    const table = node;

    // Extract caption if any
    const captionEl = table.querySelector("caption");
    const caption = captionEl
      ? turndown.turndown(captionEl.innerHTML).trim()
      : "";

    // Collect rows
    const rows = Array.from(table.querySelectorAll("tr"));
    if (rows.length === 0) return "";

    // Helper to convert cell HTML to inline markdown (no tables expected inside)
    const cellToMd = (el) => {
      const html = el.innerHTML || "";
      return turndown.turndown(html).replace(/\n+/g, " ").trim();
    };

    // Find header row (first row that has any <th>)
    let headerCells = null;
    let dataStartIndex = 0;
    for (let i = 0; i < rows.length; i++) {
      const ths = rows[i].querySelectorAll("th");
      if (ths && ths.length > 0) {
        headerCells = Array.from(ths).map(cellToMd);
        dataStartIndex = i + 1;
        break;
      }
    }

    // If no explicit header row, synthesize empty headers based on first row <td>
    if (!headerCells) {
      const tds = rows[0].querySelectorAll("td");
      const colCount = Math.max(1, tds.length);
      headerCells = Array.from({ length: colCount }).map(() => "");
      dataStartIndex = 0;
    }

    // Build markdown lines
    const lines = [];
    if (caption) {
      lines.push(`### ${caption}`);
      lines.push("");
    }

    const headerLine = "| " + headerCells.join(" | ") + " |";
    const separatorLine =
      "| " + headerCells.map(() => "---").join(" | ") + " |";
    lines.push(headerLine);
    lines.push(separatorLine);

    for (let i = dataStartIndex; i < rows.length; i++) {
      const row = rows[i];
      const cells = row.querySelectorAll("td, th");
      if (!cells || cells.length === 0) continue;
      const mdCells = Array.from(cells).map(cellToMd);
      lines.push("| " + mdCells.join(" | ") + " |");
    }

    return "\n" + lines.join("\n") + "\n";
  },
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

// Simplify output: drop images, metadata and certain tables but keep content tables
function preprocessWikipediaHtml(html) {
  return (
    html
      // Remove sidebars/navboxes (common classes in Wikipedia HTML)
      .replace(
        /<table[^>]*class=\"[^"]*(sidebar|navbox|vertical-navbox|metadata)[^\"]*\"[\s\S]*?<\/table>/gi,
        "",
      )
      // Remove reference superscripts
      .replace(/<sup[^>]*class=\"reference\"[\s\S]*?<\/sup>/gi, "")
      // Remove images
      .replace(/<img[\s\S]*?>/gi, "[image]")
      // Remove styles/scripts
      .replace(/<style[\s\S]*?<\/style>/gi, "")
      .replace(/<script[\s\S]*?<\/script>/gi, "")
  );
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
