import { zodResolver } from "@hookform/resolvers/zod"
import { useMutation, useQueryClient } from "@tanstack/react-query"
import { createFileRoute } from "@tanstack/react-router"
import {
  KeyRound,
  Loader2,
  Lock,
  Mail,
  Monitor,
  Moon,
  Palette,
  Sun,
  Trash2,
  User,
} from "lucide-react"
import * as React from "react"
import type { UseFormRegister } from "react-hook-form"
import { useForm } from "react-hook-form"
import { z } from "zod"

import { type UpdatePassword, UsersService, type UserUpdateMe } from "@/client"
import { type Theme, useTheme } from "@/components/theme-provider"
import { Avatar, AvatarFallback } from "@/components/ui/avatar"
import { Button } from "@/components/ui/button"
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
import useAuth from "@/hooks/useAuth"
import useCustomToast from "@/hooks/useCustomToast"
import { getInitials, handleError } from "@/utils"

export const Route = createFileRoute("/_layout/settings")({
  component: SettingsPage,
  head: () => ({
    meta: [
      {
        title: "Settings - LinkX",
      },
    ],
  }),
})

const profileSchema = z.object({
  full_name: z.string().min(1, "Name is required").max(100),
  email: z.string().email("Invalid email address"),
})

type ProfileFormData = z.infer<typeof profileSchema>

const passwordSchema = z
  .object({
    current_password: z
      .string()
      .min(8, "Current password must be at least 8 characters"),
    new_password: z
      .string()
      .min(8, "New password must be at least 8 characters"),
    confirm_password: z.string().min(1, "Please confirm your password"),
  })
  .refine((data) => data.new_password === data.confirm_password, {
    message: "Passwords do not match",
    path: ["confirm_password"],
  })

type PasswordFormData = z.infer<typeof passwordSchema>

function SettingsHeader() {
  return (
    <div className="border-b pb-5">
      <h1 className="text-2xl font-bold tracking-tight">Settings</h1>
      <p className="text-muted-foreground text-sm mt-0.5">
        Manage your profile details, interface theme, and account security.
      </p>
    </div>
  )
}

interface SettingsInputProps {
  id: string
  label: string
  type?: string
  placeholder: string
  icon: typeof User
  register: UseFormRegister<any>
  error?: string
}

function SettingsInput({
  id,
  label,
  type = "text",
  placeholder,
  icon: Icon,
  register,
  error,
}: SettingsInputProps) {
  return (
    <div className="space-y-1.5">
      <Label
        htmlFor={id}
        className="text-xs font-medium text-muted-foreground flex items-center gap-1.5 pl-0.5"
      >
        <Icon className="h-3.5 w-3.5" /> {label}
      </Label>
      <Input
        id={id}
        type={type}
        {...register(id)}
        placeholder={placeholder}
        className="h-9 rounded-xl bg-muted/20 border-border/60 text-xs sm:text-sm focus:ring-1 focus:ring-primary px-3.5"
      />
      {error && <p className="text-[11px] text-destructive pl-1">{error}</p>}
    </div>
  )
}

interface ProfileCardProps {
  currentUser: any
  onUpdateProfile: (data: ProfileFormData) => void
  isUpdating: boolean
}

