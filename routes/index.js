const express = require("express");
const registry = require("../platforms");

const router = express.Router();

// Homepage
router.get("/", (req, res) => {
  const html = `
<!DOCTYPE html>
<html lang="en">
<head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <title>anymark</title>
    <meta name="description" content="turn any platform page into markdown!">
    <meta name="keywords" content="markdown, converter, platform, api, tool">
    <meta name="author" content="braindead-dev">
    
    <!-- Open Graph / Facebook -->
    <meta property="og:type" content="website">
    <meta property="og:title" content="anymark">
    <meta property="og:description" content="turn any platform page into markdown!">
    <meta property="og:site_name" content="anymark">
    
    <!-- Twitter -->
    <meta name="twitter:card" content="summary">
    <meta name="twitter:title" content="anymark">
    <meta name="twitter:description" content="turn any platform page into markdown!">
    
    <style>
        body {
            font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;
            max-width: 800px;
            margin: 0 auto;
            padding: 40px 20px;
            line-height: 1.6;
            color: #333;
        }
        h1 {
            color: #2c3e50;
            margin-bottom: 10px;
        }
        .subtitle {
            color: #7f8c8d;
            font-size: 1.2em;
            margin-bottom: 40px;
        }
        a {
            color: #3498db;
            text-decoration: none;
        }
        a:hover {
            text-decoration: underline;
        }
        .example {
            background: #f8f9fa;
            padding: 20px;
            border-radius: 8px;
            margin: 20px 0;
            border-left: 4px solid #3498db;
        }
        .footer {
            margin-top: 60px;
            text-align: center;
            color: #7f8c8d;
        }
    </style>
</head>
<body>
    <h1>anymark</h1>
    <p class="subtitle">turn any platform page into markdown!</p>
    
    <p>Welcome to anything-markdown! A tool for converting any platform into markdown.</p>
    
    <p>📋 View available platforms <a href="/platforms">here</a></p>
    
    <div class="example">
        <strong>How to use:</strong><br>
        Simply visit <code>/[platform]/[slug]</code> to get the markdown version of any page!<br><br>
        <strong>Example:</strong> <a href="/wikipedia/Tortoiseshell_cat" target="_blank">/wikipedia/Tortoiseshell_cat</a>
    </div>
    
    <div class="footer">
        made with ❤️ by <a href="https://henr.ee" target="_blank">henry</a>
        <br>
        contribute on <a href="https://github.com/braindead-dev/anything-markdown" target="_blank">github</a>!
    </div>
</body>
</html>`;
  res.send(html);
});

// Available platforms (from registry)
router.get("/platforms", (req, res) => {
  res.json({
    platforms: Object.keys(registry),
  });
});

// Generic platform route
router.get("/:platform/:slug", async (req, res) => {
  const { platform, slug } = req.params;
  const entry = registry[platform];
  if (!entry || typeof entry.toMarkdown !== "function") {
    return res.status(404).json({ error: "unknown_platform", platform });
  }
  try {
    const markdown = await entry.toMarkdown(slug);
    res.setHeader("Content-Type", "text/markdown; charset=utf-8");
    res.send(markdown);
  } catch (err) {
    const status = err.status || 500;
    res
      .status(status)
      .json({ error: "failed_to_convert", message: err.message });
  }
});

module.exports = router;
