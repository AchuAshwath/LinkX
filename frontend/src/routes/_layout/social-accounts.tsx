import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query"
import { createFileRoute } from "@tanstack/react-router"
import {
  ExternalLink,
  Link2,
  Linkedin,
  MoreHorizontal,
  Plus,
  Twitter,
  Users,
} from "lucide-react"
import * as React from "react"
import { z } from "zod"

import {
  ApiError,
  AuthService,
  LinkedinService,
  type PersonaPublic,
  PersonasService,
  type TeamPublic,
  TeamsService,
} from "@/client"
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
import { Textarea } from "@/components/ui/textarea"
import useCustomToast from "@/hooks/useCustomToast"
import { usePersona } from "@/hooks/usePersona"
import { handleError } from "@/utils"

type Persona = {
  id: string
  name: string
  description: string
  createdAt: string
  updatedAt: string
}

const mapPersona = (persona: PersonaPublic): Persona => ({
  id: persona.id,
  name: persona.name,
  description: persona.description ?? "",
  createdAt: persona.created_at ?? new Date().toISOString(),
  updatedAt:
    persona.updated_at ?? persona.created_at ?? new Date().toISOString(),
})

type Team = {
  id: string
  name: string
  description: string
}

const mapTeam = (team: TeamPublic): Team => ({
  id: team.id,
  name: team.name,
  description: team.description ?? "",
})

const personaSchema = z.object({
  name: z
    .string()
    .trim()
    .min(1, { message: "Name is required." })
    .max(255, { message: "Name must be 255 characters or fewer." }),
  description: z
    .string()
    .trim()
    .max(500, { message: "Description must be 500 characters or fewer." })
    .optional(),
})

