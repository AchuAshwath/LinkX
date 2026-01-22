import { type PostedData } from "@/components/Post/Posted"
import { type ScheduledPostData } from "@/components/Post/ScheduledPost"
import { type DraftPostData } from "@/components/Post/DraftPost"

// Union type for timeline posts
export type TimelinePost = 
  | (PostedData & { type: "posted" })
  | (ScheduledPostData & { type: "scheduled" })
  | (DraftPostData & { type: "draft" })

// Mixed timeline posts - showing drafts, scheduled, and posted posts
export const timelinePosts: TimelinePost[] = [
  // Posted posts
  {
    type: "posted",
    id: "posted-1",
    author: {
      name: "Moyo Shiro",
      username: "moyo",
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
  // Scheduled post
  {
    type: "scheduled",
    id: "scheduled-1",
    author: {
      name: "Jane Doe",
      username: "janedoe",
      avatarUrl: "https://bundui-images.netlify.app/avatars/01.png",
    },
    content:
      "Excited to announce our new product launch next week! 🚀 Stay tuned for more updates. #ProductLaunch #Innovation",
    createdAt: new Date(Date.now() - 2 * 24 * 60 * 60 * 1000), // Drafted 2 days ago
    scheduledAt: new Date(Date.now() + 1 * 24 * 60 * 60 * 1000), // Scheduled to publish tomorrow
    platform: "all",
  },
  // Posted post
  {
    type: "posted",
    id: "posted-2",
    author: {
      name: "Sophia",
      username: "sophia",
      avatarUrl: "https://bundui-images.netlify.app/avatars/10.png",
    },
    content:
      "Dreaming of distant worlds... 🪐 This AI-generated image captures the essence of exploration. What stories does it spark in your imagination?",
    imageUrl: "https://bundui-images.netlify.app/blog/02.jpg",
    createdAt: new Date(Date.now() - 5 * 60 * 60 * 1000), // 5 hours ago
    likes: 128,
    reposts: 34,
    comments: 67,
    platform: "linkedin",
  },
  // Draft post
  {
    type: "draft",
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
  // Posted post
  {
    type: "posted",
    id: "posted-3",
    author: {
      name: "Alex Chen",
      username: "alexchen",
      avatarUrl: "https://bundui-images.netlify.app/avatars/02.png",
    },
    content:
      "Just finished reading 'The Pragmatic Programmer' - highly recommend it to anyone in tech! The chapter on DRY principles really resonated with me. What's your favorite programming book? 📚 #TechBooks #SoftwareEngineering",
    createdAt: new Date(Date.now() - 8 * 60 * 60 * 1000), // 8 hours ago
    likes: 89,
    reposts: 12,
    comments: 23,
    platform: "x",
  },
  // Scheduled post
  {
    type: "scheduled",
    id: "scheduled-2",
    author: {
      name: "Jane Doe",
      username: "janedoe",
      avatarUrl: "https://bundui-images.netlify.app/avatars/01.png",
    },
    content:
      "Just finished reading an amazing book on design systems. Can't wait to share my thoughts! 📚 #DesignSystems #Reading",
    imageUrl: "https://bundui-images.netlify.app/blog/02.jpg",
    createdAt: new Date(Date.now() - 5 * 24 * 60 * 60 * 1000), // Drafted 5 days ago
    scheduledAt: new Date(Date.now() + 3 * 24 * 60 * 60 * 1000), // Scheduled to publish in 3 days
    platform: "linkedin",
  },
  // Posted post
  {
    type: "posted",
    id: "posted-4",
    author: {
      name: "Sarah Johnson",
      username: "sarahj",
      avatarUrl: "https://bundui-images.netlify.app/avatars/03.png",
    },
    content:
      "Beautiful sunset from my evening walk 🌅 Sometimes the best moments are the simple ones. Hope everyone is having a peaceful evening!",
    imageUrl: "https://bundui-images.netlify.app/blog/03.jpg",
    createdAt: new Date(Date.now() - 12 * 60 * 60 * 1000), // 12 hours ago
    likes: 156,
    reposts: 28,
    comments: 41,
    platform: "all",
  },
  // Draft post
  {
    type: "draft",
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
  // Posted post
  {
    type: "posted",
    id: "posted-5",
    author: {
      name: "Tech Startup",
      username: "techstartup",
      avatarUrl: "https://bundui-images.netlify.app/avatars/04.png",
    },
    content:
      "We're hiring! 🎉 Looking for talented frontend developers who are passionate about React and TypeScript. Remote-friendly, competitive salary, and amazing team culture. DM for details! #Hiring #TechJobs #React #TypeScript",
    createdAt: new Date(Date.now() - 1 * 24 * 60 * 60 * 1000), // 1 day ago
    likes: 234,
    reposts: 67,
    comments: 89,
    platform: "all",
  },
]
