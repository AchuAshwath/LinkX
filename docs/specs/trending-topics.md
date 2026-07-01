# Spec: Trending Topics Pipeline

> **Status:** 🔲 Outline — needs discussion
> **Depends on:** [browser-engine](./browser-engine.md), [platform-adapters](./platform-adapters.md)
> **Depended on by:** [content-curation](./content-curation.md)

## Problem

To generate relevant daily posts, the AI needs to know what people are talking about today in the Brand's niche. We need a pipeline that scrapes trending topics, news, and relevant feed posts, then filters them for relevance.

## Questions to Discuss

### Data Sources
- [ ] What sources do we scrape? (X Explore/Trending, LinkedIn News, general web search, RSS feeds?)
- [ ] How frequently do we scrape? (Once daily, hourly?)
- [ ] Do we scrape globally or targeted per Brand? (e.g., search X for specific keywords related to the Brand)

### Processing & Storage
- [ ] How do we store this ephemeral data? (Postgres table with TTL, Redis, vector database for semantic search?)
- [ ] Do we use an LLM to categorize and summarize the raw scraped trends before storing them?
- [ ] How do we deduplicate similar trends across different platforms?

### Relevance Filtering
- [ ] How do we match a broad list of trending topics to a specific Brand's configured topics? (Embeddings/Vector similarity, or simple LLM classification?)

## Topics to Spec Out

1. Scraping schedule and browser adapter integration
2. `TrendingTopic` data model
3. Summarization and deduplication logic
4. Relevance matching strategy (Brand topics vs Global trends)
