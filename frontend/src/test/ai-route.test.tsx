import { fireEvent, render, screen } from "@testing-library/react"
import { describe, expect, it } from "vitest"
import { Route } from "@/routes/_layout/ai"

describe("AIPage component", () => {
  it("renders AIPage with Rich Markdown showcase thread", () => {
    const Component = Route.options.component as React.ComponentType
    render(<Component />)

    expect(screen.getAllByText(/New Chat/i).length).toBeGreaterThanOrEqual(1)
    expect(
      screen.getAllByText("Rich Markdown & Typography").length,
    ).toBeGreaterThanOrEqual(1)
    expect(
      screen.getByText(/Launching Next-Gen Social Growth with LinkX/),
    ).toBeInTheDocument()
    expect(screen.getByPlaceholderText("Ask anything")).toBeInTheDocument()
  })

  it("can switch to Web Search & Citations thread and expand tool call", () => {
    const Component = Route.options.component as React.ComponentType
    render(<Component />)

    const searchThread = screen.getByText("Web Search & Citations")
    fireEvent.click(searchThread)

    expect(
      screen.getByText(/Research Summary: AI Agent Frameworks/),
    ).toBeInTheDocument()

    // Abstract collapsible Web Search button
    const webSearchBtn = screen.getByRole("button", {
      name: /toggle web search details/i,
    })
    expect(webSearchBtn).toBeInTheDocument()

    // Click to expand tool call details
    fireEvent.click(webSearchBtn)
    expect(screen.getByText(/Ran search/i)).toBeInTheDocument()
  })

  it("can switch to Interactive Questionnaire thread and complete slideshow", () => {
    const Component = Route.options.component as React.ComponentType
    render(<Component />)

    const questionThread = screen.getByText("Interactive Questionnaire (HITL)")
    fireEvent.click(questionThread)

    // Slide 1
    expect(
      screen.getByText(
        "What is your primary growth objective for the next 30 days?",
      ),
    ).toBeInTheDocument()

    const choice1 = screen.getByText("Brand Awareness & Founder Audience")
    fireEvent.click(choice1)

    const nextBtn = screen.getByRole("button", { name: /next/i })
    fireEvent.click(nextBtn)

    // Slide 2
    expect(
      screen.getByText(
        "Which content style resonates best with your audience?",
      ),
    ).toBeInTheDocument()

    const choice2 = screen.getByText("Deep Technical Teardowns & Architecture")
    fireEvent.click(choice2)

    const answerBtn = screen.getByRole("button", { name: /answer/i })
    fireEvent.click(answerBtn)

    expect(screen.getByText(/Here are my preferences/)).toBeInTheDocument()
  })

  it("can switch to Conversational Post Refinement thread", () => {
    const Component = Route.options.component as React.ComponentType
    render(<Component />)

    const refineThread = screen.getByText("Conversational Post Refinement")
    fireEvent.click(refineThread)

    expect(
      screen.getByText(/Most developers write code to execute/),
    ).toBeInTheDocument()
  })

  it("can create a new chat", () => {
    const Component = Route.options.component as React.ComponentType
    render(<Component />)

    const newChatBtns = screen.getAllByRole("button", { name: /new chat/i })
    fireEvent.click(newChatBtns[0])

    expect(
      screen.getByText("What would you like to create?"),
    ).toBeInTheDocument()
  })

  it("can rename a thread via kebab menu", () => {
    const Component = Route.options.component as React.ComponentType
    render(<Component />)

    const kebabButtons = screen.getAllByRole("button", {
      name: /thread options/i,
    })
    fireEvent.click(kebabButtons[0])

    const renameBtn = screen.getByRole("menuitem", { name: /rename/i })
    fireEvent.click(renameBtn)

    const editInput = screen.getByDisplayValue("Rich Markdown & Typography")
    fireEvent.change(editInput, { target: { value: "Renamed Thread Title" } })
    fireEvent.blur(editInput)

    expect(
      screen.getAllByText("Renamed Thread Title").length,
    ).toBeGreaterThanOrEqual(1)
  })

  it("shows Archive button on recent threads and Delete button on archived threads", () => {
    const Component = Route.options.component as React.ComponentType
    render(<Component />)

    const archiveButtons = screen.getAllByRole("button", {
      name: /archive thread/i,
    })
    expect(archiveButtons.length).toBeGreaterThanOrEqual(1)

    const deleteButtons = screen.getAllByRole("button", {
      name: /delete thread/i,
    })
    expect(deleteButtons.length).toBeGreaterThanOrEqual(1)

    // Archive the first recent thread
    fireEvent.click(archiveButtons[0])

    // Open kebab menu on an archived thread
    const kebabButtons = screen.getAllByRole("button", {
      name: /thread options/i,
    })
    fireEvent.click(kebabButtons[kebabButtons.length - 1])

    expect(
      screen.getByRole("menuitem", { name: /unarchive/i }),
    ).toBeInTheDocument()
  })
})
