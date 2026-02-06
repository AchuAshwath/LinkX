import { createFileRoute } from "@tanstack/react-router"
import { ExternalLink, Linkedin, MoreHorizontal, Plus, Twitter } from "lucide-react"
import * as React from "react"

import { OpenAPI } from "@/client"
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar"
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
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog"
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select"
import { Separator } from "@/components/ui/separator"
import { Switch } from "@/components/ui/switch"
import { Textarea } from "@/components/ui/textarea"
import useCustomToast from "@/hooks/useCustomToast"

type LinkedInProfile = {
  display_name?: string | null
  email?: string | null
  profile_picture_url?: string | null
}

type Workspace = {
  id: string
  name: string
}

type Persona = {
  id: string
  name: string
  description: string
  visibleToWorkspace: boolean
  createdAt: string
  updatedAt: string
}

type SocialPlatform = "linkedin" | "x"

type SocialAccount = {
  id: string
  personaId: string
  platform: SocialPlatform
  displayName: string | null
  email: string | null
  profilePictureUrl: string | null
  status: "connected" | "not_connected" | "reconnect_required" | "error"
  updatedAt: string
}

export const Route = createFileRoute("/_layout/social-accounts")({
  component: SocialAccountsPage,
  head: () => ({
    meta: [
      {
        title: "Social Accounts - LinkX",
      },
    ],
  }),
})

