const { convertWikipediaToMarkdown } = require("../services/wikipedia");
const { convertYouTubeToMarkdown } = require("../services/youtube");

// Platform registry: platformId -> interface
// Each entry exposes: toMarkdown(slug: string) => Promise<string>
module.exports = {
  wikipedia: {
    toMarkdown: convertWikipediaToMarkdown,
  },
  youtube: {
    toMarkdown: convertYouTubeToMarkdown,
  },
};
