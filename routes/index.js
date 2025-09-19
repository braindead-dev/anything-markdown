const express = require("express");
const registry = require("../platforms");

const router = express.Router();

// Homepage
router.get("/", (req, res) => {
  res.send(
    `welcome to anything-markdown! a tool for converting any platform into markdown<br><br>view available platforms <a href="/sources">here</a><br><br>simply visit /[platform]/[slug] to get the markdown version of any page! example: <a href="/wikipedia/Tokyo">/wikipedia/Tokyo</a><br><br>made with ❤️ by <a href="https://github.com/braindead-dev">braindead-dev</a>`,
  );
});

// Available sources/platforms (from registry)
router.get("/sources", (req, res) => {
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
