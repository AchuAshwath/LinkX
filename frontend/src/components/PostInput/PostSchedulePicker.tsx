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

export function formatDate(date: Date | undefined) {
  if (!date) return ""
  return date.toLocaleDateString("en-US", {
    day: "2-digit",
    month: "long",
    year: "numeric",
  })
}

export function formatTime(date: Date | undefined) {
  if (!date) return ""
  const hours = date.getHours().toString().padStart(2, "0")
  const minutes = date.getMinutes().toString().padStart(2, "0")
  const seconds = date.getSeconds().toString().padStart(2, "0")
  return `${hours}:${minutes}:${seconds}`
}

export function formatDateTime(date: Date | undefined) {
  if (!date) return ""
  return date.toLocaleString("en-US", {
    day: "2-digit",
    month: "long",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
  })
}

interface PostSchedulePickerProps {
  onChangeDateTime?: (dateTime: Date | undefined) => void
  initialValue?: Date
}

export function PostSchedulePicker({
  onChangeDateTime,
  initialValue,
}: PostSchedulePickerProps) {
  const defaultFutureDate = React.useMemo(
    () => initialValue || new Date(Date.now() + 4 * 3600 * 1000),
    [initialValue],
  )

  const [open, setOpen] = React.useState(false)
  const [value, setValue] = React.useState(() =>
    initialValue ? formatDate(initialValue) : "In 4 hours",
  )
  const [dateTime, setDateTime] = React.useState<Date>(defaultFutureDate)
  const [month, setMonth] = React.useState<Date>(defaultFutureDate)
  const onChangeDateTimeRef = React.useRef(onChangeDateTime)

  React.useEffect(() => {
    onChangeDateTimeRef.current = onChangeDateTime
  }, [onChangeDateTime])

  // Fire initial schedule time on mount
  React.useEffect(() => {
    onChangeDateTimeRef.current?.(dateTime)
  }, [dateTime])

  // Sync if initialValue changes externally
  React.useEffect(() => {
    if (initialValue) {
      setDateTime(initialValue)
      setValue(formatDate(initialValue))
      setMonth(initialValue)
    }
  }, [initialValue])

  // Parse natural language input
  const handleInputChange = (text: string) => {
    setValue(text)
    if (!text.trim()) return
    const parsed = parseDate(text)
    if (parsed) {
      setDateTime(parsed)
      setMonth(parsed)
      onChangeDateTimeRef.current?.(parsed)
    }
  }

  // Handle date selection from calendar popup
  const handleDateSelect = (selectedDate: Date | undefined) => {
    if (!selectedDate) return
    const next = new Date(selectedDate)
    next.setHours(
      dateTime.getHours(),
      dateTime.getMinutes(),
      dateTime.getSeconds(),
      0,
    )
    setDateTime(next)
    setValue(formatDate(next))
    setMonth(selectedDate)
    setOpen(false)
    onChangeDateTimeRef.current?.(next)
  }

  // Handle time change
  const handleTimeChange = (newTime: string) => {
    if (!newTime) return
    const parts = newTime.split(":")
    const hoursNum = parseInt(parts[0] || "0", 10)
    const minutesNum = parseInt(parts[1] || "0", 10)
    const secondsNum = parseInt(parts[2] || "0", 10)

    const next = new Date(dateTime)
    next.setHours(hoursNum, minutesNum, secondsNum, 0)
    setDateTime(next)
    onChangeDateTimeRef.current?.(next)
  }

  const timeString = formatTime(dateTime)

  return (
    <div className="flex min-w-0 items-center gap-2">
      {/* Natural language / Date input */}
      <div className="relative shrink-0 w-36 sm:w-44">
        <Input
          id="schedule-input"
          value={value}
          placeholder="In 4 hours, tomorrow…"
          className="h-8 w-full bg-background pr-8 text-xs font-medium focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-primary"
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
              variant="ghost"
              size="icon"
              className="absolute top-1/2 right-1 h-6 w-6 -translate-y-1/2 rounded-full hover:bg-accent active:scale-95 focus-visible:ring-1 focus-visible:ring-primary cursor-pointer"
              aria-label="Open calendar"
            >
              <CalendarIcon className="h-3.5 w-3.5" />
              <span className="sr-only">Select date</span>
            </Button>
          </PopoverTrigger>
          <PopoverContent
            className="w-auto overflow-hidden p-0"
            align="start"
            side="bottom"
            sideOffset={4}
          >
            <Calendar
              mode="single"
              selected={dateTime}
              captionLayout="dropdown"
              month={month}
              onMonthChange={setMonth}
              onSelect={handleDateSelect}
            />
          </PopoverContent>
        </Popover>
      </div>

      {/* Time input */}
      <div className="shrink-0 w-24 sm:w-28">
        <Input
          type="time"
          id="time-picker"
          step="1"
          value={timeString}
          onChange={(e) => handleTimeChange(e.target.value)}
          className="h-8 w-full bg-background text-xs font-medium appearance-none focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-primary [&::-webkit-calendar-picker-indicator]:hidden [&::-webkit-calendar-picker-indicator]:appearance-none px-2"
        />
      </div>
    </div>
  )
}
