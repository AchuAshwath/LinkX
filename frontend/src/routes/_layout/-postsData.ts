import { type PostedData } from "@/components/Post/Posted"
import { type ScheduledPostData } from "@/components/Post/ScheduledPost"
import { type DraftPostData } from "@/components/Post/DraftPost"
import { type Platform } from "@/components/Common/PlatformSelector"

// Mock data for draft posts
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
    createdAt: new Date(Date.now() - 1 * 24 * 60 * 60 * 1000), // 1 day ago
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
    createdAt: new Date(Date.now() - 3 * 24 * 60 * 60 * 1000), // 3 days ago
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
    createdAt: new Date(Date.now() - 5 * 24 * 60 * 60 * 1000), // 5 days ago
    platform: "x",
  },
]

// Mock data for scheduled posts
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
    createdAt: new Date(Date.now() - 1 * 24 * 60 * 60 * 1000), // Created 1 day ago
    scheduledAt: new Date(Date.now() + 2 * 24 * 60 * 60 * 1000), // Scheduled for 2 days from now
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
    createdAt: new Date(Date.now() - 2 * 24 * 60 * 60 * 1000), // Created 2 days ago
    scheduledAt: new Date(Date.now() + 5 * 24 * 60 * 60 * 1000), // Scheduled for 5 days from now
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
    createdAt: new Date(Date.now() - 3 * 24 * 60 * 60 * 1000), // Created 3 days ago
    scheduledAt: new Date(Date.now() + 7 * 24 * 60 * 60 * 1000), // Scheduled for 7 days from now
    platform: "x",
  },
]

// Mock data for posted/published posts
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
    createdAt: new Date(Date.now() - 2 * 60 * 60 * 1000), // 2 hours ago
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
    createdAt: new Date(Date.now() - 1 * 24 * 60 * 60 * 1000), // 1 day ago
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
    createdAt: new Date(Date.now() - 3 * 24 * 60 * 60 * 1000), // 3 days ago
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
    createdAt: new Date(Date.now() - 5 * 24 * 60 * 60 * 1000), // 5 days ago
    likes: 156,
    reposts: 28,
    comments: 41,
    platform: "all",
  },
]
