"use client"

import * as React from "react"
import { parseDate } from "chrono-node"
import { CalendarIcon } from "lucide-react"

import { Button } from "@/components/ui/button"
import { Calendar } from "@/components/ui/calendar"
import { Input } from "@/components/ui/input"
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

export function formatDateTime(date: Date | undefined) {
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
  })
}

interface PostSchedulePickerProps {
  onChangeDateTime?: (dateTime: Date | undefined) => void
}

export function PostSchedulePicker({ onChangeDateTime }: PostSchedulePickerProps) {
  // Initialize with current time
  const now = React.useMemo(() => new Date(), [])
  
  // Initialize dateTime to current time, then parse "In 4 hours" for the date part
  const initialDateTime = React.useMemo(() => {
    const parsed = parseDate("In 4 hours")
    if (parsed) {
      const result = new Date(parsed)
      // Keep current time, just update the date
      result.setHours(now.getHours(), now.getMinutes(), now.getSeconds(), 0)
      return result
    }
    return now
  }, [now])

  const [open, setOpen] = React.useState(false)
  const [value, setValue] = React.useState("In 4 hours")
  const [dateTime, setDateTime] = React.useState<Date | undefined>(
    initialDateTime,
  )
  const [month, setMonth] = React.useState<Date | undefined>(initialDateTime)
  const skipNextEffectRef = React.useRef(false)

  React.useEffect(() => {
    if (!onChangeDateTime) return
    onChangeDateTime(dateTime)
  }, [dateTime, onChangeDateTime])

  // Update dateTime when natural language input changes
  React.useEffect(() => {
    if (skipNextEffectRef.current) {
      skipNextEffectRef.current = false
      return
    }

    const parsed = parseDate(value)
    if (!parsed) return

    // Update date AND time based on parsed result
    setDateTime((prev) => {
      return new Date(parsed)
    })
    setMonth(parsed)
  }, [value, now])

  const time = React.useMemo(() => formatTime(dateTime), [dateTime])

  // Update date when selected from calendar, keep existing time component
  const handleDateSelect = (selectedDate: Date | undefined) => {
    if (!selectedDate) {
      setDateTime(undefined)
      setValue("")
      return
    }

    // Calculate new date with existing time
    const base = dateTime ?? new Date()
    const next = new Date(selectedDate)
    next.setHours(base.getHours(), base.getMinutes(), base.getSeconds(), 0)

    // Update both states
    skipNextEffectRef.current = true
    setDateTime(next)
    setValue(formatDate(next))
    setMonth(selectedDate)
    setOpen(false)
  }

  const handleTimeChange = (newTime: string) => {
    const [hours, minutes, seconds] = newTime.split(":")
    const hoursNum = parseInt(hours || "0", 10)
    const minutesNum = parseInt(minutes || "0", 10)
    const secondsNum = parseInt(seconds || "0", 10)

    // Update time on existing dateTime
    setDateTime((prev) => {
      if (!prev) {
        const next = new Date()
        next.setHours(hoursNum, minutesNum, secondsNum, 0)
        return next
      }
      const next = new Date(prev)
      next.setHours(hoursNum, minutesNum, secondsNum, 0)
      return next
    })
  }

  return (
    <div className="flex min-w-0 flex-col gap-2 sm:flex-row sm:items-center sm:gap-2">
      <div className="relative w-32 shrink-0 sm:w-[200px]">
        <Input
          id="schedule-input"
          value={value}
          placeholder="In 4 hours, tomorrow"
          className="bg-background pr-10 text-xs sm:text-sm"
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
      <div className="w-32 shrink-0">
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
  )
}
