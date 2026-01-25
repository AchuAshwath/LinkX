export interface ChatMessage {
  role: "user" | "assistant"
  content: string
  timestamp: Date
}

export interface ChatConversation {
  id: string
  title: string
  preview: string
  createdAt: Date
  messages: ChatMessage[]
}

export const mockChatConversations: ChatConversation[] = [
  {
    id: "1",
    title: "Social Media Strategy",
    preview: "How can I improve my LinkedIn engagement?",
    createdAt: new Date(Date.now() - 2 * 60 * 60 * 1000), // 2 hours ago
    messages: [
      {
        role: "user",
        content: "How can I improve my LinkedIn engagement?",
        timestamp: new Date(Date.now() - 2 * 60 * 60 * 1000),
      },
      {
        role: "assistant",
        content: "To improve your LinkedIn engagement, focus on posting consistently, using relevant hashtags, engaging with your network's content, and sharing valuable insights. Post during peak hours (Tuesday-Thursday, 8-10 AM) and include visuals when possible.",
        timestamp: new Date(Date.now() - 2 * 60 * 60 * 1000 + 30 * 1000),
      },
      {
        role: "user",
        content: "What types of content perform best?",
        timestamp: new Date(Date.now() - 2 * 60 * 60 * 1000 + 60 * 1000),
      },
      {
        role: "assistant",
        content: "The best performing content on LinkedIn includes: industry insights and thought leadership, behind-the-scenes stories, educational content with actionable tips, personal career stories, and posts that ask questions to encourage engagement.",
        timestamp: new Date(Date.now() - 2 * 60 * 60 * 1000 + 90 * 1000),
      },
    ],
  },
  {
    id: "2",
    title: "Content Calendar Planning",
    preview: "Help me plan my content for next week",
    createdAt: new Date(Date.now() - 1 * 24 * 60 * 60 * 1000), // 1 day ago
    messages: [
      {
        role: "user",
        content: "Help me plan my content for next week",
        timestamp: new Date(Date.now() - 1 * 24 * 60 * 60 * 1000),
      },
      {
        role: "assistant",
        content: "I'd be happy to help you plan your content! Let's start by understanding your goals. What topics do you want to cover? Are you focusing on LinkedIn, X (Twitter), or both?",
        timestamp: new Date(Date.now() - 1 * 24 * 60 * 60 * 1000 + 30 * 1000),
      },
      {
        role: "user",
        content: "I want to focus on tech industry insights and product updates. Both platforms.",
        timestamp: new Date(Date.now() - 1 * 24 * 60 * 60 * 1000 + 60 * 1000),
      },
      {
        role: "assistant",
        content: "Great! Here's a suggested content calendar:\n\nMonday: Industry trend analysis\nTuesday: Product feature highlight\nWednesday: Behind-the-scenes development story\nThursday: User testimonial or case study\nFriday: Weekly recap or community engagement post\n\nWould you like me to generate specific post ideas for any of these?",
        timestamp: new Date(Date.now() - 1 * 24 * 60 * 60 * 1000 + 90 * 1000),
      },
    ],
  },
  {
    id: "3",
    title: "Hashtag Research",
    preview: "What hashtags should I use for tech posts?",
    createdAt: new Date(Date.now() - 3 * 24 * 60 * 60 * 1000), // 3 days ago
    messages: [
      {
        role: "user",
        content: "What hashtags should I use for tech posts?",
        timestamp: new Date(Date.now() - 3 * 24 * 60 * 60 * 1000),
      },
      {
        role: "assistant",
        content: "For tech posts, consider using a mix of broad and niche hashtags:\n\nBroad: #Technology #TechNews #Innovation #DigitalTransformation\nNiche: #WebDevelopment #AI #CloudComputing #DevOps #StartupLife\n\nPlatform-specific:\nLinkedIn: #TechLeadership #TechCommunity #SoftwareEngineering\nX: #TechTwitter #BuildInPublic #IndieHacker\n\nUse 3-5 hashtags on LinkedIn and 1-2 on X for best results.",
        timestamp: new Date(Date.now() - 3 * 24 * 60 * 60 * 1000 + 30 * 1000),
      },
    ],
  },
  {
    id: "4",
    title: "Post Scheduling Tips",
    preview: "When is the best time to post?",
    createdAt: new Date(Date.now() - 5 * 24 * 60 * 60 * 1000), // 5 days ago
    messages: [
      {
        role: "user",
        content: "When is the best time to post?",
        timestamp: new Date(Date.now() - 5 * 24 * 60 * 60 * 1000),
      },
      {
        role: "assistant",
        content: "Optimal posting times vary by platform:\n\nLinkedIn:\n- Best: Tuesday-Thursday, 8-10 AM or 12-1 PM\n- Avoid: Weekends and late evenings\n\nX (Twitter):\n- Best: Monday-Friday, 8-9 AM or 3-4 PM\n- Peak engagement: Wednesday and Thursday\n\nGeneral tips:\n- Test different times with your audience\n- Consider your target audience's timezone\n- Use analytics to find your personal best times\n- Consistency matters more than perfect timing",
        timestamp: new Date(Date.now() - 5 * 24 * 60 * 60 * 1000 + 30 * 1000),
      },
    ],
  },
]
