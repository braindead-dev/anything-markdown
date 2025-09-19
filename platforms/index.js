const { convertWikipediaToMarkdown } = require("../services/wikipedia");

// Platform registry: platformId -> interface
// Each entry exposes: toMarkdown(slug: string) => Promise<string>
module.exports = {
  wikipedia: {
    toMarkdown: convertWikipediaToMarkdown,
  },
};
