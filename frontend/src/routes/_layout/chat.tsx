import { createFileRoute } from "@tanstack/react-router"
import { Bot, Send, Sparkles, User } from "lucide-react"
import * as React from "react"
import { Avatar, AvatarFallback } from "@/components/ui/avatar"
import { Button } from "@/components/ui/button"
import { Card, CardContent } from "@/components/ui/card"
import { Textarea } from "@/components/ui/textarea"
import { formatRelativeTime } from "@/utils"
import { type ChatConversation, mockChatConversations } from "./-aiChatData"

export const Route = createFileRoute("/_layout/chat")({
  component: ChatPage,
  head: () => ({
    meta: [
      {
        title: "Chat - LinkX",
      },
    ],
  }),
})

function ChatPage() {
  const [selectedConversation, setSelectedConversation] =
    React.useState<ChatConversation | null>(mockChatConversations[0] || null)
  const [input, setInput] = React.useState("")
  const messagesEndRef = React.useRef<HTMLDivElement>(null)

  const scrollToBottom = React.useCallback(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: "smooth" })
  }, [])

  React.useEffect(() => {
    scrollToBottom()
  }, [scrollToBottom])

  const handleSend = React.useCallback(() => {
    if (!input.trim()) return

    setInput("")
  }, [input])

  const handleKeyDown = React.useCallback(
    (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
      if (e.key === "Enter" && !e.shiftKey) {
        e.preventDefault()
        handleSend()
      }
    },
    [handleSend],
  )

  return (
    <div className="mx-auto flex w-full max-w-7xl min-h-[calc(100vh-3.5rem)]">
      {/* Main Chat Area */}
      <div className="border-border min-w-0 flex-1 border-r md:max-w-2xl flex flex-col">
        {/* Header */}
        <div className="sticky top-0 z-10 border-b bg-background/80 backdrop-blur-sm p-4">
          <div className="flex items-center gap-2">
            <Sparkles className="h-5 w-5" />
            <h1 className="text-xl font-semibold">Chat</h1>
          </div>
        </div>

        {/* Messages Area - page scrolls */}
        <div className="flex-1 overflow-y-auto p-4 space-y-4">
          {selectedConversation ? (
            <>
              {selectedConversation.messages.map((message, index) => (
                <div
                  key={index}
                  className={`flex gap-3 ${
                    message.role === "user" ? "justify-end" : "justify-start"
                  }`}
                >
                  {message.role === "assistant" && (
                    <Avatar className="h-8 w-8 shrink-0">
                      <AvatarFallback className="bg-primary text-primary-foreground">
                        <Bot className="h-4 w-4" />
                      </AvatarFallback>
                    </Avatar>
                  )}
                  <div
                    className={`max-w-[80%] rounded-lg px-4 py-2 ${
                      message.role === "user"
                        ? "bg-primary text-primary-foreground"
                        : "bg-muted"
                    }`}
                  >
                    <p className="text-sm whitespace-pre-wrap">
                      {message.content}
                    </p>
                    <p className="text-xs mt-1 opacity-70">
                      {formatRelativeTime(message.timestamp)}
                    </p>
                  </div>
                  {message.role === "user" && (
                    <Avatar className="h-8 w-8 shrink-0">
                      <AvatarFallback className="bg-secondary">
                        <User className="h-4 w-4" />
                      </AvatarFallback>
                    </Avatar>
                  )}
                </div>
              ))}
              <div ref={messagesEndRef} />
            </>
          ) : (
            <div className="flex flex-col items-center justify-center h-full text-center py-16 px-4">
              <div className="rounded-full bg-muted/50 p-6 mb-4">
                <Sparkles className="h-10 w-10 text-muted-foreground" />
              </div>
              <h3 className="text-xl font-semibold mb-1">
                Start a conversation
              </h3>
              <p className="text-muted-foreground text-sm max-w-sm">
                Select a conversation from the sidebar or start a new one to
                begin chatting with the AI assistant.
              </p>
            </div>
          )}
        </div>

        {/* Input Area */}
        <div className="border-t p-4 bg-background">
          <div className="flex gap-2">
            <Textarea
              value={input}
              onChange={(e) => setInput(e.target.value)}
              onKeyDown={handleKeyDown}
              placeholder="Type your message..."
              className="min-h-[60px] resize-none"
            />
            <Button
              onClick={handleSend}
              disabled={!input.trim()}
              size="icon"
              className="shrink-0 h-[60px] w-[60px]"
            >
              <Send className="h-5 w-5" />
            </Button>
          </div>
        </div>
      </div>

      {/* Right Sidebar - History Conversations */}
      <div className="hidden w-80 md:block">
        <div className="sticky top-0 self-start p-4 space-y-4">
          <div>
            <h2 className="text-lg font-semibold mb-4">Conversations</h2>
            <div className="space-y-2">
              {mockChatConversations.map((conversation) => (
                <Card
                  key={conversation.id}
                  className={`cursor-pointer transition-colors hover:bg-accent ${
                    selectedConversation?.id === conversation.id
                      ? "bg-accent"
                      : ""
                  }`}
                  onClick={() => setSelectedConversation(conversation)}
                >
                  <CardContent className="p-4">
                    <div className="space-y-1">
                      <h3 className="font-semibold text-sm line-clamp-1">
                        {conversation.title}
                      </h3>
                      <p className="text-xs text-muted-foreground line-clamp-2">
                        {conversation.preview}
                      </p>
                      <p className="text-xs text-muted-foreground mt-2">
                        {formatRelativeTime(conversation.createdAt)}
                      </p>
                    </div>
                  </CardContent>
                </Card>
              ))}
            </div>
          </div>
        </div>
      </div>
    </div>
  )
}

export default ChatPage
