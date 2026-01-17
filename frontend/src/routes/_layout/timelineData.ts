import { type PostData } from "@/components/Post"

export const timelinePosts: PostData[] = [
  {
    id: "1",
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
  },
  {
    id: "2",
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
  },
  {
    id: "3",
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
  },
  {
    id: "4",
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
  },
  {
    id: "5",
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
  },
  {
    id: "6",
    author: {
      name: "Design Studio",
      username: "designstudio",
      avatarUrl: "https://bundui-images.netlify.app/avatars/05.png",
    },
    content:
      "New design system released! 🎨 We've been working on this for months and finally ready to share. Clean, accessible, and beautiful. Check out the full documentation on our website. #DesignSystem #UIUX #Accessibility",
    imageUrl: "https://bundui-images.netlify.app/blog/04.jpg",
    createdAt: new Date(Date.now() - 2 * 24 * 60 * 60 * 1000), // 2 days ago
    likes: 312,
    reposts: 94,
    comments: 127,
  },
  {
    id: "7",
    author: {
      name: "Code Mentor",
      username: "codementor",
      avatarUrl: "https://bundui-images.netlify.app/avatars/06.png",
    },
    content:
      "Quick tip: Always use semantic HTML! It's not just about accessibility - search engines love it too. Your future self will thank you when debugging. 💡 #WebDev #HTML #Accessibility #BestPractices",
    createdAt: new Date(Date.now() - 3 * 24 * 60 * 60 * 1000), // 3 days ago
    likes: 178,
    reposts: 45,
    comments: 56,
  },
  {
    id: "8",
    author: {
      name: "Travel Blogger",
      username: "travelblogger",
      avatarUrl: "https://bundui-images.netlify.app/avatars/07.png",
    },
    content:
      "Just arrived in Tokyo! 🇯🇵 The city never sleeps and neither do I apparently. First stop: Shibuya crossing. This place is absolutely incredible! #Travel #Tokyo #Japan #Adventure",
    imageUrl: "https://bundui-images.netlify.app/blog/05.jpg",
    createdAt: new Date(Date.now() - 4 * 24 * 60 * 60 * 1000), // 4 days ago
    likes: 445,
    reposts: 123,
    comments: 198,
  },
]
