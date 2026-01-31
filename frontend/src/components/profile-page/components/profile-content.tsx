import { zodResolver } from "@hookform/resolvers/zod"
import { useMutation, useQueryClient } from "@tanstack/react-query"
import { Key, type LucideIcon, Monitor, Moon, Sun, Trash2 } from "lucide-react"
import { useEffect, useState } from "react"
import { Controller, useForm } from "react-hook-form"
import { z } from "zod"

import { type UpdatePassword, UsersService, type UserUpdateMe } from "@/client"
import type { Theme } from "@/components/theme-provider"
import { useTheme } from "@/components/theme-provider"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card"
import {
  Dialog,
  DialogClose,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { Separator } from "@/components/ui/separator"
import { Switch } from "@/components/ui/switch"
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs"
import { Textarea } from "@/components/ui/textarea"
import useAuth from "@/hooks/useAuth"
import useCustomToast from "@/hooks/useCustomToast"
import { handleError } from "@/utils"

const personalSchema = z.object({
  full_name: z.string().max(100).optional(),
  email: z.string().email({ message: "Invalid email address" }),
  personality: z.string().max(500).optional(),
})
type PersonalFormData = z.infer<typeof personalSchema>

const passwordSchema = z
  .object({
    current_password: z.string().min(8, { message: "At least 8 characters" }),
    new_password: z.string().min(8, { message: "At least 8 characters" }),
    confirm_password: z.string().min(1, { message: "Required" }),
  })
  .refine((d) => d.new_password === d.confirm_password, {
    message: "Passwords don't match",
    path: ["confirm_password"],
  })
type PasswordFormData = z.infer<typeof passwordSchema>

const THEME_OPTIONS: { value: Theme; label: string; description: string }[] = [
  { value: "light", label: "Light", description: "Use light theme" },
  { value: "dark", label: "Dark", description: "Use dark theme" },
  { value: "system", label: "System", description: "Use system theme" },
]
const THEME_ICONS: Record<Theme, LucideIcon> = {
  system: Monitor,
  light: Sun,
  dark: Moon,
}

export default function ProfileContent() {
  const [isEditMode, setIsEditMode] = useState(false)
  const queryClient = useQueryClient()
  const { showSuccessToast, showErrorToast } = useCustomToast()
  const { user, logout } = useAuth()
  const { theme, setTheme } = useTheme()

  const [accountVisibility, setAccountVisibility] = useState(true)
  const [deleteDialogOpen, setDeleteDialogOpen] = useState(false)
  const [changePasswordDialogOpen, setChangePasswordDialogOpen] =
    useState(false)

  const personalForm = useForm<PersonalFormData>({
    resolver: zodResolver(personalSchema),
    mode: "onBlur",
    defaultValues: {
      full_name: user?.full_name ?? undefined,
      email: user?.email ?? "",
      personality: "",
    },
  })
  useEffect(() => {
    personalForm.reset({
      full_name: user?.full_name ?? undefined,
      email: user?.email ?? "",
      personality: personalForm.getValues("personality") || "",
    })
  }, [user?.full_name, user?.email, personalForm.getValues, personalForm.reset])

  const passwordForm = useForm<PasswordFormData>({
    resolver: zodResolver(passwordSchema),
    defaultValues: {
      current_password: "",
      new_password: "",
      confirm_password: "",
    },
  })

  const updateUserMutation = useMutation({
    mutationFn: (data: UserUpdateMe) =>
      UsersService.updateUserMe({ requestBody: data }),
    onSuccess: () => {
      showSuccessToast("Profile updated successfully")
      queryClient.invalidateQueries({ queryKey: ["currentUser"] })
    },
    onError: handleError.bind(showErrorToast),
  })

  const updatePasswordMutation = useMutation({
    mutationFn: (data: UpdatePassword) =>
      UsersService.updatePasswordMe({ requestBody: data }),
    onSuccess: () => {
      showSuccessToast("Password updated successfully")
      passwordForm.reset()
      setChangePasswordDialogOpen(false)
    },
    onError: handleError.bind(showErrorToast),
  })

  const deleteUserMutation = useMutation({
    mutationFn: () => UsersService.deleteUserMe(),
    onSuccess: () => {
      showSuccessToast("Your account has been successfully deleted")
      logout()
    },
    onError: handleError.bind(showErrorToast),
    onSettled: () => {
      queryClient.invalidateQueries({ queryKey: ["currentUser"] })
      setDeleteDialogOpen(false)
    },
  })

  const onPersonalSubmit = (data: PersonalFormData) => {
    const payload: UserUpdateMe = {}
    if (data.full_name !== (user?.full_name ?? undefined))
      payload.full_name = data.full_name ?? null
    if (data.email !== user?.email) payload.email = data.email
    if (Object.keys(payload).length > 0) {
      updateUserMutation.mutate(payload, {
        onSuccess: () => {
          setIsEditMode(false)
        },
      })
    } else {
      setIsEditMode(false)
    }
  }

  const onPasswordSubmit = (data: PasswordFormData) => {
    updatePasswordMutation.mutate({
      current_password: data.current_password,
      new_password: data.new_password,
    })
  }

  const onConfirmDelete = () => {
    deleteUserMutation.mutate()
  }

  return (
    <Tabs id="profile-content" defaultValue="personal" className="space-y-6">
      <TabsList className="grid w-full grid-cols-4">
        <TabsTrigger value="personal">Personal</TabsTrigger>
        <TabsTrigger value="account">Account</TabsTrigger>
        <TabsTrigger value="security">Security</TabsTrigger>
        <TabsTrigger value="appearance">Appearance</TabsTrigger>
      </TabsList>

      {/* Personal – same structure as example: grid, space-y-2, Label + Input only */}
      <TabsContent value="personal" className="space-y-6">
        <Card>
          <CardHeader>
            <div className="flex items-center justify-between">
              <div>
                <CardTitle>Personal Information</CardTitle>
                <CardDescription>
                  Update your personal details and profile information.
                </CardDescription>
              </div>
              {!isEditMode && (
                <Button
                  variant="outline"
                  onClick={() => setIsEditMode(true)}
                  type="button"
                >
                  Edit
                </Button>
              )}
            </div>
          </CardHeader>
          <CardContent className="space-y-6">
            <form
              onSubmit={personalForm.handleSubmit(onPersonalSubmit)}
              className="space-y-4"
            >
              <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
                <div className="space-y-2">
                  <Label htmlFor="fullName" className="text-base">
                    Full name
                  </Label>
                  <Controller
                    name="full_name"
                    control={personalForm.control}
                    render={({ field }) => (
                      <Input
                        id="fullName"
                        {...field}
                        disabled={!isEditMode}
                        className={
                          !isEditMode
                            ? "bg-muted cursor-not-allowed opacity-60"
                            : ""
                        }
                      />
                    )}
                  />
                  {personalForm.formState.errors.full_name && (
                    <p className="text-sm text-destructive">
                      {personalForm.formState.errors.full_name.message}
                    </p>
                  )}
                </div>
                <div className="space-y-2">
                  <Label htmlFor="email" className="text-base">
                    Email
                  </Label>
                  <Controller
                    name="email"
                    control={personalForm.control}
                    render={({ field }) => (
                      <Input
                        id="email"
                        type="email"
                        {...field}
                        disabled={!isEditMode}
                        className={
                          !isEditMode
                            ? "bg-muted cursor-not-allowed opacity-60"
                            : ""
                        }
                      />
                    )}
                  />
                  {personalForm.formState.errors.email && (
                    <p className="text-sm text-destructive">
                      {personalForm.formState.errors.email.message}
                    </p>
                  )}
                </div>
              </div>
              <div className="space-y-2">
                <Label htmlFor="personality" className="text-base">
                  Personality
                </Label>
                <Textarea
                  id="personality"
                  placeholder="Tell us about yourself..."
                  rows={4}
                  {...personalForm.register("personality")}
                />
                {personalForm.formState.errors.personality && (
                  <p className="text-sm text-destructive">
                    {personalForm.formState.errors.personality.message}
                  </p>
                )}
              </div>
              {isEditMode && (
                <div className="flex gap-2">
                  <Button
                    type="submit"
                    disabled={
                      updateUserMutation.isPending ||
                      !personalForm.formState.isDirty
                    }
                  >
                    {updateUserMutation.isPending
                      ? "Saving..."
                      : "Save changes"}
                  </Button>
                  <Button
                    type="button"
                    variant="outline"
                    onClick={() => {
                      setIsEditMode(false)
                      personalForm.reset({
                        full_name: user?.full_name ?? undefined,
                        email: user?.email ?? "",
                        personality:
                          personalForm.getValues("personality") || "",
                      })
                    }}
                    disabled={updateUserMutation.isPending}
                  >
                    Cancel
                  </Button>
                </div>
              )}
            </form>
          </CardContent>
        </Card>
      </TabsContent>

      {/* Account – exact same structure as example Account card */}
      <TabsContent value="account" className="space-y-6">
        <Card>
          <CardHeader>
            <CardTitle>Account Settings</CardTitle>
            <CardDescription>
              Manage your account preferences and subscription.
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-6">
            <div className="space-y-4">
              <div className="flex items-center justify-between">
                <div className="space-y-1">
                  <Label className="text-base">Account Status</Label>
                  <p className="text-muted-foreground text-sm">
                    Your account is currently active
                  </p>
                </div>
                <Badge
                  variant="outline"
                  className="border-green-200 bg-green-50 text-green-700 dark:border-green-800 dark:bg-green-950 dark:text-green-400"
                >
                  {user?.is_active !== false ? "Active" : "Inactive"}
                </Badge>
              </div>
              <Separator />
              <div className="flex items-center justify-between">
                <div className="space-y-1">
                  <Label className="text-base">Subscription Plan</Label>
                  <p className="text-muted-foreground text-sm">
                    Pro Plan - $29/month
                  </p>
                </div>
                <Button variant="outline" disabled>
                  Coming soon
                </Button>
              </div>
              <Separator />
              <div className="flex items-center justify-between">
                <div className="space-y-1">
                  <Label className="text-base">Account Visibility</Label>
                  <p className="text-muted-foreground text-sm">
                    Make your profile visible to other users
                  </p>
                </div>
                <Switch
                  checked={accountVisibility}
                  onCheckedChange={setAccountVisibility}
                  disabled
                />
              </div>
              <Separator />
              <div className="flex items-center justify-between">
                <div className="space-y-1">
                  <Label className="text-base">Data Export</Label>
                  <p className="text-muted-foreground text-sm">
                    Download a copy of your data
                  </p>
                </div>
                <Button variant="outline" disabled>
                  Coming soon
                </Button>
              </div>
            </div>
          </CardContent>
        </Card>

        <Card className="border-destructive/50">
          <CardHeader>
            <CardTitle className="text-destructive">Danger Zone</CardTitle>
            <CardDescription>
              Irreversible and destructive actions
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-6">
            <div className="flex items-center justify-between">
              <div className="space-y-1">
                <Label className="text-base">Delete Account</Label>
                <p className="text-muted-foreground text-sm">
                  Permanently delete your account and all data
                </p>
              </div>
              <Button
                variant="destructive"
                onClick={() => setDeleteDialogOpen(true)}
              >
                <Trash2 className="mr-2 h-4 w-4" />
                Delete Account
              </Button>
            </div>
          </CardContent>
        </Card>
      </TabsContent>

      {/* Security – same structure as example Security card */}
      <TabsContent value="security" className="space-y-6">
        <Card>
          <CardHeader>
            <CardTitle>Security Settings</CardTitle>
            <CardDescription>
              Manage your account security and authentication.
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-6">
            <div className="space-y-4">
              <div className="flex items-center justify-between">
                <div className="space-y-1">
                  <Label className="text-base">Password</Label>
                  <p className="text-muted-foreground text-sm">
                    Last changed 3 months ago
                  </p>
                </div>
                <Button
                  variant="outline"
                  onClick={() => setChangePasswordDialogOpen(true)}
                >
                  <Key className="mr-2 h-4 w-4" />
                  Change Password
                </Button>
              </div>
              <Separator />
              <div className="flex items-center justify-between">
                <div className="space-y-1">
                  <Label className="text-base">Two-Factor Authentication</Label>
                  <p className="text-muted-foreground text-sm">
                    Add an extra layer of security to your account
                  </p>
                </div>
                <div className="flex items-center gap-2">
                  <Badge variant="outline" className="text-muted-foreground">
                    Coming soon
                  </Badge>
                </div>
              </div>
              <Separator />
              <div className="flex items-center justify-between">
                <div className="space-y-1">
                  <Label className="text-base">Login Notifications</Label>
                  <p className="text-muted-foreground text-sm">
                    Get notified when someone logs into your account
                  </p>
                </div>
                <Switch disabled />
              </div>
              <Separator />
              <div className="flex items-center justify-between">
                <div className="space-y-1">
                  <Label className="text-base">Active Sessions</Label>
                  <p className="text-muted-foreground text-sm">
                    Manage devices that are logged into your account
                  </p>
                </div>
                <Button variant="outline" disabled>
                  Coming soon
                </Button>
              </div>
            </div>
          </CardContent>
        </Card>
      </TabsContent>

      <Dialog
        open={changePasswordDialogOpen}
        onOpenChange={setChangePasswordDialogOpen}
      >
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Change Password</DialogTitle>
            <DialogDescription>
              Enter your current password and choose a new one.
            </DialogDescription>
          </DialogHeader>
          <form
            onSubmit={passwordForm.handleSubmit(onPasswordSubmit)}
            className="space-y-4 mt-4"
          >
            <div className="space-y-2">
              <Label htmlFor="dialog_current_password">Current Password</Label>
              <Input
                id="dialog_current_password"
                type="password"
                placeholder="••••••••"
                {...passwordForm.register("current_password")}
              />
              {passwordForm.formState.errors.current_password && (
                <p className="text-sm text-destructive">
                  {passwordForm.formState.errors.current_password.message}
                </p>
              )}
            </div>
            <div className="space-y-2">
              <Label htmlFor="dialog_new_password">New Password</Label>
              <Input
                id="dialog_new_password"
                type="password"
                placeholder="••••••••"
                {...passwordForm.register("new_password")}
              />
              {passwordForm.formState.errors.new_password && (
                <p className="text-sm text-destructive">
                  {passwordForm.formState.errors.new_password.message}
                </p>
              )}
            </div>
            <div className="space-y-2">
              <Label htmlFor="dialog_confirm_password">Confirm Password</Label>
              <Input
                id="dialog_confirm_password"
                type="password"
                placeholder="••••••••"
                {...passwordForm.register("confirm_password")}
              />
              {passwordForm.formState.errors.confirm_password && (
                <p className="text-sm text-destructive">
                  {passwordForm.formState.errors.confirm_password.message}
                </p>
              )}
            </div>
            <DialogFooter className="mt-4">
              <DialogClose asChild>
                <Button
                  type="button"
                  variant="outline"
                  disabled={updatePasswordMutation.isPending}
                >
                  Cancel
                </Button>
              </DialogClose>
              <Button type="submit" disabled={updatePasswordMutation.isPending}>
                {updatePasswordMutation.isPending
                  ? "Updating..."
                  : "Update Password"}
              </Button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>

      <Dialog open={deleteDialogOpen} onOpenChange={setDeleteDialogOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Confirmation Required</DialogTitle>
            <DialogDescription>
              All your account data will be{" "}
              <strong>permanently deleted.</strong> If you are sure, please
              click <strong>Delete</strong> to proceed. This action cannot be
              undone.
            </DialogDescription>
          </DialogHeader>
          <DialogFooter className="mt-4">
            <DialogClose asChild>
              <Button variant="outline" disabled={deleteUserMutation.isPending}>
                Cancel
              </Button>
            </DialogClose>
            <Button
              variant="destructive"
              disabled={deleteUserMutation.isPending}
              onClick={onConfirmDelete}
            >
              {deleteUserMutation.isPending ? "Deleting..." : "Delete"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Appearance – same pattern as Notifications: Switch rows with Separator */}
      <TabsContent value="appearance" className="space-y-6">
        <Card>
          <CardHeader>
            <CardTitle>Appearance</CardTitle>
            <CardDescription>
              Choose your preferred theme for the application.
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-6">
            <div className="space-y-4">
              {THEME_OPTIONS.flatMap((option, index) => {
                const Icon = THEME_ICONS[option.value]
                const isSelected = theme === option.value
                const elements = [
                  <div
                    key={option.value}
                    className="flex items-center justify-between"
                  >
                    <div className="space-y-1">
                      <Label className="text-base">{option.label}</Label>
                      <p className="text-muted-foreground text-sm">
                        {option.description}
                      </p>
                    </div>
                    <Button
                      variant={isSelected ? "default" : "outline"}
                      size="icon"
                      onClick={() => setTheme(option.value)}
                      aria-label={`Use ${option.label} theme`}
                    >
                      <Icon className="h-4 w-4" />
                    </Button>
                  </div>,
                ]
                if (index < THEME_OPTIONS.length - 1) {
                  elements.push(<Separator key={`separator-${option.value}`} />)
                }
                return elements
              })}
            </div>
          </CardContent>
        </Card>
      </TabsContent>
    </Tabs>
  )
}
