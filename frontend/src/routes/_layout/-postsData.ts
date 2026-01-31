import { type PostedData } from "@/components/Post/Posted"
import { type ScheduledPostData } from "@/components/Post/ScheduledPost"
import { type DraftPostData } from "@/components/Post/DraftPost"
import { formatRelativeTime, formatRelativeTimeWithFuture } from "@/utils"

// Mock data for draft posts
const draft1CreatedAt = new Date(Date.now() - 1 * 24 * 60 * 60 * 1000) // 1 day ago
const draft2CreatedAt = new Date(Date.now() - 3 * 24 * 60 * 60 * 1000) // 3 days ago
const draft3CreatedAt = new Date(Date.now() - 5 * 24 * 60 * 60 * 1000) // 5 days ago

export const draftPosts: DraftPostData[] = [
  {
    id: "draft-1",
    author: {
      name: "Jane Doe",
      username: "janedoe",
      avatarUrl: "https://bundui-images.netlify.app/avatars/01.png",
    },
    content:
      "Working on a new blog post about modern web development practices. Stay tuned! 🚀 #WebDev #Blogging",
    createdAt: draft1CreatedAt,
    relativeDate: formatRelativeTime(draft1CreatedAt),
    platform: "all",
  },
  {
    id: "draft-2",
    author: {
      name: "Jane Doe",
      username: "janedoe",
      avatarUrl: "https://bundui-images.netlify.app/avatars/01.png",
    },
    content:
      "Just discovered an amazing new tool for developers. Need to write more about it...",
    imageUrl: "https://bundui-images.netlify.app/blog/01.jpg",
    createdAt: draft2CreatedAt,
    relativeDate: formatRelativeTime(draft2CreatedAt),
    platform: "linkedin",
  },
  {
    id: "draft-3",
    author: {
      name: "Jane Doe",
      username: "janedoe",
      avatarUrl: "https://bundui-images.netlify.app/avatars/01.png",
    },
    content:
      "Quick thoughts on the latest tech trends. What do you think about the future of AI in development?",
    createdAt: draft3CreatedAt,
    relativeDate: formatRelativeTime(draft3CreatedAt),
    platform: "x",
  },
]

// Mock data for scheduled posts
// Scheduled posts: createdAt is when drafted, scheduledAt is future publish date, no engagement metrics
// Logic: createdAt < scheduledAt (drafted before scheduled to publish)
const scheduled1CreatedAt = new Date(Date.now() - 3 * 24 * 60 * 60 * 1000) // Drafted 3 days ago
const scheduled1ScheduledAt = new Date(Date.now() + 1 * 24 * 60 * 60 * 1000) // Scheduled to publish tomorrow
const scheduled2CreatedAt = new Date(Date.now() - 2 * 24 * 60 * 60 * 1000) // Drafted 2 days ago
const scheduled2ScheduledAt = new Date(Date.now() + 2 * 24 * 60 * 60 * 1000) // Scheduled to publish in 2 days
const scheduled3CreatedAt = new Date(Date.now() - 1 * 24 * 60 * 60 * 1000) // Drafted 1 day ago
const scheduled3ScheduledAt = new Date(Date.now() + 6 * 24 * 60 * 60 * 1000) // Scheduled to publish in 6 days