const teamSchema = z.object({
  name: z
    .string()
    .trim()
    .min(1, { message: "Name is required." })
    .max(255, { message: "Name must be 255 characters or fewer." }),
  description: z
    .string()
    .trim()
    .max(500, { message: "Description must be 500 characters or fewer." })
    .optional(),
})

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
  const queryClient = useQueryClient()
  const { showErrorToast, showSuccessToast } = useCustomToast()
  const { selectedPersonaId, setSelectedPersonaId } = usePersona()

  const {
    data: personasData,
    isLoading: personasLoading,
    error: personasError,
  } = useQuery({
    queryKey: ["personas"],
    queryFn: () => PersonasService.readPersonas(),
  })

  const personas = React.useMemo(
    () => (personasData?.data ?? []).map(mapPersona),
    [personasData],
  )

  const {
    data: teamsData,
    isLoading: teamsLoading,
    error: teamsError,
  } = useQuery({
    queryKey: ["teams"],
    queryFn: () => TeamsService.readTeams(),
  })

  const teams = React.useMemo(
    () => (teamsData?.data ?? []).map(mapTeam),
    [teamsData],
  )

  const selectedPersona = React.useMemo(() => {
    return personas.find((p) => p.id === selectedPersonaId) ?? null
  }, [personas, selectedPersonaId])

  React.useEffect(() => {
    if (personasError) {
      handleError.bind(showErrorToast)(personasError as any)
    }
  }, [personasError, showErrorToast])

  React.useEffect(() => {
    if (teamsError) {
      handleError.bind(showErrorToast)(teamsError as any)
    }
  }, [teamsError, showErrorToast])

  React.useEffect(() => {
    if (!personas.length) {
      return
    }

    const nextSelectedPersonaId =
      (selectedPersonaId &&
        personas.some((persona) => persona.id === selectedPersonaId) &&
        selectedPersonaId) ||
      personas[0]?.id ||
      ""

    if (nextSelectedPersonaId !== selectedPersonaId) {
      setSelectedPersonaId(nextSelectedPersonaId)
    }
  }, [personas, selectedPersonaId, setSelectedPersonaId])

  const [createPersonaOpen, setCreatePersonaOpen] = React.useState(false)
  const [editPersonaOpen, setEditPersonaOpen] = React.useState(false)
  const [deletePersonaOpen, setDeletePersonaOpen] = React.useState(false)
  const [createTeamOpen, setCreateTeamOpen] = React.useState(false)

  const [personaDraft, setPersonaDraft] = React.useState<{
    name: string
    description: string
  }>({
    name: "",
    description: "",
  })
  const [teamDraft, setTeamDraft] = React.useState<{ name: string; description: string }>({
    name: "",
    description: "",
  })
  const [deleteConfirmText, setDeleteConfirmText] = React.useState("")

  const [connecting, setConnecting] = React.useState(false)

  React.useEffect(() => {
    const params = new URLSearchParams(window.location.search)
    const linkedin = params.get("linkedin")
    if (linkedin === "connected") {
      showSuccessToast("LinkedIn connected successfully.")
      queryClient.invalidateQueries({ queryKey: ["linkedin-status"] })
    }
    if (linkedin === "error") {
      showErrorToast("LinkedIn connection failed. Please try again.")
    }
    if (params.has("linkedin")) {
      params.delete("linkedin")
      const search = params.toString()
      const url = `${window.location.pathname}${search ? `?${search}` : ""}`
      window.history.replaceState({}, "", url)
    }
  }, [queryClient, showErrorToast, showSuccessToast])

  const {
    data: linkedInStatus,
    isLoading: statusLoading,
    error: linkedInStatusError,
  } = useQuery({
    queryKey: ["linkedin-status", selectedPersonaId],
    queryFn: async () => {
      return await LinkedinService.linkedinStatus({ personaId: selectedPersonaId })
    },
    enabled: Boolean(selectedPersonaId),
  })

  React.useEffect(() => {
    if (linkedInStatusError) {
      if (
        linkedInStatusError instanceof ApiError &&
        linkedInStatusError.status === 403
      ) {
        // No persona access: treat as "not connected" without nagging the user
        return
      }
      handleError.bind(showErrorToast)(linkedInStatusError as any)
    }
  }, [linkedInStatusError, showErrorToast])

  const resetPersonaDraft = React.useCallback(() => {
    setPersonaDraft({
      name: "",
      description: "",
    })
  }, [])

  const resetTeamDraft = React.useCallback(() => {
    setTeamDraft({
      name: "",
      description: "",
    })
  }, [])

  const openCreatePersona = React.useCallback(() => {
    resetPersonaDraft()
    setCreatePersonaOpen(true)
  }, [resetPersonaDraft])

  const openCreateTeam = React.useCallback(() => {
    resetTeamDraft()
    setCreateTeamOpen(true)
  }, [resetTeamDraft])

  const openEditPersona = React.useCallback(() => {
    if (!selectedPersona) {
      showErrorToast("Select a persona to edit.")
      return
    }
    setPersonaDraft({
      name: selectedPersona.name,
      description: selectedPersona.description,
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

  const createPersonaMutation = useMutation({
    mutationFn: async () => {
      const parsed = personaSchema.safeParse(personaDraft)
      if (!parsed.success) {
        throw new Error(
          parsed.error.issues[0]?.message ?? "Invalid persona details.",
        )
      }
      return await PersonasService.createPersona({
        requestBody: {
          name: parsed.data.name,
          description: parsed.data.description?.trim()
            ? parsed.data.description.trim()
            : null,
        },
      })
    },
    onSuccess: (created) => {
      showSuccessToast(`Created persona “${created.name}”.`)
      setCreatePersonaOpen(false)
      queryClient.invalidateQueries({ queryKey: ["personas"] })
      setSelectedPersonaId(created.id)
    },
    onError: handleError.bind(showErrorToast),
  })

  const updatePersonaMutation = useMutation({
    mutationFn: async () => {
      if (!selectedPersona) throw new Error("Select a persona to edit.")
      const parsed = personaSchema.safeParse(personaDraft)
      if (!parsed.success) {
        throw new Error(
          parsed.error.issues[0]?.message ?? "Invalid persona details.",
        )
      }
      return await PersonasService.updatePersona({
        personaId: selectedPersona.id,
        requestBody: {
          name: parsed.data.name,
          description: parsed.data.description?.trim()
            ? parsed.data.description.trim()
            : null,
        },
      })
    },
    onSuccess: (updated) => {
      showSuccessToast(`Updated persona “${updated.name}”.`)
      setEditPersonaOpen(false)
      queryClient.invalidateQueries({ queryKey: ["personas"] })
    },
    onError: handleError.bind(showErrorToast),
  })

  const deletePersonaMutation = useMutation({
    mutationFn: async () => {
      if (!selectedPersona) throw new Error("Select a persona to delete.")
      if (deleteConfirmText.trim() !== selectedPersona.name.trim()) {
        throw new Error("Confirmation does not match persona name.")
      }
      await PersonasService.deletePersona({ personaId: selectedPersona.id })
      return selectedPersona.id
    },
    onSuccess: () => {
      showSuccessToast(`Deleted persona “${selectedPersona?.name ?? ""}”.`)
      setDeletePersonaOpen(false)
      queryClient.invalidateQueries({ queryKey: ["personas"] })
      setSelectedPersonaId("")
    },
    onError: handleError.bind(showErrorToast),
  })

  const createTeamMutation = useMutation({
    mutationFn: async () => {
      const parsed = teamSchema.safeParse(teamDraft)
      if (!parsed.success) {
        throw new Error(parsed.error.issues[0]?.message ?? "Invalid team details.")
      }
      return await TeamsService.createTeam({
        requestBody: {
          name: parsed.data.name,
          description: parsed.data.description?.trim()
            ? parsed.data.description.trim()
            : null,
        },
      })
    },
    onSuccess: (created) => {
      showSuccessToast(`Created team “${created.name}”.`)
      setCreateTeamOpen(false)
      queryClient.invalidateQueries({ queryKey: ["teams"] })
    },
    onError: handleError.bind(showErrorToast),
  })

  const handleConnectLinkedIn = async () => {
    if (!selectedPersona) {
      showErrorToast("Select a persona first.")
      return
    }
    try {
      setConnecting(true)
      const data = await AuthService.linkedinAuthorize({
        personaId: selectedPersona.id,
      })
      if (!data.authorize_url) throw new Error("No authorize_url in response.")
      window.location.href = data.authorize_url
    } catch (e) {
      let message =
        e instanceof Error ? e.message : "Could not start LinkedIn OAuth."
      try {
        const config = await AuthService.linkedinConfigCheck()
        if (!config.configured) {
          message = `LinkedIn not configured in backend. ${config.hint ?? ""}`
        } else if (config.hint) {
          message = `${message} ${config.hint}`
        }
      } catch {
        // ignore config-check failure
      }
      showErrorToast(message)
      setConnecting(false)
    }
  }

  type LinkedInProfile = {
    display_name?: string
    email?: string
    profile_picture_url?: string
  }

  const needsReconnect = Boolean(
    (linkedInStatus as Record<string, unknown> | undefined)?.needs_reconnect,
  )
  const personaLinkedInProfile =
    ((linkedInStatus as Record<string, unknown> | undefined)
      ?.profile as LinkedInProfile | undefined) ?? null
  const linkedInConnected = Boolean(
    (linkedInStatus as Record<string, unknown> | undefined)?.connected &&
      !needsReconnect,
  )
  const linkedInStatusBadge = statusLoading ? (
    <Badge variant="secondary" className="font-normal">
      Loading…
    </Badge>
  ) : linkedInConnected ? (
    <Badge variant="secondary" className="font-normal">
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
  const personaValidation = personaSchema.safeParse(personaDraft)
  const personaDraftError = personaValidation.success
    ? null
    : personaValidation.error.issues[0]?.message

  return (
    <div className="mx-auto flex w-full max-w-7xl min-h-[calc(100vh-3.5rem)]">
      {/* Main Column */}
      <div className="border-border min-w-0 flex-1 border-r md:max-w-2xl flex flex-col">
        {/* Sticky Top Bar */}
        <div className="sticky top-0 z-10 shrink-0 border-b bg-background/80 backdrop-blur-sm p-4">
          <div className="flex items-center justify-between gap-3">
            <div className="min-w-0">
              <h1 className="text-xl font-semibold tracking-tight truncate">
                Social Accounts
              </h1>
              <p className="text-sm text-muted-foreground">
                Connect accounts for each persona.
              </p>
            </div>
            <Button type="button" size="sm" onClick={openCreatePersona}>
              <Plus className="mr-2 h-4 w-4" />
              New persona
            </Button>
          </div>
        </div>

        {/* Scrollable Content */}
        <div className="flex-1 overflow-y-auto">
          <div className="w-full pb-20 p-4 space-y-4">
            <Card>
              <CardHeader className="pb-3">
                <CardTitle className="text-base font-semibold flex items-center gap-2">
                  <Users className="h-4 w-4" />
                  Persona
                </CardTitle>
                <CardDescription>
                  Choose who you’re posting as, then connect platforms.
                </CardDescription>
              </CardHeader>
              <CardContent className="pt-0">
                <div className="flex flex-col gap-3 sm:flex-row sm:items-end sm:justify-between">
                  <div className="space-y-1">
                    <Label className="text-sm">Selected persona</Label>
                    <Select
                      value={selectedPersonaId}
                      onValueChange={setSelectedPersonaId}
                    >
                      <SelectTrigger
                        className="w-full sm:w-[280px]"
                        disabled={personasLoading}
                      >
                        <SelectValue
                          placeholder={
                            personasLoading
                              ? "Loading personas..."
                              : "Select a persona"
                          }
                        />
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

                  <div className="flex items-center justify-end gap-2">
                    <DropdownMenu>
                      <DropdownMenuTrigger asChild>
                        <Button
                          type="button"
                          variant="outline"
                          size="sm"
                          disabled={!selectedPersona}
                        >
                          <MoreHorizontal className="mr-2 h-4 w-4" />
                          Manage
                        </Button>
                      </DropdownMenuTrigger>
                      <DropdownMenuContent align="end">
                        <DropdownMenuLabel>Persona actions</DropdownMenuLabel>
                        <DropdownMenuSeparator />
                        <DropdownMenuItem onSelect={openEditPersona}>
                          Edit persona
                        </DropdownMenuItem>
                        <DropdownMenuItem
                          onSelect={openDeletePersona}
                          variant="destructive"
                        >
                          Delete persona
                        </DropdownMenuItem>
                      </DropdownMenuContent>
                    </DropdownMenu>
                  </div>
                </div>
              </CardContent>
            </Card>

            {!selectedPersona ? (
              <div className="flex flex-col items-center justify-center text-center py-16 px-4">
                <div className="rounded-full bg-muted/50 p-6 mb-4">
                  <Link2 className="h-10 w-10 text-muted-foreground" />
                </div>
                <h3 className="text-xl font-semibold mb-1">
                  No persona selected
                </h3>
                <p className="text-muted-foreground text-sm max-w-sm">
                  Create a persona to start connecting social accounts.
                </p>
              </div>
            ) : (
              <Card>
                <CardHeader>
                  <CardTitle>Connections</CardTitle>
                  <CardDescription>
                    Social accounts for {selectedPersona.name}.
                  </CardDescription>
                </CardHeader>
                <CardContent className="space-y-0">
                  {/* LinkedIn */}
                  <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
                    <div className="flex items-center gap-4 min-w-0">
                      {personaLinkedInProfile?.profile_picture_url ? (
                        <Avatar className="h-12 w-12 shrink-0">
                          <AvatarImage
                            src={
                              personaLinkedInProfile.profile_picture_url ?? ""
                            }
                            alt={
                              personaLinkedInProfile.display_name ?? "LinkedIn"
                            }
                          />
                          <AvatarFallback className="text-sm">
                            LI
                          </AvatarFallback>
                        </Avatar>
                      ) : (
                        <div className="flex h-12 w-12 shrink-0 items-center justify-center rounded-xl bg-muted">
                          <Linkedin
                            className="h-6 w-6 text-muted-foreground"
                            aria-hidden
                          />
                        </div>
                      )}
                      <div className="space-y-1 min-w-0">
                        <Label className="text-base">LinkedIn</Label>
                        {personaLinkedInProfile?.display_name ? (
                          <p className="text-muted-foreground text-sm truncate">
                            {personaLinkedInProfile.display_name}
                            {personaLinkedInProfile.email
                              ? ` · ${personaLinkedInProfile.email}`
                              : ""}
                          </p>
                        ) : (
                          <p className="text-muted-foreground text-sm">
                            Connect LinkedIn to publish and schedule posts.
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
                        {needsReconnect
                          ? "Reconnect"
                          : linkedInConnected
                            ? "Manage"
                            : "Connect"}
                      </Button>
                    </div>
                  </div>

                  <Separator className="my-6" />

                  {/* X (Twitter) */}
                  <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
                    <div className="flex items-center gap-4 min-w-0">
                      <div className="flex h-12 w-12 shrink-0 items-center justify-center rounded-xl bg-muted">
                        <Twitter
                          className="h-6 w-6 text-muted-foreground"
                          aria-hidden
                        />
                      </div>
                      <div className="space-y-1 min-w-0">
                        <Label className="text-base">X (Twitter)</Label>
                        <p className="text-muted-foreground text-sm">
                          Coming soon.
                        </p>
                      </div>
                    </div>
                    <div className="flex items-center gap-3 shrink-0">
                      <Badge variant="secondary" className="font-normal">
                        Coming soon
                      </Badge>
                      <Button
                        type="button"
                        variant="outline"
                        size="sm"
                        disabled
                      >
                        <ExternalLink className="mr-2 h-4 w-4" />
                        Connect
                      </Button>
                    </div>
                  </div>
                </CardContent>
              </Card>
            )}
          </div>
        </div>
      </div>

      {/* Right Sidebar */}
      <div className="hidden w-80 md:block">
        <div className="sticky top-0 self-start p-4 space-y-4">
          <Card>
            <CardHeader className="pb-3">
              <CardTitle className="text-base font-semibold flex items-center gap-2">
                <Users className="h-4 w-4" />
                Quick Stats
              </CardTitle>
            </CardHeader>
            <CardContent className="space-y-3">
              <div className="flex items-center justify-between">
                <span className="text-sm text-muted-foreground">Personas</span>
                <Badge variant="secondary" className="font-semibold">
                  {personas.length}
                </Badge>
              </div>
              <div className="flex items-center justify-between">
                <span className="text-sm text-muted-foreground">Teams</span>
                <Badge variant="secondary" className="font-semibold">
                  {teamsLoading ? "…" : teams.length}
                </Badge>
              </div>
              <div className="flex items-center justify-between">
                <span className="text-sm text-muted-foreground">
                  Platforms supported
                </span>
                <Badge variant="secondary" className="font-semibold">
                  1
                </Badge>
              </div>
              <div className="flex items-center justify-between pt-2 border-t">
                <span className="text-sm font-medium">Selected</span>
                <span className="text-sm font-semibold truncate max-w-40 text-right">
                  {selectedPersona?.name ?? "—"}
                </span>
              </div>
            </CardContent>
          </Card>

          <Card>
            <CardHeader className="pb-3">
              <CardTitle className="text-base font-semibold flex items-center justify-between gap-2">
                <span className="flex items-center gap-2">
                  <Users className="h-4 w-4" />
                  Teams
                </span>
                <Button type="button" size="sm" variant="outline" onClick={openCreateTeam}>
                  <Plus className="mr-2 h-4 w-4" />
                  New
                </Button>
              </CardTitle>
            </CardHeader>
            <CardContent className="space-y-2">
              {teamsLoading ? (
                <p className="text-sm text-muted-foreground">Loading teams…</p>
              ) : teams.length ? (
                <div className="space-y-2">
                  {teams.slice(0, 5).map((team) => (
                    <div key={team.id} className="rounded-md border px-3 py-2">
                      <div className="text-sm font-medium truncate">{team.name}</div>
                      {team.description ? (
                        <div className="text-xs text-muted-foreground line-clamp-2">
                          {team.description}
                        </div>
                      ) : null}
                    </div>
                  ))}
                  {teams.length > 5 ? (
                    <p className="text-xs text-muted-foreground">
                      Showing first 5 teams.
                    </p>
                  ) : null}
                </div>
              ) : (
                <p className="text-sm text-muted-foreground">
                  Create a team to share personas and collaborate.
                </p>
              )}
            </CardContent>
          </Card>

          <Card>
            <CardHeader className="pb-3">
              <CardTitle className="text-base font-semibold flex items-center gap-2">
                <Link2 className="h-4 w-4" />
                About connections
              </CardTitle>
            </CardHeader>
            <CardContent className="space-y-2">
              <p className="text-sm text-muted-foreground">
                Connections are per-persona. Choose a persona, then connect a
                platform to publish as that voice.
              </p>
              <p className="text-sm text-muted-foreground">
                If you see “Reconnect required”, your token expired and you’ll
                need to re-authorize.
              </p>
            </CardContent>
          </Card>
        </div>
      </div>

      <Dialog open={createTeamOpen} onOpenChange={setCreateTeamOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Create team</DialogTitle>
            <DialogDescription>
              Teams let you share personas with role-based access.
            </DialogDescription>
          </DialogHeader>

          <div className="space-y-4">
            <div className="space-y-2">
              <Label htmlFor="team-create-name">Name</Label>
              <Input
                id="team-create-name"
                value={teamDraft.name}
                onChange={(e) =>
                  setTeamDraft((d) => ({ ...d, name: e.target.value }))
                }
                placeholder="Acme Social Team"
              />
            </div>

            <div className="space-y-2">
              <Label htmlFor="team-create-description">
                Description <span className="text-muted-foreground">(optional)</span>
              </Label>
              <Textarea
                id="team-create-description"
                value={teamDraft.description}
                onChange={(e) =>
                  setTeamDraft((d) => ({ ...d, description: e.target.value }))
                }
                placeholder="Who’s in this team and what it’s for…"
              />
            </div>
          </div>

          <DialogFooter>
            <Button
              type="button"
              variant="outline"
              onClick={() => setCreateTeamOpen(false)}
            >
              Cancel
            </Button>
            <Button
              type="button"
              onClick={() => createTeamMutation.mutate()}
              disabled={createTeamMutation.isPending}
            >
              {createTeamMutation.isPending ? "Creating…" : "Create team"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog open={createPersonaOpen} onOpenChange={setCreatePersonaOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Create persona</DialogTitle>
            <DialogDescription>
              Personas let you connect accounts and publish with different
              voices.
            </DialogDescription>
          </DialogHeader>

          <div className="space-y-4">
            <div className="space-y-2">
              <Label htmlFor="persona-create-name">Name</Label>
              <Input
                id="persona-create-name"
                value={personaDraft.name}
                onChange={(e) =>
                  setPersonaDraft((d) => ({ ...d, name: e.target.value }))
                }
                placeholder="e.g. Founder, LinkX, Personal"
                aria-invalid={Boolean(personaDraftError)}
              />
              {personaDraftError ? (
                <p className="text-xs text-destructive">{personaDraftError}</p>
              ) : null}
            </div>

            <div className="space-y-2">
              <Label htmlFor="persona-create-description">Description</Label>
              <Textarea
                id="persona-create-description"
                value={personaDraft.description}
                onChange={(e) =>
                  setPersonaDraft((d) => ({
                    ...d,
                    description: e.target.value,
                  }))
                }
                placeholder="What is this persona used for?"
                aria-invalid={Boolean(personaDraftError)}
              />
              <p className="text-xs text-muted-foreground">
                Optional. Up to 500 characters.
              </p>
            </div>
          </div>

          <DialogFooter>
            <Button
              type="button"
              variant="outline"
              onClick={() => setCreatePersonaOpen(false)}
            >
              Cancel
            </Button>
            <Button
              type="button"
              onClick={() => createPersonaMutation.mutate()}
              disabled={
                Boolean(personaDraftError) || createPersonaMutation.isPending
              }
            >
              {createPersonaMutation.isPending ? "Creating..." : "Create"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog open={editPersonaOpen} onOpenChange={setEditPersonaOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Edit persona</DialogTitle>
            <DialogDescription>Update persona details.</DialogDescription>
          </DialogHeader>

          <div className="space-y-4">
            <div className="space-y-2">
              <Label htmlFor="persona-edit-name">Name</Label>
              <Input
                id="persona-edit-name"
                value={personaDraft.name}
                onChange={(e) =>
                  setPersonaDraft((d) => ({ ...d, name: e.target.value }))
                }
                aria-invalid={Boolean(personaDraftError)}
              />
              {personaDraftError ? (
                <p className="text-xs text-destructive">{personaDraftError}</p>
              ) : null}
            </div>

            <div className="space-y-2">
              <Label htmlFor="persona-edit-description">Description</Label>
              <Textarea
                id="persona-edit-description"
                value={personaDraft.description}
                onChange={(e) =>
                  setPersonaDraft((d) => ({
                    ...d,
                    description: e.target.value,
                  }))
                }
                aria-invalid={Boolean(personaDraftError)}
              />
              <p className="text-xs text-muted-foreground">
                Optional. Up to 500 characters.
              </p>
            </div>
          </div>

          <DialogFooter>
            <Button
              type="button"
              variant="outline"
              onClick={() => setEditPersonaOpen(false)}
            >
              Cancel
            </Button>
            <Button
              type="button"
              onClick={() => updatePersonaMutation.mutate()}
              disabled={
                Boolean(personaDraftError) || updatePersonaMutation.isPending
              }
            >
              {updatePersonaMutation.isPending ? "Saving..." : "Save changes"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog open={deletePersonaOpen} onOpenChange={setDeletePersonaOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Delete persona</DialogTitle>
            <DialogDescription>
              This removes the persona from your workspace UI. Connected
              accounts and posts under this persona may become inaccessible from
              the app.
            </DialogDescription>
          </DialogHeader>

          {selectedPersona ? (
            <div className="space-y-4">
              <div className="rounded-lg border bg-muted/20 p-3">
                <p className="text-sm">
                  To confirm, type{" "}
                  <span className="font-semibold">{selectedPersona.name}</span>.
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
            <Button
              type="button"
              variant="outline"
              onClick={() => setDeletePersonaOpen(false)}
            >
              Cancel
            </Button>
            <Button
              type="button"
              variant="destructive"
              onClick={() => deletePersonaMutation.mutate()}
              disabled={
                !selectedPersona ||
                deleteConfirmText.trim() !== selectedPersona.name.trim() ||
                deletePersonaMutation.isPending
              }
            >
              {deletePersonaMutation.isPending ? "Deleting..." : "Delete"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  )
}

export default SocialAccountsPage
