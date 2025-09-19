const express = require('express');
const { convertWikipediaToMarkdown } = require('../services/wikipedia');

const router = express.Router();

router.get('/:slug', async (req, res) => {
  try {
    const slug = req.params.slug;
    const markdown = await convertWikipediaToMarkdown(slug);
    res.setHeader('Content-Type', 'text/markdown; charset=utf-8');
    res.send(markdown);
  } catch (err) {
    const status = err.status || 500;
    res.status(status).json({
      error: 'failed_to_convert',
      message: err.message,
    });
  }
});

module.exports = router;
