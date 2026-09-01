import { CheckIcon } from "lucide-react"
import * as React from "react"
import { Button } from "@/components/ui/button"
import { cn } from "@/lib/utils"

export interface QuestionnaireProps extends React.ComponentProps<"form"> {
  defaultItem?: string
  items?: Array<{ name: string; choices: Array<{ value: string }> }>
}

function Questionnaire({
  className,
  defaultItem: _defaultItem,
  items: _items,
  ...props
}: QuestionnaireProps) {
  return (
    <form
      data-slot="questionnaire"
      className={cn("flex w-full min-w-0 flex-col gap-4", className)}
      {...props}
    />
  )
}

function QuestionnaireProgress({
  className,
  ...props
}: React.ComponentProps<"div">) {
  return (
    <div
      data-slot="questionnaire-progress"
      className={cn(
        "min-h-[1lh] w-fit min-w-[14ch] text-xs font-medium text-muted-foreground tabular-nums",
        className,
      )}
      {...props}
    />
  )
}

function QuestionnaireItem({
  className,
  name: _name,
  ...props
}: React.ComponentProps<"div"> & { name?: string }) {
  return (
    <div
      data-slot="questionnaire-item"
      className={cn(
        "flex min-w-0 flex-col gap-3 border-0 p-0 outline-none",
        className,
      )}
      {...props}
    />
  )
}

function QuestionnaireTitle({
  className,
  ...props
}: React.ComponentProps<"h3">) {
  return (
    <h3
      data-slot="questionnaire-title"
      className={cn(
        "text-sm font-semibold text-foreground text-pretty",
        className,
      )}
      {...props}
    />
  )
}

function QuestionnaireDescription({
  className,
  ...props
}: React.ComponentProps<"p">) {
  return (
    <p
      data-slot="questionnaire-description"
      className={cn("text-xs text-pretty text-muted-foreground", className)}
      {...props}
    />
  )
}

function QuestionnaireChoices({
  className,
  ...props
}: React.ComponentProps<"div">) {
  return (
    <div
      data-slot="questionnaire-choices"
      className={cn(
        "group/questionnaire-choices grid min-w-0 gap-2",
        className,
      )}
      {...props}
    />
  )
}

function QuestionnaireChoice({
  children,
  value,
  name = "q0",
  className,
  ...props
}: React.ComponentProps<"label"> & { value: string; name?: string }) {
  const [selected, setSelected] = React.useState(false)

  return (
    <label
      data-slot="questionnaire-choice"
      data-checked={selected ? "true" : undefined}
      className={cn(
        "group/questionnaire-choice relative flex min-h-10 cursor-pointer items-start gap-3 rounded-xl border border-input/60 bg-input/20 px-3.5 py-2.5 text-start text-xs font-medium transition-all outline-none select-none hover:bg-input/40 has-[>input:checked]:border-primary/50 has-[>input:checked]:bg-primary/10",
        className,
      )}
      {...props}
    >
      <input
        type="radio"
        name={name}
        value={value}
        data-slot="questionnaire-choice-input"
        onChange={(e) => setSelected(e.target.checked)}
        className="sr-only"
      />
      <span
        aria-hidden="true"
        data-slot="questionnaire-choice-indicator"
        className={cn(
          "pointer-events-none relative flex size-3.5 shrink-0 translate-y-0.5 items-center justify-center rounded-full border border-border bg-input/90",
          selected && "border-primary bg-primary text-primary-foreground",
        )}
      >
        {selected && (
          <CheckIcon className="size-2.5 stroke-[3] text-primary-foreground" />
        )}
      </span>
      <span
        data-slot="questionnaire-choice-label"
        className="flex min-w-0 flex-1 flex-col gap-1 leading-snug"
      >
        {children}
      </span>
    </label>
  )
}

function QuestionnaireInput({
  className,
  name = "q0_custom",
  placeholder = "Type another answer…",
  ...props
}: React.ComponentProps<"input">) {
  return (
    <div
      data-slot="questionnaire-input-wrapper"
      className="group/questionnaire-input relative w-full min-w-0 mt-1"
    >
      <input
        name={name}
        placeholder={placeholder}
        data-slot="questionnaire-input"
        className={cn(
          "h-9 w-full min-w-0 rounded-xl border border-input/60 bg-input/20 px-3 py-1 text-xs transition-colors duration-200 outline-none focus-visible:border-ring focus-visible:ring-2 focus-visible:ring-ring/30 disabled:opacity-50 placeholder:text-muted-foreground",
          className,
        )}
        {...props}
      />
    </div>
  )
}

function QuestionnaireError({
  className,
  ...props
}: React.ComponentProps<"div">) {
  return (
    <div
      data-slot="questionnaire-error"
      className={cn("mt-1 text-xs text-destructive", className)}
      {...props}
    />
  )
}

function QuestionnaireActions({
  className,
  ...props
}: React.ComponentProps<"div">) {
  return (
    <div
      data-slot="questionnaire-actions"
      className={cn("flex items-center justify-end gap-2 pt-2", className)}
      {...props}
    />
  )
}

function QuestionnaireSubmit({
  children,
  className,
  size = "sm",
  variant = "default",
  ...props
}: React.ComponentProps<typeof Button>) {
  return (
    <Button
      type="submit"
      size={size}
      variant={variant}
      data-slot="questionnaire-submit"
      className={cn(
        "cursor-pointer rounded-xl text-xs font-semibold px-4 h-8 bg-primary text-primary-foreground hover:bg-primary/90",
        className,
      )}
      {...props}
    >
      {children ?? "Submit"}
    </Button>
  )
}

export {
  Questionnaire,
  QuestionnaireActions,
  QuestionnaireChoice,
  QuestionnaireChoices,
  QuestionnaireDescription,
  QuestionnaireError,
  QuestionnaireInput,
  QuestionnaireItem,
  QuestionnaireProgress,
  QuestionnaireSubmit,
  QuestionnaireTitle,
}
