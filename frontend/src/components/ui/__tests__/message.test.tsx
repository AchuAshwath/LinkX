import { render, screen } from "@testing-library/react"
import { describe, expect, it } from "vitest"
import { Bubble, BubbleContent, BubbleGroup } from "../bubble"
import {
  Message,
  MessageAvatar,
  MessageContent,
  MessageFooter,
  MessageGroup,
  MessageHeader,
} from "../message"

describe("Message primitive", () => {
  it("renders with start alignment by default", () => {
    render(
      <Message data-testid="msg">
        <MessageContent>Hello world</MessageContent>
      </Message>,
    )
    const el = screen.getByTestId("msg")
    expect(el).toHaveAttribute("data-align", "start")
    expect(el).toHaveAttribute("data-slot", "message")
    expect(screen.getByText("Hello world")).toBeInTheDocument()
  })

  it("renders with end alignment for user messages", () => {
    render(
      <Message align="end" data-testid="user-msg">
        <MessageContent>User message</MessageContent>
      </Message>,
    )
    const el = screen.getByTestId("user-msg")
    expect(el).toHaveAttribute("data-align", "end")
    expect(el.className).toContain("data-[align=end]:flex-row-reverse")
  })

  it("renders header, footer, avatar, and group sub-components", () => {
    render(
      <MessageGroup data-testid="group">
        <Message>
          <MessageAvatar data-testid="avatar">AI</MessageAvatar>
          <MessageContent>
            <MessageHeader data-testid="header">Assistant</MessageHeader>
            <p>Message body</p>
            <MessageFooter data-testid="footer">Just now</MessageFooter>
          </MessageContent>
        </Message>
      </MessageGroup>,
    )
    expect(screen.getByTestId("group")).toHaveAttribute(
      "data-slot",
      "message-group",
    )
    expect(screen.getByTestId("avatar")).toHaveAttribute(
      "data-slot",
      "message-avatar",
    )
    expect(screen.getByTestId("header")).toHaveTextContent("Assistant")
    expect(screen.getByTestId("footer")).toHaveTextContent("Just now")
  })
})

describe("Bubble primitive", () => {
  it("renders with default variant", () => {
    render(
      <Bubble data-testid="bubble">
        <BubbleContent>Bubble text</BubbleContent>
      </Bubble>,
    )
    const el = screen.getByTestId("bubble")
    expect(el).toHaveAttribute("data-variant", "default")
    expect(screen.getByText("Bubble text")).toHaveAttribute(
      "data-slot",
      "bubble-content",
    )
  })

  it("renders with muted variant for user messages", () => {
    render(
      <Bubble variant="muted" align="end" data-testid="muted-bubble">
        <BubbleContent>Muted text</BubbleContent>
      </Bubble>,
    )
    const el = screen.getByTestId("muted-bubble")
    expect(el).toHaveAttribute("data-variant", "muted")
    expect(el).toHaveAttribute("data-align", "end")
  })

  it("renders inside BubbleGroup", () => {
    render(
      <BubbleGroup data-testid="bubble-group">
        <Bubble>
          <BubbleContent>Part 1</BubbleContent>
        </Bubble>
        <Bubble>
          <BubbleContent>Part 2</BubbleContent>
        </Bubble>
      </BubbleGroup>,
    )
    expect(screen.getByTestId("bubble-group")).toHaveAttribute(
      "data-slot",
      "bubble-group",
    )
    expect(screen.getByText("Part 1")).toBeInTheDocument()
    expect(screen.getByText("Part 2")).toBeInTheDocument()
  })
})
