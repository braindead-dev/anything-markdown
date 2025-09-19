const express = require('express');
const router = express.Router();

// Homepage
router.get('/', (req, res) => {
  res.send(`welcome to anything-markdown! a tool for converting any platform into markdown<br><br>view available platforms <a href="/sources">here</a><br><br>simply visit /[platform]/[slug] to get the markdown version of any page!`);
});

// Available sources/platforms
router.get('/sources', (req, res) => {
  res.json({
    platforms: ["wikipedia"]
  });
});

module.exports = router;