function SocialAccountsPage() {
  const { showErrorToast, showSuccessToast } = useCustomToast()

  const workspace: Workspace = React.useMemo(
    () => ({
      id: "ws_default",
      name: "My Workspace",
    }),
    []
  )

  const [personas, setPersonas] = React.useState<Persona[]>(() => {
    const now = new Date().toISOString()
    return [
      {
        id: "persona_1",
        name: "Personal",
        description: "My default voice for personal posts and experiments.",
        visibleToWorkspace: false,
        createdAt: now,
        updatedAt: now,
      },
      {
        id: "persona_2",
        name: "LinkX",
        description: "Company voice for product updates and announcements.",
        visibleToWorkspace: true,
        createdAt: now,
        updatedAt: now,
      },
    ]
  })
  const [socialAccounts, setSocialAccounts] = React.useState<SocialAccount[]>(() => {
    const now = new Date().toISOString()
    return [
      {
        id: "sa_1",
        personaId: "persona_2",
        platform: "linkedin",
        displayName: "LinkX (mock)",
        email: "team@linkx.dev",
        profilePictureUrl: null,
        status: "connected",
        updatedAt: now,
      },
    ]
  })
  const [selectedPersonaId, setSelectedPersonaId] = React.useState<string>(
    () => personas[0]?.id ?? ""
  )

  const selectedPersona = React.useMemo(
    () => personas.find((p) => p.id === selectedPersonaId) ?? null,
    [personas, selectedPersonaId]
  )

  React.useEffect(() => {
    if (!selectedPersonaId && personas.length > 0) {
      setSelectedPersonaId(personas[0].id)
    }
  }, [personas, selectedPersonaId])

  const [createPersonaOpen, setCreatePersonaOpen] = React.useState(false)
  const [editPersonaOpen, setEditPersonaOpen] = React.useState(false)
  const [deletePersonaOpen, setDeletePersonaOpen] = React.useState(false)
  const [disconnectAccountOpen, setDisconnectAccountOpen] = React.useState(false)
  const [disconnectTarget, setDisconnectTarget] = React.useState<SocialPlatform | null>(
    null
  )

  const [personaDraft, setPersonaDraft] = React.useState<{
    name: string
    description: string
    visibleToWorkspace: boolean
  }>({
    name: "",
    description: "",
    visibleToWorkspace: false,
  })
  const [deleteConfirmText, setDeleteConfirmText] = React.useState("")

  const [connecting, setConnecting] = React.useState(false)
  const [lastStatus, setLastStatus] = React.useState<
    "idle" | "connected" | "error"
  >("idle")
  const [needsReconnect, setNeedsReconnect] = React.useState(false)
  const [profile, setProfile] = React.useState<LinkedInProfile | null>(null)
  const [statusLoading, setStatusLoading] = React.useState(true)

  React.useEffect(() => {
    const params = new URLSearchParams(window.location.search)
    const linkedin = params.get("linkedin")
    if (linkedin === "connected") setLastStatus("connected")
    if (linkedin === "error") setLastStatus("error")
    if (params.has("linkedin")) {
      params.delete("linkedin")
      const search = params.toString()
      const url = `${window.location.pathname}${search ? `?${search}` : ""}`
      window.history.replaceState({}, "", url)
    }
  }, [])

  React.useEffect(() => {
    const run = async () => {
      setStatusLoading(true)
      try {
        const res = await fetch(`${OpenAPI.BASE}/api/v1/linkedin/status`, {
          method: "GET",
          headers: {
            Authorization: `Bearer ${localStorage.getItem("access_token") || ""}`,
          },
        })
        if (!res.ok) {
          showErrorToast("Could not load connection status. Try again or re-login.")
          setLastStatus((prev) => (prev === "error" ? "error" : "idle"))
          return
        }
        const data = (await res.json()) as {
          connected: boolean
          needs_reconnect: boolean
          profile: LinkedInProfile | null
        }
        setNeedsReconnect(Boolean(data.needs_reconnect))
        setProfile(data.profile ?? null)
        setLastStatus(
          data.connected ? "connected" : (prev) => (prev === "error" ? "error" : "idle"),
        )
      } catch {
        showErrorToast("Could not load connection status. Try again or re-login.")
        setLastStatus((prev) => (prev === "error" ? "error" : "idle"))
      } finally {
        setStatusLoading(false)
      }
    }
    run()
  }, [])

  const resetPersonaDraft = React.useCallback(() => {
    setPersonaDraft({
      name: "",
      description: "",
      visibleToWorkspace: false,
    })
  }, [])

  const openCreatePersona = React.useCallback(() => {
    resetPersonaDraft()
    setCreatePersonaOpen(true)
  }, [resetPersonaDraft])

  const openEditPersona = React.useCallback(() => {
    if (!selectedPersona) {
      showErrorToast("Select a persona to edit.")
      return
    }
    setPersonaDraft({
      name: selectedPersona.name,
      description: selectedPersona.description,
      visibleToWorkspace: selectedPersona.visibleToWorkspace,
    })
    setEditPersonaOpen(true)
  }, [selectedPersona, showErrorToast])

  const openDeletePersona = React.useCallback(() => {
    if (!selectedPersona) {
      showErrorToast("Select a persona to delete.")
      return
    }
    setDeleteConfirmText("")
    setDeletePersonaOpen(true)
  }, [selectedPersona, showErrorToast])

  const personaNameError = React.useMemo(() => {
    const name = personaDraft.name.trim()
    if (!name) return "Name is required."
    if (name.length > 255) return "Name must be 255 characters or fewer."
    return null
  }, [personaDraft.name])

  const personaDescriptionError = React.useMemo(() => {
    const description = personaDraft.description.trim()
    if (description.length > 500) return "Description must be 500 characters or fewer."
    return null
  }, [personaDraft.description])

  const saveNewPersona = React.useCallback(() => {
    const name = personaDraft.name.trim()
    const description = personaDraft.description.trim()
    if (!name) return
    if (name.length > 255) return
    if (description.length > 500) return

    const now = new Date().toISOString()
    const newPersona: Persona = {
      id:
        typeof crypto !== "undefined" && "randomUUID" in crypto
          ? `persona_${crypto.randomUUID()}`
          : `persona_${now}`,
      name,
      description,
      visibleToWorkspace: personaDraft.visibleToWorkspace,
      createdAt: now,
      updatedAt: now,
    }
    setPersonas((prev) => [newPersona, ...prev])
    setSelectedPersonaId(newPersona.id)
    setCreatePersonaOpen(false)
    showSuccessToast(`Created persona “${newPersona.name}”.`)
  }, [personaDraft, showSuccessToast])

  const saveEditedPersona = React.useCallback(() => {
    if (!selectedPersona) return
    const name = personaDraft.name.trim()
    const description = personaDraft.description.trim()
    if (!name) return
    if (name.length > 255) return
    if (description.length > 500) return

    setPersonas((prev) =>
      prev.map((p) =>
        p.id === selectedPersona.id
          ? {
              ...p,
              name,
              description,
              visibleToWorkspace: personaDraft.visibleToWorkspace,
              updatedAt: new Date().toISOString(),
            }
          : p
      )
    )
    setEditPersonaOpen(false)
    showSuccessToast(`Updated persona “${name}”.`)
  }, [personaDraft, selectedPersona, showSuccessToast])

  const confirmDeletePersona = React.useCallback(() => {
    if (!selectedPersona) return
    if (deleteConfirmText.trim() !== selectedPersona.name.trim()) return

    setPersonas((prev) => {
      const next = prev.filter((p) => p.id !== selectedPersona.id)
      if (next.length > 0 && !next.some((p) => p.id === selectedPersonaId)) {
        setSelectedPersonaId(next[0].id)
      }
      if (next.length === 0) {
        setSelectedPersonaId("")
      }
      return next
    })
    setSocialAccounts((prev) => prev.filter((a) => a.personaId !== selectedPersona.id))
    setDeletePersonaOpen(false)
    showSuccessToast(`Deleted persona “${selectedPersona.name}”.`)
  }, [deleteConfirmText, selectedPersona, selectedPersonaId, showSuccessToast])

  const openDisconnectAccount = React.useCallback(
    (platform: SocialPlatform) => {
      if (!selectedPersona) {
        showErrorToast("Select a persona first.")
        return
      }
      setDisconnectTarget(platform)
      setDisconnectAccountOpen(true)
    },
    [selectedPersona, showErrorToast]
  )

  const confirmDisconnectAccount = React.useCallback(() => {
    if (!selectedPersona || !disconnectTarget) return
    setSocialAccounts((prev) =>
      prev.filter(
        (a) => !(a.personaId === selectedPersona.id && a.platform === disconnectTarget)
      )
    )
    setDisconnectAccountOpen(false)
    showSuccessToast(
      `Disconnected ${disconnectTarget === "linkedin" ? "LinkedIn" : "X"} for “${selectedPersona.name}”.`
    )
  }, [disconnectTarget, selectedPersona, showSuccessToast])

  const handleConnectLinkedIn = async () => {
    if (!OpenAPI.BASE) {
      showErrorToast("API URL not set. Set VITE_API_URL in frontend .env (e.g. http://localhost:8000).")
      return
    }
    try {
      setConnecting(true)
      const res = await fetch(
        `${OpenAPI.BASE}/api/v1/auth/linkedin/authorize`,
        {
          method: "GET",
          headers: {
            Authorization: `Bearer ${localStorage.getItem("access_token") || ""}`,
          },
        },
      )
      if (!res.ok) {
        await res.text()
        let detail = "Failed to start LinkedIn OAuth"
        try {
          const configRes = await fetch(`${OpenAPI.BASE}/api/v1/auth/linkedin/config-check`)
          if (configRes.ok) {
            const config = (await configRes.json()) as {
              configured: boolean
              redirect_uri_masked: string
              hint: string
            }
            if (!config.configured) detail = "LinkedIn not configured in backend. " + (config.hint ?? "")
            else detail = `OAuth failed (${res.status}). ${config.hint ?? ""}`
          }
        } catch {
          // ignore config-check failure
        }
        throw new Error(detail)
      }
      const data = (await res.json()) as { authorize_url: string }
      if (!data.authorize_url) {
        throw new Error("No authorize_url in response")
      }
      window.location.href = data.authorize_url
    } catch (e) {
      const message = e instanceof Error ? e.message : "Could not start LinkedIn OAuth. See docs/LINKEDIN_SETUP.md."
      showErrorToast(message)
      setConnecting(false)
    }
  }

  const linkedInConnected =
    !statusLoading && (lastStatus === "connected" || (profile && !needsReconnect))
  const linkedInStatusBadge = statusLoading ? (
    <Badge variant="secondary" className="font-normal">
      Loading…
    </Badge>
  ) : linkedInConnected ? (
    <Badge
      variant="outline"
      className="border-green-200 bg-green-50 text-green-700 dark:border-green-800 dark:bg-green-950 dark:text-green-400"
    >
      Connected
    </Badge>
  ) : needsReconnect ? (
    <Badge variant="secondary" className="font-normal">
      Reconnect required
    </Badge>
  ) : (
    <Badge variant="secondary" className="font-normal">
      Not connected
    </Badge>
  )

  const personaVisibilityBadge = selectedPersona?.visibleToWorkspace ? (
    <Badge
      variant="outline"
      className="border-blue-200 bg-blue-50 text-blue-700 dark:border-blue-900 dark:bg-blue-950 dark:text-blue-300"
    >
      Workspace-visible
    </Badge>
  ) : (
    <Badge variant="secondary" className="font-normal">
      Private
    </Badge>
  )

  const personaLinkedInAccount = selectedPersona
    ? socialAccounts.find(
        (a) => a.personaId === selectedPersona.id && a.platform === "linkedin"
      ) ?? null
    : null

  const personaXAccount = selectedPersona
    ? socialAccounts.find((a) => a.personaId === selectedPersona.id && a.platform === "x") ??
      null
    : null

  return (
    <div className="container mx-auto space-y-6 px-4 py-6 sm:px-6 md:py-10">
      <Card>
        <CardHeader className="pb-2 sm:pb-3">
          <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
            <div className="space-y-1">
              <CardTitle asChild>
                <h1 className="text-2xl font-bold tracking-tight">
                  Social accounts
                </h1>
              </CardTitle>
              <CardDescription>
                Manage connected accounts for personas inside {workspace.name}.
              </CardDescription>
            </div>
            <Button type="button" size="sm" onClick={openCreatePersona}>
              <Plus className="mr-2 h-4 w-4" />
              New persona
            </Button>
          </div>
        </CardHeader>
        <CardContent className="pt-0">
          <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
            <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:gap-3">
              <div className="space-y-1">
                <Label className="text-sm">Persona in {workspace.name}</Label>
                <Select value={selectedPersonaId} onValueChange={setSelectedPersonaId}>
                  <SelectTrigger className="w-full sm:w-[280px]">
                    <SelectValue placeholder="Select a persona" />
                  </SelectTrigger>
                  <SelectContent align="start">
                    {personas.map((p) => (
                      <SelectItem key={p.id} value={p.id}>
                        {p.name}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>

              <div className="flex items-center gap-2 pt-1 sm:pt-5">
                {selectedPersona ? personaVisibilityBadge : null}
              </div>
            </div>

            <div className="flex items-center justify-end gap-2 pt-2 sm:pt-5">
              <DropdownMenu>
                <DropdownMenuTrigger asChild>
                  <Button type="button" variant="outline" size="sm" disabled={!selectedPersona}>
                    <MoreHorizontal className="mr-2 h-4 w-4" />
                    Manage
                  </Button>
                </DropdownMenuTrigger>
                <DropdownMenuContent align="end">
                  <DropdownMenuLabel>Persona actions</DropdownMenuLabel>
                  <DropdownMenuSeparator />
                  <DropdownMenuItem onSelect={openEditPersona}>Edit persona</DropdownMenuItem>
                  <DropdownMenuItem onSelect={openDeletePersona} variant="destructive">
                    Delete persona
                  </DropdownMenuItem>
                </DropdownMenuContent>
              </DropdownMenu>
            </div>
          </div>

          {!selectedPersona ? (
            <div className="mt-6 rounded-lg border bg-muted/30 p-4">
              <p className="text-sm text-muted-foreground">
                Create a persona to start connecting social accounts.
              </p>
            </div>
          ) : (
            <div className="mt-6 grid gap-4 md:grid-cols-3">
              <div className="md:col-span-1 rounded-lg border bg-muted/40">
                <div className="border-b px-4 py-3">
                  <p className="text-sm font-medium leading-none">
                    {selectedPersona.name}
                  </p>
                  <p className="mt-1 text-xs text-muted-foreground">
                    {selectedPersona.description || "No description"}
                  </p>
                </div>
                <div className="space-y-4 px-4 py-3">
                  <div className="flex items-center justify-between gap-4">
                    <div className="space-y-0.5">
                      <p className="text-sm font-medium leading-none">
                        Visible to workspace
                      </p>
                      <p className="text-xs text-muted-foreground">
                        When enabled, this persona appears for your team in the UI.
                      </p>
                    </div>
                    <Switch
                      checked={selectedPersona.visibleToWorkspace}
                      onCheckedChange={(checked) => {
                        setPersonas((prev) =>
                          prev.map((p) =>
                            p.id === selectedPersona.id
                              ? {
                                  ...p,
                                  visibleToWorkspace: checked,
                                  updatedAt: new Date().toISOString(),
                                }
                              : p
                          )
                        )
                        showSuccessToast(
                          checked
                            ? "Persona is now workspace-visible."
                            : "Persona is now private."
                        )
                      }}
                    />
                  </div>

                  <Separator />

                  <div className="space-y-1">
                    <p className="text-xs text-muted-foreground">Quick stats</p>
                    <div className="flex flex-wrap gap-2">
                      <Badge variant="secondary" className="font-normal">
                        1 platform supported
                      </Badge>
                      <Badge variant="secondary" className="font-normal">
                        LinkedIn ready
                      </Badge>
                    </div>
                  </div>
                </div>
              </div>

              <div className="md:col-span-2">
                <Card>
                  <CardHeader>
                    <CardTitle>Social accounts for {selectedPersona.name}</CardTitle>
                    <CardDescription>
                      Connect accounts to publish and schedule posts as this persona.
                    </CardDescription>
                  </CardHeader>
                  <CardContent className="space-y-0">
                    {/* LinkedIn */}
                    <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
                      <div className="flex items-center gap-4 min-w-0">
                        {profile?.profile_picture_url || personaLinkedInAccount?.profilePictureUrl ? (
                          <Avatar className="h-12 w-12 shrink-0">
                            <AvatarImage
                              src={
                                profile?.profile_picture_url ??
                                personaLinkedInAccount?.profilePictureUrl ??
                                ""
                              }
                              alt={
                                profile?.display_name ??
                                personaLinkedInAccount?.displayName ??
                                "LinkedIn"
                              }
                            />
                            <AvatarFallback className="text-sm">LI</AvatarFallback>
                          </Avatar>
                        ) : (
                          <div className="flex h-12 w-12 shrink-0 items-center justify-center rounded-xl bg-[#0A66C2]/10">
                            <Linkedin className="h-6 w-6 text-[#0A66C2]" aria-hidden />
                          </div>
                        )}
                        <div className="space-y-1 min-w-0">
                          <Label className="text-base">LinkedIn</Label>
                          {profile?.display_name || personaLinkedInAccount?.displayName ? (
                            <p className="text-muted-foreground text-sm truncate">
                              {profile?.display_name ?? personaLinkedInAccount?.displayName}
                              {(profile?.email ?? personaLinkedInAccount?.email)
                                ? ` · ${profile?.email ?? personaLinkedInAccount?.email}`
                                : ""}
                              <span className="text-muted-foreground/70">
                                {" "}
                                · for {selectedPersona.name}
                              </span>
                            </p>
                          ) : (
                            <p className="text-muted-foreground text-sm">
                              Connect your LinkedIn account to publish and schedule posts.
                            </p>
                          )}
                        </div>
                      </div>
                      <div className="flex items-center gap-3 shrink-0">
                        {linkedInStatusBadge}
                        <Button
                          type="button"
                          variant={linkedInConnected ? "outline" : "default"}
                          size="sm"
                          onClick={handleConnectLinkedIn}
                          disabled={connecting}
                        >
                          <ExternalLink className="mr-2 h-4 w-4" />
                          {needsReconnect ? "Reconnect" : linkedInConnected ? "Manage" : "Connect"}
                        </Button>
                        <Button
                          type="button"
                          variant="outline"
                          size="sm"
                          onClick={() => openDisconnectAccount("linkedin")}
                          disabled={!personaLinkedInAccount}
                        >
                          Disconnect
                        </Button>
                      </div>
                    </div>

                    {lastStatus === "error" && (
                      <p className="mt-2 text-xs text-muted-foreground">
                        Ensure redirect URI and scopes match the{" "}
                        <a
                          href="https://www.linkedin.com/developers/"
                          target="_blank"
                          rel="noopener noreferrer"
                          className="underline hover:text-foreground"
                        >
                          LinkedIn Developer Portal
                        </a>
                        . See project docs/LINKEDIN_SETUP.md for setup.
                      </p>
                    )}

                    <Separator className="my-6" />

                    {/* X (Twitter) */}
                    <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
                      <div className="flex items-center gap-4 min-w-0">
                        <div className="flex h-12 w-12 shrink-0 items-center justify-center rounded-xl bg-muted">
                          <Twitter className="h-6 w-6 text-muted-foreground" aria-hidden />
                        </div>
                        <div className="space-y-1 min-w-0">
                          <Label className="text-base">X (Twitter)</Label>
                          <p className="text-muted-foreground text-sm">
                            Coming soon. We’ll add X OAuth once the backend flow is ready.
                          </p>
                        </div>
                      </div>
                      <div className="flex items-center gap-3 shrink-0">
                        <Badge variant="secondary" className="font-normal">
                          Coming soon
                        </Badge>
                        <Button type="button" variant="outline" size="sm" disabled>
                          <ExternalLink className="mr-2 h-4 w-4" />
                          Connect
                        </Button>
                        <Button
                          type="button"
                          variant="outline"
                          size="sm"
                          onClick={() => openDisconnectAccount("x")}
                          disabled={!personaXAccount}
                        >
                          Disconnect
                        </Button>
                      </div>
                    </div>
                  </CardContent>
                </Card>
              </div>
            </div>
          )}
        </CardContent>
      </Card>

      <Dialog open={createPersonaOpen} onOpenChange={setCreatePersonaOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Create persona</DialogTitle>
            <DialogDescription>
              Personas let you connect accounts and publish with different voices.
            </DialogDescription>
          </DialogHeader>

          <div className="space-y-4">
            <div className="space-y-2">
              <Label htmlFor="persona-create-name">Name</Label>
              <Input
                id="persona-create-name"
                value={personaDraft.name}
                onChange={(e) => setPersonaDraft((d) => ({ ...d, name: e.target.value }))}
                placeholder="e.g. Founder, LinkX, Personal"
                aria-invalid={Boolean(personaNameError)}
              />
              {personaNameError ? (
                <p className="text-xs text-destructive">{personaNameError}</p>
              ) : null}
            </div>

            <div className="space-y-2">
              <Label htmlFor="persona-create-description">Description</Label>
              <Textarea
                id="persona-create-description"
                value={personaDraft.description}
                onChange={(e) =>
                  setPersonaDraft((d) => ({ ...d, description: e.target.value }))
                }
                placeholder="What is this persona used for?"
                aria-invalid={Boolean(personaDescriptionError)}
              />
              {personaDescriptionError ? (
                <p className="text-xs text-destructive">{personaDescriptionError}</p>
              ) : (
                <p className="text-xs text-muted-foreground">
                  Optional. Up to 500 characters.
                </p>
              )}
            </div>

            <div className="flex items-center justify-between gap-4 rounded-lg border p-3">
              <div className="space-y-0.5">
                <p className="text-sm font-medium leading-none">
                  Visible to workspace
                </p>
                <p className="text-xs text-muted-foreground">
                  If enabled, this persona will show up for your team in the UI.
                </p>
              </div>
              <Switch
                checked={personaDraft.visibleToWorkspace}
                onCheckedChange={(checked) =>
                  setPersonaDraft((d) => ({ ...d, visibleToWorkspace: checked }))
                }
              />
            </div>
          </div>

          <DialogFooter>
            <Button type="button" variant="outline" onClick={() => setCreatePersonaOpen(false)}>
              Cancel
            </Button>
            <Button
              type="button"
              onClick={saveNewPersona}
              disabled={Boolean(personaNameError || personaDescriptionError)}
            >
              Create
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog open={editPersonaOpen} onOpenChange={setEditPersonaOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Edit persona</DialogTitle>
            <DialogDescription>
              Update persona details and visibility within {workspace.name}.
            </DialogDescription>
          </DialogHeader>

          <div className="space-y-4">
            <div className="space-y-2">
              <Label htmlFor="persona-edit-name">Name</Label>
              <Input
                id="persona-edit-name"
                value={personaDraft.name}
                onChange={(e) => setPersonaDraft((d) => ({ ...d, name: e.target.value }))}
                aria-invalid={Boolean(personaNameError)}
              />
              {personaNameError ? (
                <p className="text-xs text-destructive">{personaNameError}</p>
              ) : null}
            </div>

            <div className="space-y-2">
              <Label htmlFor="persona-edit-description">Description</Label>
              <Textarea
                id="persona-edit-description"
                value={personaDraft.description}
                onChange={(e) =>
                  setPersonaDraft((d) => ({ ...d, description: e.target.value }))
                }
                aria-invalid={Boolean(personaDescriptionError)}
              />
              {personaDescriptionError ? (
                <p className="text-xs text-destructive">{personaDescriptionError}</p>
              ) : (
                <p className="text-xs text-muted-foreground">
                  Optional. Up to 500 characters.
                </p>
              )}
            </div>

            <div className="flex items-center justify-between gap-4 rounded-lg border p-3">
              <div className="space-y-0.5">
                <p className="text-sm font-medium leading-none">
                  Visible to workspace
                </p>
                <p className="text-xs text-muted-foreground">
                  If enabled, this persona will show up for your team in the UI.
                </p>
              </div>
              <Switch
                checked={personaDraft.visibleToWorkspace}
                onCheckedChange={(checked) =>
                  setPersonaDraft((d) => ({ ...d, visibleToWorkspace: checked }))
                }
              />
            </div>
          </div>

          <DialogFooter>
            <Button type="button" variant="outline" onClick={() => setEditPersonaOpen(false)}>
              Cancel
            </Button>
            <Button
              type="button"
              onClick={saveEditedPersona}
              disabled={Boolean(personaNameError || personaDescriptionError)}
            >
              Save changes
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog open={deletePersonaOpen} onOpenChange={setDeletePersonaOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Delete persona</DialogTitle>
            <DialogDescription>
              This removes the persona from your workspace UI. Connected accounts and posts under this persona may become inaccessible from the app.
            </DialogDescription>
          </DialogHeader>

          {selectedPersona ? (
            <div className="space-y-4">
              <div className="rounded-lg border bg-muted/20 p-3">
                <p className="text-sm">
                  To confirm, type <span className="font-semibold">{selectedPersona.name}</span>.
                </p>
              </div>

              <div className="space-y-2">
                <Label htmlFor="persona-delete-confirm">Confirmation</Label>
                <Input
                  id="persona-delete-confirm"
                  value={deleteConfirmText}
                  onChange={(e) => setDeleteConfirmText(e.target.value)}
                  placeholder={selectedPersona.name}
                />
              </div>
            </div>
          ) : null}

          <DialogFooter>
            <Button type="button" variant="outline" onClick={() => setDeletePersonaOpen(false)}>
              Cancel
            </Button>
            <Button
              type="button"
              variant="destructive"
              onClick={confirmDeletePersona}
              disabled={!selectedPersona || deleteConfirmText.trim() !== selectedPersona.name.trim()}
            >
              Delete
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog open={disconnectAccountOpen} onOpenChange={setDisconnectAccountOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Disconnect social account</DialogTitle>
            <DialogDescription>
              This disconnects the selected platform for{" "}
              <span className="font-medium">{selectedPersona?.name ?? "this persona"}</span>.
            </DialogDescription>
          </DialogHeader>

          <div className="rounded-lg border bg-muted/20 p-3">
            <p className="text-sm">
              Platform:{" "}
              <span className="font-semibold">
                {disconnectTarget === "linkedin"
                  ? "LinkedIn"
                  : disconnectTarget === "x"
                    ? "X"
                    : "—"}
              </span>
            </p>
            <p className="text-xs text-muted-foreground mt-1">
              You can reconnect anytime.
            </p>
          </div>

          <DialogFooter>
            <Button
              type="button"
              variant="outline"
              onClick={() => setDisconnectAccountOpen(false)}
            >
              Cancel
            </Button>
            <Button
              type="button"
              variant="destructive"
              onClick={confirmDisconnectAccount}
              disabled={!selectedPersona || !disconnectTarget}
            >
              Disconnect
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  )
}

export default SocialAccountsPage