function ProfileCard({
  currentUser,
  onUpdateProfile,
  isUpdating,
}: ProfileCardProps) {
  const defaultFullName = currentUser?.full_name ?? ""
  const defaultEmail = currentUser?.email ?? ""
  const initials = getInitials(defaultFullName || "User")

  const {
    register,
    handleSubmit,
    formState: { errors, isDirty },
    reset,
  } = useForm<ProfileFormData>({
    resolver: zodResolver(profileSchema),
    defaultValues: {
      full_name: defaultFullName,
      email: defaultEmail,
    },
  })

  React.useEffect(() => {
    reset({
      full_name: defaultFullName,
      email: defaultEmail,
    })
  }, [defaultFullName, defaultEmail, reset])

  return (
    <div className="w-full rounded-2xl border border-border/80 bg-background p-4 sm:p-6 space-y-5">
      <div className="flex items-center justify-between gap-4">
        <div className="flex items-center gap-3.5 min-w-0">
          <Avatar className="h-10 w-10 shrink-0">
            <AvatarFallback className="bg-primary/10 text-primary font-bold text-sm">
              {initials}
            </AvatarFallback>
          </Avatar>
          <div className="min-w-0">
            <h2 className="font-semibold text-sm">Profile Details</h2>
            <p className="text-xs text-muted-foreground mt-0.5 truncate">
              Manage your display name and contact email.
            </p>
          </div>
        </div>

        <Button
          type="submit"
          form="profile-form"
          disabled={!isDirty || isUpdating}
          size="sm"
          className="h-8 px-4 text-xs font-bold rounded-full bg-white text-black hover:bg-white/95 border border-zinc-200/90 shadow-2xs hover:shadow-sm transition-all duration-200 ease-[cubic-bezier(0.16,1,0.3,1)] hover:scale-[1.03] active:scale-95 cursor-pointer disabled:opacity-50 disabled:hover:scale-100 shrink-0"
        >
          {isUpdating ? (
            <span className="flex items-center gap-1.5">
              <Loader2 className="h-3.5 w-3.5 animate-spin text-black" />{" "}
              Saving…
            </span>
          ) : (
            "Save"
          )}
        </Button>
      </div>

      <form id="profile-form" onSubmit={handleSubmit(onUpdateProfile)}>
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
          <SettingsInput
            id="full_name"
            label="Full Name"
            placeholder="Your full name"
            icon={User}
            register={register}
            error={errors.full_name?.message}
          />
          <SettingsInput
            id="email"
            label="Email Address"
            type="email"
            placeholder="you@example.com"
            icon={Mail}
            register={register}
            error={errors.email?.message}
          />
        </div>
      </form>
    </div>
  )
}

const THEME_OPTIONS: { id: Theme; label: string; icon: typeof Sun }[] = [
  { id: "light", label: "Light theme", icon: Sun },
  { id: "dark", label: "Dark theme", icon: Moon },
  { id: "system", label: "System theme", icon: Monitor },
]

function AppearanceRow() {
  const { theme, setTheme } = useTheme()

  return (
    <div className="flex items-center justify-between gap-4 p-4 sm:p-6 hover:bg-muted/5 transition-colors">
      <div className="flex items-center gap-3.5 min-w-0">
        <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-muted/50 text-foreground">
          <Palette className="h-5 w-5" />
        </div>
        <div className="min-w-0">
          <span className="font-semibold text-sm">Appearance</span>
          <p className="text-xs text-muted-foreground mt-0.5 truncate">
            Customize the color theme across all LinkX pages.
          </p>
        </div>
      </div>

      <fieldset
        className="relative inline-flex items-center rounded-full bg-muted/40 p-0.5 border border-border/60 select-none shrink-0"
        aria-label="Theme Selection"
      >
        {THEME_OPTIONS.map((opt) => {
          const Icon = opt.icon
          const isSelected = theme === opt.id

          return (
            <button
              key={opt.id}
              type="button"
              title={opt.label}
              aria-label={opt.label}
              onClick={() => setTheme(opt.id)}
              className={`flex items-center justify-center h-7 w-7 rounded-full transition-all cursor-pointer ${
                isSelected
                  ? "bg-background text-foreground shadow-xs"
                  : "text-muted-foreground hover:text-foreground"
              }`}
            >
              <Icon className="h-3.5 w-3.5" />
            </button>
          )
        })}
      </fieldset>
    </div>
  )
}

interface SettingsActionRowProps {
  title: string
  description: string
  icon: typeof KeyRound
  buttonText: string
  onAction: () => void
  isDestructive?: boolean
}

