"use client"

import * as React from "react"
import { parseDate } from "chrono-node"
import { CalendarIcon } from "lucide-react"

import { Button } from "@/components/ui/button"
import { Calendar } from "@/components/ui/calendar"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover"

function formatDate(date: Date | undefined) {
  if (!date) {
    return ""
  }

  return date.toLocaleDateString("en-US", {
    day: "2-digit",
    month: "long",
    year: "numeric",
  })
}

function formatTime(date: Date | undefined) {
  if (!date) {
    return ""
  }

  const hours = date.getHours().toString().padStart(2, "0")
  const minutes = date.getMinutes().toString().padStart(2, "0")
  const seconds = date.getSeconds().toString().padStart(2, "0")
  return `${hours}:${minutes}:${seconds}`
}

function formatDateTime(date: Date | undefined) {
  if (!date) {
    return ""
  }

  return date.toLocaleString("en-US", {
    day: "2-digit",
    month: "long",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
    hour12: true,
  })
}

export function PostSchedulePicker() {
  // Initialize with current time
  const now = React.useMemo(() => new Date(), [])
  const initialDateTime = React.useMemo(() => {
    // Parse "In 4 hours" to get the future date, but keep current time
    const parsedDate = parseDate("In 4 hours")
    if (parsedDate) {
      // Set the time to current time, but keep the parsed date
      const result = new Date(parsedDate)
      result.setHours(now.getHours(), now.getMinutes(), now.getSeconds(), 0)
      return result
    }
    return now
  }, [now])

  const [open, setOpen] = React.useState(false)
  const [value, setValue] = React.useState("In 4 hours")
  const [dateTime, setDateTime] = React.useState<Date | undefined>(
    initialDateTime
  )
  const [month, setMonth] = React.useState<Date | undefined>(initialDateTime)

  // Update dateTime when natural language input changes
  React.useEffect(() => {
    const parsedDate = parseDate(value)
    if (parsedDate) {
      setDateTime(parsedDate)
      setMonth(parsedDate)
    }
  }, [value])

  const time = React.useMemo(() => formatTime(dateTime), [dateTime])

  // Update date when selected from calendar, keep existing time component
  const handleDateSelect = (selectedDate: Date | undefined) => {
    if (!selectedDate) {
      setDateTime(undefined)
      return
    }

    setDateTime((prev) => {
      const base = prev ?? new Date()
      const next = new Date(selectedDate)
      next.setHours(
        base.getHours(),
        base.getMinutes(),
        base.getSeconds(),
        0,
      )
      return next
    })

    setValue(formatDate(selectedDate))
    setMonth(selectedDate)
    setOpen(false)
  }

  const handleTimeChange = (newTime: string) => {
    const [hours, minutes, seconds] = newTime.split(":")
    setDateTime((prev) => {
      const base = prev ?? new Date()
      const next = new Date(base)
      next.setHours(
        parseInt(hours || "0", 10),
        parseInt(minutes || "0", 10),
        parseInt(seconds || "0", 10),
        0,
      )
      return next
    })
  }

  return (
    <div className="flex flex-col gap-3">
      <Label htmlFor="schedule-input" className="px-1">
        Schedule Post
      </Label>
      <div className="flex gap-2">
        <div className="relative flex-1">
          <Input
            id="schedule-input"
            value={value}
            placeholder="In 4 hours, tomorrow, next week"
            className="bg-background pr-10"
            onChange={(e) => {
              setValue(e.target.value)
            }}
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
                className="absolute top-1/2 right-2 size-6 -translate-y-1/2"
              >
                <CalendarIcon className="size-3.5" />
                <span className="sr-only">Select date</span>
              </Button>
            </PopoverTrigger>
            <PopoverContent className="w-auto overflow-hidden p-0" align="end">
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
        <div className="w-32">
          <Input
            type="time"
            id="time-picker"
            step="1"
            value={time}
            onChange={(e) => handleTimeChange(e.target.value)}
            className="bg-background appearance-none [&::-webkit-calendar-picker-indicator]:hidden [&::-webkit-calendar-picker-indicator]:appearance-none"
          />
        </div>
      </div>
      <div className="text-muted-foreground px-1 text-sm">
        Your post will be published on{" "}
        <span className="font-medium">
          {formatDateTime(dateTime) || "..."}
        </span>
        .
      </div>
    </div>
  )
}
