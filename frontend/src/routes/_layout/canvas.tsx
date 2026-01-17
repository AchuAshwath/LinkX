import { createFileRoute, Link } from "@tanstack/react-router"
import {
  ChevronsUpDown,
  CreditCard,
  HelpCircle,
  LogOut,
  Settings,
  User,
} from "lucide-react"
import { PostInputBox } from "@/components/PostInput"
import { Button } from "@/components/ui/button"
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu"
import { UserInfo } from "@/components/Common/UserInfo"

export const Route = createFileRoute("/_layout/canvas")({
  component: CanvasPage,
  head: () => ({
    meta: [
      {
        title: "Canvas",
      },
    ],
  }),
})

function CanvasPage() {
  // Mock user data for development
  const mockUser = {
    full_name: "John Doe",
    email: "john.doe@example.com",
  }

  const handleLogout = () => {
    console.log("Logout clicked")
  }

  return (
    <div className="p-3 sm:p-4 md:p-6">
      <div className="min-h-[60vh] rounded-lg border border-dashed bg-background/40 p-6">
      <div className="space-y-6">
        <div>
          <h1 className="text-xl font-semibold">Canvas</h1>
          <p className="text-sm text-muted-foreground">
            Blank canvas for experimenting with components
          </p>
        </div>

        {/* Profile Dropdown Component */}
        <div className="space-y-4">
          <div>
            <h2 className="text-lg font-semibold mb-4">
              Profile Dropdown Component
            </h2>
            <div className="flex justify-center">
              <DropdownMenu>
                <DropdownMenuTrigger asChild>
                  <Button
                    variant="outline"
                    className="w-full max-w-sm justify-start text-base h-auto py-2 px-3 data-[state=open]:bg-accent data-[state=open]:text-accent-foreground"
                  >
                    <UserInfo
                      fullName={mockUser.full_name}
                      email={mockUser.email}
                    />
                    <ChevronsUpDown className="ml-auto size-4 text-muted-foreground shrink-0" />
                  </Button>
                </DropdownMenuTrigger>
                <DropdownMenuContent
                  className="w-[--radix-dropdown-menu-trigger-width] min-w-56 rounded-lg"
                  align="start"
                  sideOffset={4}
                >
                  <DropdownMenuLabel className="p-0 font-normal">
                    <UserInfo
                      fullName={mockUser.full_name}
                      email={mockUser.email}
                    />
                  </DropdownMenuLabel>
                  <DropdownMenuSeparator />
                  <Link to="/settings">
                    <DropdownMenuItem>
                      <Settings className="mr-2 h-4 w-4" />
                      User Settings
                    </DropdownMenuItem>
                  </Link>
                  <DropdownMenuItem>
                    <User className="mr-2 h-4 w-4" />
                    Profile
                  </DropdownMenuItem>
                  <DropdownMenuItem>
                    <CreditCard className="mr-2 h-4 w-4" />
                    Billing
                  </DropdownMenuItem>
                  <DropdownMenuItem>
                    <HelpCircle className="mr-2 h-4 w-4" />
                    Help & Support
                  </DropdownMenuItem>
                  <DropdownMenuSeparator />
                  <DropdownMenuItem onClick={handleLogout}>
                    <LogOut className="mr-2 h-4 w-4" />
                    Log Out
                  </DropdownMenuItem>
                </DropdownMenuContent>
              </DropdownMenu>
            </div>
          </div>
        </div>

        <PostInputBox username="Jane Doe" />
      </div>
    </div>
    </div>
  )
}

export default CanvasPage