function SettingsActionRow({
  title,
  description,
  icon: Icon,
  buttonText,
  onAction,
  isDestructive = false,
}: SettingsActionRowProps) {
  const containerClass = isDestructive
    ? "bg-destructive/5 hover:bg-destructive/10"
    : "hover:bg-muted/5"
  const iconClass = isDestructive
    ? "bg-destructive/15 text-destructive"
    : "bg-muted/50 text-foreground"
  const titleClass = isDestructive ? "text-destructive" : ""
  const descClass = isDestructive
    ? "text-destructive/80"
    : "text-muted-foreground"
  const buttonClass = isDestructive
    ? "border-destructive/40 text-destructive bg-destructive/10 hover:bg-destructive hover:text-white"
    : "border-border/80 hover:bg-muted/40"

  return (
    <div
      className={`flex items-center justify-between gap-4 p-4 sm:p-6 transition-colors ${containerClass}`}
    >
      <div className="flex items-center gap-3.5 min-w-0">
        <div
          className={`flex h-10 w-10 shrink-0 items-center justify-center rounded-xl ${iconClass}`}
        >
          <Icon className="h-5 w-5" />
        </div>
        <div className="min-w-0">
          <span className={`font-semibold text-sm ${titleClass}`}>{title}</span>
          <p className={`text-xs mt-0.5 truncate ${descClass}`}>
            {description}
          </p>
        </div>
      </div>

      <Button
        type="button"
        variant="outline"
        size="sm"
        onClick={onAction}
        className={`h-8 px-4 text-xs font-bold rounded-full shadow-none cursor-pointer shrink-0 transition-colors ${buttonClass}`}
      >
        {buttonText}
      </Button>
    </div>
  )
}

function ChangePasswordDialog({
  open,
  onOpenChange,
  onUpdatePassword,
  isUpdating,
}: {
  open: boolean
  onOpenChange: (open: boolean) => void
  onUpdatePassword: (data: PasswordFormData) => void
  isUpdating: boolean
}) {
  const {
    register,
    handleSubmit,
    formState: { errors },
    reset,
  } = useForm<PasswordFormData>({
    resolver: zodResolver(passwordSchema),
  })

  const onSubmit = (data: PasswordFormData) => {
    onUpdatePassword(data)
    reset()
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>Change Password</DialogTitle>
          <DialogDescription>
            Enter your current password and choose a new secure password.
          </DialogDescription>
        </DialogHeader>

        <form onSubmit={handleSubmit(onSubmit)} className="space-y-3.5 mt-2">
          <SettingsInput
            id="current_password"
            label="Current Password"
            type="password"
            placeholder="••••••••"
            icon={Lock}
            register={register}
            error={errors.current_password?.message}
          />
          <SettingsInput
            id="new_password"
            label="New Password"
            type="password"
            placeholder="••••••••"
            icon={Lock}
            register={register}
            error={errors.new_password?.message}
          />
          <SettingsInput
            id="confirm_password"
            label="Confirm Password"
            type="password"
            placeholder="••••••••"
            icon={Lock}
            register={register}
            error={errors.confirm_password?.message}
          />

          <DialogFooter className="mt-5">
            <DialogClose asChild>
              <Button
                type="button"
                variant="outline"
                disabled={isUpdating}
                className="rounded-full cursor-pointer"
              >
                Cancel
              </Button>
            </DialogClose>
            <Button
              type="submit"
              disabled={isUpdating}
              className="rounded-full cursor-pointer"
            >
              {isUpdating ? "Updating…" : "Update Password"}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  )
}

