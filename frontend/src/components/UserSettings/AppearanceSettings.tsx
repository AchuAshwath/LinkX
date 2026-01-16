import { Monitor, Moon, Sun, type LucideIcon } from "lucide-react"

import { type Theme, useTheme } from "@/components/theme-provider"
import { Button } from "@/components/ui/button"
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card"

const ICON_MAP: Record<Theme, LucideIcon> = {
  system: Monitor,
  light: Sun,
  dark: Moon,
}

const themeOptions: { value: Theme; label: string; description: string }[] = [
  {
    value: "light",
    label: "Light",
    description: "Use light theme",
  },
  {
    value: "dark",
    label: "Dark",
    description: "Use dark theme",
  },
  {
    value: "system",
    label: "System",
    description: "Use system theme",
  },
]

const AppearanceSettings = () => {
  const { theme, setTheme } = useTheme()

  return (
    <div className="max-w-md">
      <h3 className="text-lg font-semibold py-4">Appearance</h3>
      <Card>
        <CardHeader>
          <CardTitle>Theme</CardTitle>
          <CardDescription>
            Choose your preferred theme for the application
          </CardDescription>
        </CardHeader>
        <CardContent>
          <div className="flex flex-col gap-2">
            {themeOptions.map((option) => {
              const Icon = ICON_MAP[option.value]
              const isSelected = theme === option.value

              return (
                <Button
                  key={option.value}
                  variant={isSelected ? "default" : "outline"}
                  className="w-full justify-start h-auto py-3 px-4"
                  onClick={() => setTheme(option.value)}
                >
                  <Icon className="mr-3 h-4 w-4" />
                  <div className="flex flex-col items-start">
                    <span className="font-medium">{option.label}</span>
                    <span className="text-xs text-muted-foreground">
                      {option.description}
                    </span>
                  </div>
                  {isSelected && (
                    <span className="ml-auto text-xs">✓</span>
                  )}
                </Button>
              )
            })}
          </div>
        </CardContent>
      </Card>
    </div>
  )
}

export default AppearanceSettings
