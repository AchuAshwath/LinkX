import { fireEvent, render, screen } from "@testing-library/react"
import { describe, expect, it, vi } from "vitest"
import { QuestionCard } from "../QuestionCard"
import type { AskUserToolPart } from "../types"

describe("QuestionCard HITL component", () => {
  it("renders shimmer/loading when question is still preparing", () => {
    const part: AskUserToolPart = {
      type: "tool-ask_user",
      toolCallId: "call_123",
      state: "input-streaming",
      input: { questions: [] },
    }

    render(<QuestionCard part={part} onAnswer={vi.fn()} />)
    expect(screen.getByText("Preparing a question…")).toBeInTheDocument()
  })

  it("renders question with multiple choices when input is available", () => {
    const part: AskUserToolPart = {
      type: "tool-ask_user",
      toolCallId: "call_456",
      state: "input-available",
      input: {
        questions: [
          {
            question: "Which platform do you want to target?",
            choices: ["LinkedIn", "X (Twitter)", "Both Platforms"],
          },
        ],
      },
    }

    render(<QuestionCard part={part} onAnswer={vi.fn()} />)
    expect(
      screen.getByText("Which platform do you want to target?"),
    ).toBeInTheDocument()
    expect(screen.getByText("LinkedIn")).toBeInTheDocument()
    expect(screen.getByText("X (Twitter)")).toBeInTheDocument()
    expect(screen.getByText("Both Platforms")).toBeInTheDocument()
    expect(screen.getByRole("button", { name: "Answer" })).toBeInTheDocument()
  })

  it("submits the chosen answer to onAnswer callback", () => {
    const handleAnswer = vi.fn()
    const part: AskUserToolPart = {
      type: "tool-ask_user",
      toolCallId: "call_789",
      state: "input-available",
      input: {
        questions: [
          {
            question: "What tone of voice should we use?",
            choices: ["Professional", "Conversational", "Provocative/Hook"],
          },
        ],
      },
    }

    render(<QuestionCard part={part} onAnswer={handleAnswer} />)

    // Click on the "Conversational" choice
    const choice = screen.getByText("Conversational")
    fireEvent.click(choice)

    // Click Answer submit button
    const submitBtn = screen.getByRole("button", { name: "Answer" })
    fireEvent.click(submitBtn)

    expect(handleAnswer).toHaveBeenCalledWith("call_789", [
      {
        question: "What tone of voice should we use?",
        answer: "Conversational",
      },
    ])
  })
})
