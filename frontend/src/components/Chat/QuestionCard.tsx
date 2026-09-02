import { CheckIcon } from "lucide-react"
import * as React from "react"
import type { AskUserAnswer, AskUserToolPart } from "@/components/Chat/types"
import { Button } from "@/components/ui/button"
import { cn } from "@/lib/utils"

export interface QuestionCardProps {
  part: AskUserToolPart
  onAnswer: (toolCallId: string, answers: AskUserAnswer[]) => void
  className?: string
}

export function QuestionCard({ part, onAnswer, className }: QuestionCardProps) {
  const questions =
    part.state === "input-available" ? part.input.questions || [] : []

  const [currentStep, setCurrentStep] = React.useState(0)
  const [selectedChoices, setSelectedChoices] = React.useState<
    Record<number, string>
  >({})
  const [customInputs, setCustomInputs] = React.useState<
    Record<number, string>
  >({})

  if (questions.length === 0) {
    return (
      <div
        className={cn(
          "w-full max-w-xl mx-auto my-3 rounded-2xl bg-background border border-border p-4 text-xs text-muted-foreground animate-pulse",
          className,
        )}
      >
        <div className="flex items-center gap-2">
          <span className="size-2 rounded-full bg-primary animate-ping" />
          Preparing a question…
        </div>
      </div>
    )
  }

  const currentQuestion = questions[currentStep] || questions[0]
  const isLastStep = currentStep === questions.length - 1

  const handleSelectChoice = (choice: string) => {
    setSelectedChoices((prev) => ({
      ...prev,
      [currentStep]: choice,
    }))
    // Clear custom input if clicking a predefined choice
    setCustomInputs((prev) => ({
      ...prev,
      [currentStep]: "",
    }))
  }

  const handleCustomInputChange = (value: string) => {
    setCustomInputs((prev) => ({
      ...prev,
      [currentStep]: value,
    }))
    // Deselect predefined choices if typing custom answer
    if (value.trim()) {
      setSelectedChoices((prev) => {
        const next = { ...prev }
        delete next[currentStep]
        return next
      })
    }
  }

  const handleNext = (e?: React.MouseEvent) => {
    e?.preventDefault()
    e?.stopPropagation()
    if (currentStep < questions.length - 1) {
      setCurrentStep((prev) => prev + 1)
    }
  }

  const handlePrevious = (e?: React.MouseEvent) => {
    e?.preventDefault()
    e?.stopPropagation()
    if (currentStep > 0) {
      setCurrentStep((prev) => prev - 1)
    }
  }

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault()
    const compiledAnswers: AskUserAnswer[] = questions.map((q, index) => {
      const answer = customInputs[index]?.trim() || selectedChoices[index] || ""
      return {
        question: q.question,
        answer,
      }
    })
    onAnswer(part.toolCallId, compiledAnswers)
  }

  return (
    <div
      className={cn(
        "w-full max-w-xl mx-auto my-3 rounded-2xl bg-background border border-border p-4 sm:p-5 text-xs shadow-xs flex flex-col gap-4",
        className,
      )}
    >
      {/* Progress & Slide Counter */}
      {questions.length > 1 && (
        <div className="flex items-center justify-between border-b border-border/60 pb-2.5 text-muted-foreground">
          <span className="text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">
            Question {currentStep + 1} of {questions.length}
          </span>
          <div className="flex items-center gap-1.5">
            {questions.map((_, i) => (
              <button
                type="button"
                key={i}
                aria-label={`Go to question ${i + 1}`}
                onClick={() => setCurrentStep(i)}
                className={cn(
                  "h-1.5 rounded-full transition-all duration-200 cursor-pointer",
                  i === currentStep
                    ? "w-6 bg-primary"
                    : i < currentStep
                      ? "w-3 bg-primary/40"
                      : "w-3 bg-muted",
                )}
              />
            ))}
          </div>
        </div>
      )}

      {/* Single Question Slide Content */}
      <form onSubmit={handleSubmit} className="flex flex-col gap-4">
        <div className="flex flex-col gap-3">
          <h3 className="text-sm font-semibold text-foreground leading-snug">
            {currentQuestion.question}
          </h3>

          {/* Symmetrically Indented Choices with Right-Aligned Ticks */}
          <div className="grid gap-2">
            {currentQuestion.choices.map((choice) => {
              const isSelected = selectedChoices[currentStep] === choice
              return (
                <button
                  type="button"
                  key={choice}
                  onClick={() => handleSelectChoice(choice)}
                  className={cn(
                    "flex h-11 min-h-11 w-full items-center justify-between rounded-xl border px-4 text-start text-xs font-medium transition-all outline-none cursor-pointer select-none",
                    isSelected
                      ? "border-primary/50 bg-primary/10 text-foreground"
                      : "border-border/70 bg-muted/20 text-muted-foreground hover:bg-muted/40 hover:text-foreground",
                  )}
                >
                  <span className="flex-1 pr-3 leading-snug text-foreground font-medium truncate">
                    {choice}
                  </span>

                  {/* Symmetrical Checkbox Indicator on the RIGHT */}
                  <span
                    className={cn(
                      "flex size-4.5 shrink-0 items-center justify-center rounded-full border transition-all",
                      isSelected
                        ? "border-primary bg-primary text-primary-foreground shadow-2xs"
                        : "border-border/80 bg-background/60",
                    )}
                  >
                    {isSelected && <CheckIcon className="size-3 stroke-[3]" />}
                  </span>
                </button>
              )
            })}

            {/* Symmetrically Indented Write-in Input */}
            <input
              type="text"
              aria-label="Another answer"
              placeholder="Type another answer…"
              value={customInputs[currentStep] || ""}
              onChange={(e) => handleCustomInputChange(e.target.value)}
              className="h-11 min-h-11 w-full rounded-xl border border-border/70 bg-muted/20 px-4 text-xs text-foreground placeholder:text-muted-foreground outline-none focus:border-ring focus:ring-1 focus:ring-ring transition-all"
            />
          </div>
        </div>

        {/* Slide Navigation Actions */}
        <div className="flex items-center justify-between pt-2 border-t border-border/50">
          {currentStep > 0 ? (
            <Button
              type="button"
              variant="outline"
              size="sm"
              onClick={handlePrevious}
              className="h-8 rounded-full px-4 text-xs font-medium cursor-pointer"
            >
              Previous
            </Button>
          ) : (
            <div />
          )}

          <div className="flex items-center gap-2">
            {!isLastStep ? (
              <Button
                type="button"
                size="sm"
                onClick={handleNext}
                className="h-8 rounded-full px-5 text-xs font-semibold cursor-pointer"
              >
                Next
              </Button>
            ) : (
              <Button
                type="submit"
                size="sm"
                className="h-8 rounded-full px-5 text-xs font-semibold cursor-pointer"
              >
                Answer
              </Button>
            )}
          </div>
        </div>
      </form>
    </div>
  )
}
