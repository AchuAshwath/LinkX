import { describe, expect, it } from "vitest"
import type { ChatThreadPublic } from "@/client"
import {
  findScrapeThread,
  isScrapePrompt,
  isScrapeThread,
  SCRAPE_PROMPT,
} from "../scrapeThread"

describe("scrapeThread utilities", () => {
  describe("isScrapePrompt", () => {
    it("returns true for exact SCRAPE_PROMPT", () => {
      expect(isScrapePrompt(SCRAPE_PROMPT)).toBe(true)
      expect(isScrapePrompt("Refresh trending topics from X")).toBe(true)
      expect(isScrapePrompt("refresh trending topics from x")).toBe(true)
    })

    it("returns true for related trend scraping variations", () => {
      expect(isScrapePrompt("Extract Live Trends")).toBe(true)
      expect(isScrapePrompt("Refresh Trending Topics")).toBe(true)
      expect(isScrapePrompt("Scrape trends on X")).toBe(true)
    })

    it("returns false for non-scrape prompts", () => {
      expect(isScrapePrompt("Write a blog post about AI")).toBe(false)
      expect(isScrapePrompt("What is the capital of France?")).toBe(false)
      expect(isScrapePrompt(null)).toBe(false)
      expect(isScrapePrompt(undefined)).toBe(false)
      expect(isScrapePrompt("")).toBe(false)
    })
  })

  describe("isScrapeThread", () => {
    it.each([
      {
        scenario: "identifies thread by origin 'trending'",
        thread: {
          id: "t-1",
          title: "Random Custom Title",
          origin: "trending",
          owner_id: "user-1",
          is_archived: false,
        },
        expected: true,
      },
      {
        scenario: "identifies thread by topic_keyword 'trending_scrape'",
        thread: {
          id: "t-2",
          title: "Custom Title",
          topic_keyword: "trending_scrape",
          owner_id: "user-1",
          is_archived: false,
        },
        expected: true,
      },
      {
        scenario: "identifies thread by title matching scrape patterns",
        thread: {
          id: "t-3",
          title: "Refresh trending topics from X",
          owner_id: "user-1",
          is_archived: false,
        },
        expected: true,
      },
      {
        scenario:
          "returns false for archived threads even if matching title/origin",
        thread: {
          id: "t-archived",
          title: "Trending Topics",
          origin: "trending",
          owner_id: "user-1",
          is_archived: true,
        },
        expected: false,
      },
      {
        scenario: "returns false for unrelated threads",
        thread: {
          id: "t-other",
          title: "Next.js Roadmap",
          origin: "composer",
          owner_id: "user-1",
          is_archived: false,
        },
        expected: false,
      },
    ])("$scenario", ({ thread, expected }) => {
      expect(isScrapeThread(thread as ChatThreadPublic)).toBe(expected)
    })
  })

  describe("findScrapeThread", () => {
    it("returns the first matching unarchived scrape thread from the list", () => {
      const threads: ChatThreadPublic[] = [
        {
          id: "t-other",
          title: "System Design Pattern",
          origin: "composer",
          owner_id: "user-1",
          is_archived: false,
        },
        {
          id: "t-scrape-1",
          title: "Refresh Trending Topics",
          origin: "composer",
          owner_id: "user-1",
          is_archived: false,
        },
        {
          id: "t-scrape-2",
          title: "Trending Topics",
          origin: "trending",
          owner_id: "user-1",
          is_archived: false,
        },
      ]

      const found = findScrapeThread(threads)
      expect(found).toBeDefined()
      expect(found?.id).toBe("t-scrape-1")
    })

    it("returns undefined if no scrape thread exists", () => {
      const threads: ChatThreadPublic[] = [
        {
          id: "t-1",
          title: "Hello World",
          origin: "composer",
          owner_id: "user-1",
          is_archived: false,
        },
      ]

      expect(findScrapeThread(threads)).toBeUndefined()
    })
  })
})
