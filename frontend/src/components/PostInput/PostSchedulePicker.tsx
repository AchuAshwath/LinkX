"use client"

import { parseDate } from "chrono-node"
import { CalendarIcon } from "lucide-react"
import * as React from "react"

import { Button } from "@/components/ui/button"
import { Calendar } from "@/components/ui/calendar"
import { Input } from "@/components/ui/input"
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover"

export function formatDate(date: Date | undefined): string {
  if (!date) return ""
  return date.toLocaleDateString("en-US", {
    month: "short",
    day: "numeric",
    year: "numeric",
  })
}

export function formatTime(date: Date | undefined): string {
  if (!date) return "5:00 PM"
  return date.toLocaleTimeString("en-US", {
    hour: "numeric",
    minute: "2-digit",
    hour12: true,
  })
}

export function formatDateTime(date: Date | undefined): string {
  if (!date) return ""
  return date.toLocaleString("en-US", {
    month: "short",
    day: "numeric",
    year: "numeric",
    hour: "numeric",
    minute: "2-digit",
    hour12: true,
  })
}

export function parseTimeInput(timeStr: string, baseDate: Date): Date | null {
  const trimmed = timeStr.trim()
  if (!trimmed) return null

  // 1. Match 12-hour or 24-hour time strings like "3:23 pm", "15:23", "3pm", "3:30"
  const match = trimmed.match(/^(\d{1,2})(?::(\d{2}))?\s*(am|pm)?$/i)
  if (match) {
    let hours = parseInt(match[1], 10)
    const minutes = match[2] ? parseInt(match[2], 10) : 0
    const meridiem = match[3]?.toLowerCase()
    if (meridiem === "pm" && hours < 12) hours += 12
    if (meridiem === "am" && hours === 12) hours = 0
    if (hours >= 0 && hours < 24 && minutes >= 0 && minutes < 60) {
      const next = new Date(baseDate)
      next.setHours(hours, minutes, 0, 0)
      return next
    }
  }

  // 2. Fallback to chrono parse
  const parsed = parseDate(trimmed, baseDate)
  if (parsed) {
    const next = new Date(baseDate)
    next.setHours(parsed.getHours(), parsed.getMinutes(), 0, 0)
    return next
  }

  return null
}

export interface PostSchedulePickerProps {
  initialValue?: Date
  onChangeDateTime?: (dateTime: Date | undefined) => void
}

export function PostSchedulePicker({
  initialValue,
  onChangeDateTime,
}: PostSchedulePickerProps) {
  const [open, setOpen] = React.useState(false)
  const defaultDate = React.useMemo(
    () => initialValue || new Date(Date.now() + 2 * 3600 * 1000),
    [initialValue],
  )
  const [value, setValue] = React.useState("")
  const [dateTime, setDateTime] = React.useState<Date>(defaultDate)
  const [timeText, setTimeText] = React.useState<string>(() =>
    formatTime(defaultDate),
  )
  const [month, setMonth] = React.useState<Date>(defaultDate)

  const onChangeRef = React.useRef(onChangeDateTime)
  React.useEffect(() => {
    onChangeRef.current = onChangeDateTime
  }, [onChangeDateTime])

  // Fire initial schedule date on mount
  React.useEffect(() => {
    onChangeRef.current?.(dateTime)
  }, [dateTime])

  React.useEffect(() => {
    if (initialValue) {
      setDateTime(initialValue)
      setMonth(initialValue)
      setTimeText(formatTime(initialValue))
    }
  }, [initialValue])

  // Handle typing natural language (e.g. "in 2 hours", "tomorrow 9am", "in 4 hours")
  const handleInputChange = (text: string) => {
    setValue(text)
    if (!text.trim()) {
      const resetDate = new Date()
      resetDate.setHours(dateTime.getHours(), dateTime.getMinutes(), 0, 0)
      setDateTime(resetDate)
      onChangeRef.current?.(resetDate)
      return
    }
    // Parse relative to current fixed timestamp (now)
    const parsed = parseDate(text, new Date())
    if (parsed) {
      setDateTime(parsed)
      setMonth(parsed)
      setTimeText(formatTime(parsed))
      onChangeRef.current?.(parsed)
    }
  }

  // Handle picking a date from Calendar popover
  const handleDateSelect = (selectedDate: Date | undefined) => {
    if (!selectedDate) return
    const next = new Date(selectedDate)
    next.setHours(dateTime.getHours(), dateTime.getMinutes(), 0, 0)
    setDateTime(next)
    setValue(formatDate(next))
    setTimeText(formatTime(next))
    setMonth(selectedDate)
    setOpen(false)
    onChangeRef.current?.(next)
  }

  // Handle typing time text (e.g. "3:23 pm", "15:30", "3pm")
  const handleTimeChange = (typed: string) => {
    setTimeText(typed)
    const parsed = parseTimeInput(typed, dateTime)
    if (parsed) {
      setDateTime(parsed)
      onChangeRef.current?.(parsed)
    }
  }

  // On blur, normalize time display
  const handleTimeBlur = () => {
    setTimeText(formatTime(dateTime))
  }

  return (
    <div className="flex items-center gap-1.5 shrink-0">
      {/* Natural Language Date Input + Calendar Popover */}
      <div className="relative w-36 sm:w-44 shrink-0">
        <Input
          id="schedule-input"
          value={value}
          placeholder="in 2 hours…"
          autoComplete="off"
          autoCorrect="off"
          autoCapitalize="off"
          spellCheck={false}
          className="h-8.5 w-full bg-background pr-7 text-xs font-medium focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-primary rounded-lg border-border/80"
          onChange={(e) => handleInputChange(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "ArrowDown") {
              e.preventDefault()
              setOpen(true)
            }
          }}
        />
        <Popover open={open} onOpenChange={setOpen}>
          <PopoverTrigger asChild>
            <Button
              id="date-picker"
              type="button"
              variant="ghost"
              size="icon"
              className="absolute top-1/2 right-1 h-6 w-6 -translate-y-1/2 rounded-full hover:bg-accent active:scale-95 cursor-pointer text-muted-foreground hover:text-foreground p-0"
              aria-label="Open calendar"
            >
              <CalendarIcon className="h-3.5 w-3.5 text-primary" />
              <span className="sr-only">Select date</span>
            </Button>
          </PopoverTrigger>
          <PopoverContent
            className="w-auto overflow-hidden p-0 bg-popover rounded-xl border border-border shadow-lg"
            align="start"
            side="top"
            sideOffset={6}
          >
            <Calendar
              mode="single"
              selected={dateTime}
              month={month}
              onMonthChange={setMonth}
              onSelect={handleDateSelect}
              disabled={(date) => {
                const today = new Date()
                today.setHours(0, 0, 0, 0)
                return date < today
              }}
            />
          </PopoverContent>
        </Popover>
      </div>

      {/* Typeable Text Time Input */}
      <div className="w-20 sm:w-24 shrink-0">
        <Input
          type="text"
          id="time-input"
          value={timeText}
          placeholder="5:00 PM"
          autoComplete="off"
          autoCorrect="off"
          autoCapitalize="off"
          spellCheck={false}
          onChange={(e) => handleTimeChange(e.target.value)}
          onBlur={handleTimeBlur}
          className="h-8.5 w-full bg-background text-xs font-medium text-center focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-primary rounded-lg border-border/80 px-1.5"
        />
      </div>
    </div>
  )
}