export const scheduledPosts: ScheduledPostData[] = [
  {
    id: "scheduled-1",
    author: {
      name: "Jane Doe",
      username: "janedoe",
      avatarUrl: "https://bundui-images.netlify.app/avatars/01.png",
    },
    content:
      "Excited to announce our new product launch next week! 🚀 Stay tuned for more updates. #ProductLaunch #Innovation",
    createdAt: scheduled1CreatedAt,
    scheduledAt: scheduled1ScheduledAt,
    relativeDate: formatRelativeTimeWithFuture(scheduled1ScheduledAt),
    platform: "all",
  },
  {
    id: "scheduled-2",
    author: {
      name: "Jane Doe",
      username: "janedoe",
      avatarUrl: "https://bundui-images.netlify.app/avatars/01.png",
    },
    content:
      "Just finished reading an amazing book on design systems. Can't wait to share my thoughts! 📚 #DesignSystems #Reading",
    imageUrl: "https://bundui-images.netlify.app/blog/02.jpg",
    createdAt: scheduled2CreatedAt,
    scheduledAt: scheduled2ScheduledAt,
    relativeDate: formatRelativeTimeWithFuture(scheduled2ScheduledAt),
    platform: "linkedin",
  },
  {
    id: "scheduled-3",
    author: {
      name: "Jane Doe",
      username: "janedoe",
      avatarUrl: "https://bundui-images.netlify.app/avatars/01.png",
    },
    content:
      "Weekly tech roundup coming soon! This week's highlights include AI breakthroughs, new framework releases, and developer tools. #TechNews #WeeklyRoundup",
    createdAt: scheduled3CreatedAt,
    scheduledAt: scheduled3ScheduledAt,
    relativeDate: formatRelativeTimeWithFuture(scheduled3ScheduledAt),
    platform: "x",
  },
]

// Mock data for posted/published posts
// Posted posts: createdAt is when published (past date), has engagement metrics, no scheduledAt
// Logic: All dates are in the past, ordered from most recent to oldest
const posted1CreatedAt = new Date(Date.now() - 2 * 60 * 60 * 1000) // Published 2 hours ago
const posted2CreatedAt = new Date(Date.now() - 12 * 60 * 60 * 1000) // Published 12 hours ago
const posted3CreatedAt = new Date(Date.now() - 1 * 24 * 60 * 60 * 1000) // Published 1 day ago
const posted4CreatedAt = new Date(Date.now() - 3 * 24 * 60 * 60 * 1000) // Published 3 days ago

export const postedPosts: PostedData[] = [
  {
    id: "posted-1",
    author: {
      name: "Jane Doe",
      username: "janedoe",
      avatarUrl: "https://bundui-images.netlify.app/avatars/01.png",
    },
    content:
      "Just launched my new portfolio website! 🚀 Check out these 15 standout examples of creative, sleek, and interactive portfolio designs that inspired me. Which one's your favorite? #WebDesign #PortfolioInspiration",
    createdAt: posted1CreatedAt,
    relativeDate: formatRelativeTime(posted1CreatedAt),
    likes: 62,
    reposts: 23,
    comments: 45,
    platform: "all",
  },
  {
    id: "posted-2",
    author: {
      name: "Jane Doe",
      username: "janedoe",
      avatarUrl: "https://bundui-images.netlify.app/avatars/01.png",
    },
    content:
      "Dreaming of distant worlds... 🪐 This AI-generated image captures the essence of exploration. What stories does it spark in your imagination?",
    imageUrl: "https://bundui-images.netlify.app/blog/02.jpg",
    createdAt: posted2CreatedAt,
    relativeDate: formatRelativeTime(posted2CreatedAt),
    likes: 128,
    reposts: 34,
    comments: 67,
    platform: "linkedin",
  },
  {
    id: "posted-3",
    author: {
      name: "Jane Doe",
      username: "janedoe",
      avatarUrl: "https://bundui-images.netlify.app/avatars/01.png",
    },
    content:
      "Quick tip: Always use semantic HTML! It's not just about accessibility - search engines love it too. Your future self will thank you when debugging. 💡 #WebDev #HTML #Accessibility #BestPractices",
    createdAt: posted3CreatedAt,
    relativeDate: formatRelativeTime(posted3CreatedAt),
    likes: 178,
    reposts: 45,
    comments: 56,
    platform: "x",
  },
  {
    id: "posted-4",
    author: {
      name: "Jane Doe",
      username: "janedoe",
      avatarUrl: "https://bundui-images.netlify.app/avatars/01.png",
    },
    content:
      "Beautiful sunset from my evening walk 🌅 Sometimes the best moments are the simple ones. Hope everyone is having a peaceful evening!",
    imageUrl: "https://bundui-images.netlify.app/blog/03.jpg",
    createdAt: posted4CreatedAt,
    relativeDate: formatRelativeTime(posted4CreatedAt),
    likes: 156,
    reposts: 28,
    comments: 41,
    platform: "all",
  },
]