function DeleteAccountDialog({
  open,
  onOpenChange,
  onConfirm,
  isDeleting,
}: {
  open: boolean
  onOpenChange: (open: boolean) => void
  onConfirm: () => void
  isDeleting: boolean
}) {
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle className="text-destructive">Delete Account</DialogTitle>
          <DialogDescription>
            Are you sure you want to delete your account? All your posts,
            connected sessions, and profile settings will be permanently
            deleted. This action cannot be undone.
          </DialogDescription>
        </DialogHeader>
        <DialogFooter className="mt-4">
          <DialogClose asChild>
            <Button
              variant="outline"
              disabled={isDeleting}
              className="rounded-full cursor-pointer"
            >
              Cancel
            </Button>
          </DialogClose>
          <Button
            variant="destructive"
            onClick={onConfirm}
            disabled={isDeleting}
            className="rounded-full cursor-pointer"
          >
            {isDeleting ? "Deleting…" : "Yes, Delete My Account"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}

function useSettingsActions() {
  const { logout } = useAuth()
  const { showSuccessToast, showErrorToast } = useCustomToast()
  const queryClient = useQueryClient()
  const [passwordDialogOpen, setPasswordDialogOpen] = React.useState(false)

  const updateProfileMutation = useMutation({
    mutationFn: (data: UserUpdateMe) =>
      UsersService.updateUserMe({ requestBody: data }),
    onSuccess: () => {
      showSuccessToast("Profile information updated.")
      queryClient.invalidateQueries({ queryKey: ["currentUser"] })
    },
    onError: handleError.bind(showErrorToast),
  })

  const updatePasswordMutation = useMutation({
    mutationFn: (data: UpdatePassword) =>
      UsersService.updatePasswordMe({ requestBody: data }),
    onSuccess: () => {
      showSuccessToast("Password updated successfully.")
      setPasswordDialogOpen(false)
    },
    onError: handleError.bind(showErrorToast),
  })

  const deleteAccountMutation = useMutation({
    mutationFn: () => UsersService.deleteUserMe(),
    onSuccess: () => {
      showSuccessToast("Your account has been deleted.")
      logout()
    },
    onError: handleError.bind(showErrorToast),
  })

  return {
    passwordDialogOpen,
    setPasswordDialogOpen,
    updateProfileMutation,
    updatePasswordMutation,
    deleteAccountMutation,
  }
}

export function SettingsPage() {
  const { user } = useAuth()
  const [deleteDialogOpen, setDeleteDialogOpen] = React.useState(false)
  const {
    passwordDialogOpen,
    setPasswordDialogOpen,
    updateProfileMutation,
    updatePasswordMutation,
    deleteAccountMutation,
  } = useSettingsActions()

  const handleUpdateProfile = (data: ProfileFormData) => {
    const payload: UserUpdateMe = {}
    if (data.full_name !== user?.full_name) payload.full_name = data.full_name
    if (data.email !== user?.email) payload.email = data.email
    if (Object.keys(payload).length > 0) {
      updateProfileMutation.mutate(payload)
    }
  }

  return (
    <div className="container max-w-3xl mx-auto px-4 py-8 space-y-6">
      <SettingsHeader />

      <ProfileCard
        currentUser={user}
        onUpdateProfile={handleUpdateProfile}
        isUpdating={updateProfileMutation.isPending}
      />

      <div className="w-full rounded-2xl border border-border/80 bg-background overflow-hidden shadow-none divide-y divide-border/40">
        <AppearanceRow />

        <SettingsActionRow
          title="Security"
          description="Update your account password."
          icon={KeyRound}
          buttonText="Change Password"
          onAction={() => setPasswordDialogOpen(true)}
        />

        <SettingsActionRow
          title="Danger Zone"
          description="Permanently delete your account and all associated post records."
          icon={Trash2}
          buttonText="Delete Account"
          onAction={() => setDeleteDialogOpen(true)}
          isDestructive
        />
      </div>

      <ChangePasswordDialog
        open={passwordDialogOpen}
        onOpenChange={setPasswordDialogOpen}
        onUpdatePassword={(data) => updatePasswordMutation.mutate(data)}
        isUpdating={updatePasswordMutation.isPending}
      />

      <DeleteAccountDialog
        open={deleteDialogOpen}
        onOpenChange={setDeleteDialogOpen}
        onConfirm={() => deleteAccountMutation.mutate()}
        isDeleting={deleteAccountMutation.isPending}
      />
    </div>
  )
}

export default SettingsPage
