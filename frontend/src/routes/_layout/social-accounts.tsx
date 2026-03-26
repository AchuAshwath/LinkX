import {
  useMutation,
  useQueries,
  useQuery,
  useQueryClient,
} from "@tanstack/react-query"
import { createFileRoute } from "@tanstack/react-router"
import {
  Check,
  ChevronDown,
  ChevronRight,
  ExternalLink,
  Loader2,
  MoreHorizontal,
  Plus,
  Users,
} from "lucide-react"
import * as React from "react"
import { FaLinkedinIn } from "react-icons/fa"
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
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
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
import { Separator } from "@/components/ui/separator"
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table"
import { Textarea } from "@/components/ui/textarea"
import useAuth from "@/hooks/useAuth"
import useCustomToast from "@/hooks/useCustomToast"
import { usePersona } from "@/hooks/usePersona"
import { handleError } from "@/utils"

type Persona = {
  id: string
  name: string
  description: string
}

const mapPersona = (persona: PersonaPublic): Persona => ({
  id: persona.id,
  name: persona.name,
  description: persona.description ?? "",
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

type LinkedinStatusView = {
  badge: React.ReactNode
  connected: boolean
  needsReconnect: boolean
}

function getLinkedinStatusView(status: unknown): LinkedinStatusView {
  const data = status as Record<string, unknown> | undefined
  if (!data) {
    return {
      badge: (
        <Badge variant="secondary" className="font-normal">
          Loading…
        </Badge>
      ),
      connected: false,
      needsReconnect: false,
    }
  }

  const connected = Boolean(data.connected)
  const needsReconnect = Boolean(data.needs_reconnect)

  if (connected && !needsReconnect) {
    return {
      badge: (
        <Badge
          variant="outline"
          className="border-emerald-500/45 bg-emerald-500/10 font-normal text-emerald-800 dark:border-emerald-500/40 dark:bg-emerald-500/15 dark:text-emerald-300"
        >
          Signed in
        </Badge>
      ),
      connected: true,
      needsReconnect: false,
    }
  }

  if (needsReconnect) {
    return {
      badge: (
        <Badge
          variant="outline"
          className="border-amber-500/45 bg-amber-500/10 font-normal text-amber-900 dark:border-amber-500/40 dark:bg-amber-500/15 dark:text-amber-200"
        >
          Reconnect required
        </Badge>
      ),
      connected: false,
      needsReconnect: true,
    }
  }

  return {
    badge: (
      <Badge variant="secondary" className="font-normal">
        Disconnected
      </Badge>
    ),
    connected: false,
    needsReconnect: false,
  }
}

/** True when this persona has LinkedIn linked (signed in or needs reconnect). */
function personaLinkedinInUse(status: unknown): boolean {
  const data = status as Record<string, unknown> | undefined
  if (!data) return false
  return Boolean(data.connected) || Boolean(data.needs_reconnect)
}

/** Platforms we can aggregate onto the team row (extend when adding networks). */
type TeamPlatformKey = "linkedin"

const TEAM_PLATFORM_ORDER: TeamPlatformKey[] = ["linkedin"]

function SocialAccountsPage() {
  const queryClient = useQueryClient()
  const { showErrorToast, showSuccessToast } = useCustomToast()
  const { user: currentUser } = useAuth()
  const { selectedPersonaId, setSelectedPersonaId } = usePersona()

  const {
    data: personasData,
    isLoading: personasLoading,
    error: personasError,
  } = useQuery({
    queryKey: ["personas"],
    queryFn: () => PersonasService.readPersonas(),
  })

  const personas = React.useMemo(() => {
    const list = (personasData?.data ?? []).map(mapPersona)
    return list.sort((a, b) => a.name.localeCompare(b.name))
  }, [personasData])

  const rawPersonaById = React.useMemo(() => {
    const map: Record<string, PersonaPublic> = {}
    for (const p of personasData?.data ?? []) map[p.id] = p
    return map
  }, [personasData])

  const personaById = React.useMemo(() => {
    const map: Record<string, Persona> = {}
    for (const p of personas) map[p.id] = p
    return map
  }, [personas])

  const {
    data: teamsData,
    isLoading: teamsLoading,
    error: teamsError,
  } = useQuery({
    queryKey: ["teams"],
    queryFn: () => TeamsService.readTeams(),
  })

  const teams = React.useMemo(() => {
    const list = (teamsData?.data ?? []).map(mapTeam)
    return list.sort((a, b) => a.name.localeCompare(b.name))
  }, [teamsData])

  const [expandedTeams, setExpandedTeams] = React.useState<
    Record<string, boolean>
  >({})

  React.useEffect(() => {
    if (!teams.length) return
    setExpandedTeams((prev) => {
      const next = { ...prev }
      for (const team of teams) {
        if (next[team.id] === undefined) next[team.id] = false
      }
      return next
    })
  }, [teams])

  const teamPersonasQueries = useQueries({
    queries: teams.map((team) => ({
      queryKey: ["team-personas", team.id],
      queryFn: () => TeamsService.readTeamPersonas({ teamId: team.id }),
      enabled: Boolean(team.id),
      staleTime: 30_000,
    })),
  })

  const teamPersonasById = React.useMemo(() => {
    const map: Record<string, Persona[]> = {}
    teams.forEach((team, idx) => {
      const data = teamPersonasQueries[idx]?.data
      map[team.id] = (data?.data ?? []).map(mapPersona)
    })
    return map
  }, [teams, teamPersonasQueries])

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

  /** All personas listed under any team (stable order for query ↔ index mapping). */
  const allTeamPersonaIds = React.useMemo(() => {
    const ids = new Set<string>()
    for (const team of teams) {
      for (const p of teamPersonasById[team.id] ?? []) ids.add(p.id)
    }
    return Array.from(ids).sort()
  }, [teams, teamPersonasById])

  const linkedinPersonaIdToQueryIndex = React.useMemo(() => {
    const map: Record<string, number> = {}
    allTeamPersonaIds.forEach((id, i) => {
      map[id] = i
    })
    return map
  }, [allTeamPersonaIds])

  const linkedinStatusQueries = useQueries({
    queries: allTeamPersonaIds.map((personaId) => ({
      queryKey: ["linkedin-status", personaId],
      queryFn: async () => {
        return await LinkedinService.linkedinStatus({ personaId })
      },
      enabled: Boolean(personaId),
      staleTime: 30_000,
      retry: (failureCount: number, error: unknown) => {
        if (error instanceof ApiError && error.status === 403) return false
        return failureCount < 2
      },
    })),
  })

  const linkedinStatusByPersonaId = React.useMemo(() => {
    const map: Record<string, unknown> = {}
    allTeamPersonaIds.forEach((personaId, idx) => {
      map[personaId] = linkedinStatusQueries[idx]?.data
    })
    return map
  }, [linkedinStatusQueries, allTeamPersonaIds])

  const teamPlatformSummary = React.useMemo(() => {
    const summary: Record<
      string,
      { platforms: TeamPlatformKey[]; showLoadingPlaceholder: boolean }
    > = {}
    for (const team of teams) {
      const personas = teamPersonasById[team.id] ?? []
      if (!personas.length) {
        summary[team.id] = { platforms: [], showLoadingPlaceholder: false }
        continue
      }
      const platforms = new Set<TeamPlatformKey>()
      let showLoadingPlaceholder = false
      for (const p of personas) {
        const idx = linkedinPersonaIdToQueryIndex[p.id]
        if (idx === undefined) continue
        const q = linkedinStatusQueries[idx]
        if (q?.isLoading) showLoadingPlaceholder = true
        if (personaLinkedinInUse(q?.data)) platforms.add("linkedin")
      }
      summary[team.id] = {
        platforms: TEAM_PLATFORM_ORDER.filter((k) => platforms.has(k)),
        showLoadingPlaceholder,
      }
    }
    return summary
  }, [
    teams,
    teamPersonasById,
    linkedinPersonaIdToQueryIndex,
    linkedinStatusQueries,
  ])

  const [createPersonaOpen, setCreatePersonaOpen] = React.useState(false)
  const [editPersonaOpen, setEditPersonaOpen] = React.useState(false)
  const [deletePersonaOpen, setDeletePersonaOpen] = React.useState(false)
  const [createTeamOpen, setCreateTeamOpen] = React.useState(false)
  const [disconnectPersonaOpen, setDisconnectPersonaOpen] =
    React.useState(false)

  const [editTeamOpen, setEditTeamOpen] = React.useState(false)
  const [deleteTeamOpen, setDeleteTeamOpen] = React.useState(false)
  const [sharePersonaOpen, setSharePersonaOpen] = React.useState(false)

  const [activePersonaId, setActivePersonaId] = React.useState<string>("")
  const [activeTeamId, setActiveTeamId] = React.useState<string>("")

  const activePersona = React.useMemo(() => {
    const id = activePersonaId || selectedPersonaId
    return id ? (personaById[id] ?? null) : null
  }, [activePersonaId, personaById, selectedPersonaId])

  const activeTeam = React.useMemo(() => {
    return activeTeamId
      ? (teams.find((t) => t.id === activeTeamId) ?? null)
      : null
  }, [activeTeamId, teams])

  const canManageActivePersona = React.useMemo(() => {
    if (!activePersona || !currentUser) return false
    return rawPersonaById[activePersona.id]?.user_id === currentUser.id
  }, [activePersona, currentUser, rawPersonaById])

  const [personaDraft, setPersonaDraft] = React.useState<{
    name: string
    description: string
  }>({
    name: "",
    description: "",
  })
  const [teamDraft, setTeamDraft] = React.useState<{
    name: string
    description: string
  }>({
    name: "",
    description: "",
  })

  const [deleteConfirmText, setDeleteConfirmText] = React.useState("")
  const [connectingPersonaId, setConnectingPersonaId] =
    React.useState<string>("")

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

  const openCreateTeam = React.useCallback(() => {
    setTeamDraft({ name: "", description: "" })
    setCreateTeamOpen(true)
  }, [])

  const openEditTeam = React.useCallback(
    (teamId: string) => {
      const team = teams.find((t) => t.id === teamId)
      if (!team) {
        showErrorToast("Team not found.")
        return
      }
      setActiveTeamId(teamId)
      setTeamDraft({
        name: team.name,
        description: team.description,
      })
      setEditTeamOpen(true)
    },
    [showErrorToast, teams],
  )

  const openDeleteTeam = React.useCallback(
    (teamId: string) => {
      const team = teams.find((t) => t.id === teamId)
      if (!team) {
        showErrorToast("Team not found.")
        return
      }
      setActiveTeamId(teamId)
      setDeleteTeamOpen(true)
    },
    [showErrorToast, teams],
  )

  const openCreatePersona = React.useCallback(() => {
    setPersonaDraft({ name: "", description: "" })
    setCreatePersonaOpen(true)
  }, [])

  const openEditPersona = React.useCallback(
    (personaId: string) => {
      const persona = personaById[personaId]
      if (!persona) {
        showErrorToast("Persona not found.")
        return
      }
      setActivePersonaId(personaId)
      setSelectedPersonaId(personaId)
      setPersonaDraft({ name: persona.name, description: persona.description })
      setEditPersonaOpen(true)
    },
    [personaById, setSelectedPersonaId, showErrorToast],
  )

  const openDeletePersona = React.useCallback(
    (personaId: string) => {
      const persona = personaById[personaId]
      if (!persona) {
        showErrorToast("Persona not found.")
        return
      }
      setActivePersonaId(personaId)
      setDeleteConfirmText("")
      setDeletePersonaOpen(true)
    },
    [personaById, showErrorToast],
  )

  const openDisconnectPersona = React.useCallback(
    (personaId: string) => {
      const persona = personaById[personaId]
      if (!persona) {
        showErrorToast("Persona not found.")
        return
      }
      setActivePersonaId(personaId)
      setSelectedPersonaId(personaId)
      setDisconnectPersonaOpen(true)
    },
    [personaById, setSelectedPersonaId, showErrorToast],
  )

  const handleSharePersonaOpenChange = React.useCallback((open: boolean) => {
    setSharePersonaOpen(open)
    if (!open) {
      setActiveTeamId("")
    }
  }, [])

  const openSharePersona = React.useCallback(
    (personaId: string) => {
      const persona = personaById[personaId]
      if (!persona) {
        showErrorToast("Persona not found.")
        return
      }
      setActiveTeamId("")
      setActivePersonaId(personaId)
      handleSharePersonaOpenChange(true)
    },
    [handleSharePersonaOpenChange, personaById, showErrorToast],
  )

  const createTeamMutation = useMutation({
    mutationFn: async () => {
      const parsed = teamSchema.safeParse(teamDraft)
      if (!parsed.success) {
        throw new Error(
          parsed.error.issues[0]?.message ?? "Invalid team details.",
        )
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

  const updateTeamMutation = useMutation({
    mutationFn: async () => {
      if (!activeTeam) throw new Error("Select a team to edit.")
      const parsed = teamSchema.safeParse(teamDraft)
      if (!parsed.success) {
        throw new Error(
          parsed.error.issues[0]?.message ?? "Invalid team details.",
        )
      }
      return await TeamsService.updateTeam({
        teamId: activeTeam.id,
        requestBody: {
          name: parsed.data.name,
          description: parsed.data.description?.trim()
            ? parsed.data.description.trim()
            : null,
        },
      })
    },
    onSuccess: (updated) => {
      showSuccessToast(`Updated team “${updated.name}”.`)
      setEditTeamOpen(false)
      queryClient.invalidateQueries({ queryKey: ["teams"] })
    },
    onError: handleError.bind(showErrorToast),
  })

  const deleteTeamMutation = useMutation({
    mutationFn: async () => {
      if (!activeTeam) throw new Error("Select a team to delete.")
      await TeamsService.deleteTeam({ teamId: activeTeam.id })
      return activeTeam.id
    },
    onSuccess: () => {
      showSuccessToast("Deleted team.")
      setDeleteTeamOpen(false)
      queryClient.invalidateQueries({ queryKey: ["teams"] })
    },
    onError: handleError.bind(showErrorToast),
  })

  const sharePersonaMutation = useMutation({
    mutationFn: async (teamId: string) => {
      if (!activePersona) throw new Error("Select a persona to share.")
      await PersonasService.sharePersona({
        personaId: activePersona.id,
        requestBody: {
          team_id: teamId,
          role: "member",
        },
      })
      return teamId
    },
    onSuccess: (teamId) => {
      showSuccessToast("Persona shared with team.")
      handleSharePersonaOpenChange(false)
      queryClient.invalidateQueries({
        queryKey: ["team-personas", teamId],
      })
    },
    onError: handleError.bind(showErrorToast),
  })

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
    onSuccess: async (created) => {
      showSuccessToast(`Created persona “${created.name}”.`)
      setCreatePersonaOpen(false)
      setActivePersonaId(created.id)
      setSelectedPersonaId(created.id)
      queryClient.invalidateQueries({ queryKey: ["personas"] })

      // Automatically share new persona with either the active team or primary team
      const targetTeamId = activeTeamId || teams[0]?.id
      if (targetTeamId) {
        try {
          await PersonasService.sharePersona({
            personaId: created.id,
            requestBody: {
              team_id: targetTeamId,
              role: "owner",
            },
          })
          queryClient.invalidateQueries({
            queryKey: ["team-personas", targetTeamId],
          })
        } catch (error) {
          handleError.bind(showErrorToast)(error as any)
        }
      }
    },
    onError: handleError.bind(showErrorToast),
  })

  const updatePersonaMutation = useMutation({
    mutationFn: async () => {
      if (!activePersona) throw new Error("Select a persona to edit.")
      const parsed = personaSchema.safeParse(personaDraft)
      if (!parsed.success) {
        throw new Error(
          parsed.error.issues[0]?.message ?? "Invalid persona details.",
        )
      }
      return await PersonasService.updatePersona({
        personaId: activePersona.id,
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
      if (!activePersona) throw new Error("Select a persona to delete.")
      if (deleteConfirmText.trim() !== activePersona.name.trim()) {
        throw new Error("Confirmation does not match persona name.")
      }
      await PersonasService.deletePersona({ personaId: activePersona.id })
      return activePersona.id
    },
    onSuccess: () => {
      showSuccessToast("Deleted persona.")
      setDeletePersonaOpen(false)
      queryClient.invalidateQueries({ queryKey: ["personas"] })
      setActivePersonaId("")
    },
    onError: handleError.bind(showErrorToast),
  })

  const disconnectLinkedInMutation = useMutation({
    mutationFn: async (personaId: string) => {
      await LinkedinService.linkedinDisconnect({ personaId })
      return personaId
    },
    onSuccess: (personaId) => {
      showSuccessToast("Disconnected LinkedIn.")
      setDisconnectPersonaOpen(false)
      queryClient.invalidateQueries({
        queryKey: ["linkedin-status", personaId],
      })
      queryClient.invalidateQueries({ queryKey: ["linkedin-status"] })
    },
    onError: handleError.bind(showErrorToast),
  })

  const handleConnectLinkedIn = async (personaId: string) => {
    const persona = personaById[personaId]
    if (!persona) {
      showErrorToast("Persona not found.")
      return
    }
    try {
      setConnectingPersonaId(personaId)
      const data = await AuthService.linkedinAuthorize({
        personaId: persona.id,
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
      setConnectingPersonaId("")
    }
  }

  const personaValidation = personaSchema.safeParse(personaDraft)
  const personaDraftError = personaValidation.success
    ? null
    : personaValidation.error.issues[0]?.message

  return (
    <div className="flex flex-col gap-6 p-3 sm:p-4 md:p-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold tracking-tight">Social Accounts</h1>
          <p className="text-muted-foreground">
            Teams expand to show personas. Connect or disconnect per persona.
          </p>
        </div>
        <div className="flex items-center gap-2">
          <Button type="button" variant="outline" onClick={openCreateTeam}>
            <Users className="mr-2 h-4 w-4" />
            New team
          </Button>
        </div>
      </div>

      <Table>
        <TableHeader>
          <TableRow className="hover:bg-transparent">
            <TableHead>Team / Persona</TableHead>
            <TableHead>Platform</TableHead>
            <TableHead>Status</TableHead>
            <TableHead className="text-right">Actions</TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {teamsLoading ? (
            <TableRow className="hover:bg-transparent">
              <TableCell colSpan={4} className="h-24 text-muted-foreground">
                Loading teams…
              </TableCell>
            </TableRow>
          ) : teams.length ? (
            teams.map((team) => {
              const expanded = expandedTeams[team.id] ?? false
              const teamPersonas = teamPersonasById[team.id] ?? []
              const platformSummary = teamPlatformSummary[team.id] ?? {
                platforms: [] as TeamPlatformKey[],
                showLoadingPlaceholder: false,
              }

              return (
                <React.Fragment key={team.id}>
                  <TableRow>
                    <TableCell className="whitespace-normal">
                      <button
                        type="button"
                        onClick={() =>
                          setExpandedTeams((prev) => ({
                            ...prev,
                            [team.id]: !expanded,
                          }))
                        }
                        className="flex w-full items-start gap-2 text-left"
                      >
                        <span className="mt-0.5 text-muted-foreground">
                          {expanded ? (
                            <ChevronDown className="h-4 w-4" aria-hidden />
                          ) : (
                            <ChevronRight className="h-4 w-4" aria-hidden />
                          )}
                        </span>
                        <span className="min-w-0">
                          <span className="font-medium">{team.name}</span>
                          {team.description ? (
                            <span className="block text-xs text-muted-foreground line-clamp-1">
                              {team.description}
                            </span>
                          ) : null}
                        </span>
                      </button>
                    </TableCell>
                    <TableCell>
                      {platformSummary.platforms.length ? (
                        <ul
                          className="flex list-none flex-wrap items-center gap-1 p-0"
                          aria-label="Platforms in use by personas in this team"
                        >
                          {platformSummary.platforms.map((plat) =>
                            plat === "linkedin" ? (
                              <li key={plat}>
                                <span
                                  className="inline-flex h-7 w-7 items-center justify-center rounded-full border border-border bg-background text-[#0A66C2] shadow-xs"
                                  title="LinkedIn"
                                >
                                  <FaLinkedinIn
                                    className="h-3.5 w-3.5"
                                    aria-hidden
                                  />
                                </span>
                              </li>
                            ) : null,
                          )}
                        </ul>
                      ) : platformSummary.showLoadingPlaceholder ? (
                        <Loader2
                          className="h-4 w-4 animate-spin text-muted-foreground"
                          aria-label="Loading platforms"
                        />
                      ) : (
                        <span className="text-muted-foreground">—</span>
                      )}
                    </TableCell>
                    <TableCell>
                      <Badge variant="secondary" className="font-normal">
                        {teamPersonas.length} personas
                      </Badge>
                    </TableCell>
                    <TableCell className="text-right">
                      <div className="flex items-center justify-end gap-1.5">
                        <Button
                          type="button"
                          size="sm"
                          onClick={(e) => {
                            e.stopPropagation()
                            setActiveTeamId(team.id)
                            openCreatePersona()
                          }}
                        >
                          <Plus className="h-3 w-3" />
                          New persona
                        </Button>
                        <DropdownMenu>
                          <DropdownMenuTrigger asChild>
                            <Button
                              type="button"
                              size="sm"
                              variant="outline"
                              onClick={(e) => e.stopPropagation()}
                            >
                              <MoreHorizontal className="h-4 w-4" />
                              <span className="sr-only">Team actions</span>
                            </Button>
                          </DropdownMenuTrigger>
                          <DropdownMenuContent align="end">
                            <DropdownMenuLabel>Team</DropdownMenuLabel>
                            <DropdownMenuSeparator />
                            <DropdownMenuItem
                              onSelect={() => openEditTeam(team.id)}
                            >
                              Edit
                            </DropdownMenuItem>
                            <DropdownMenuItem
                              onSelect={() => openDeleteTeam(team.id)}
                              variant="destructive"
                            >
                              Delete
                            </DropdownMenuItem>
                          </DropdownMenuContent>
                        </DropdownMenu>
                      </div>
                    </TableCell>
                  </TableRow>

                  {expanded ? (
                    teamPersonas.length ? (
                      teamPersonas.map((p) => {
                        const view = getLinkedinStatusView(
                          linkedinStatusByPersonaId[p.id],
                        )
                        const canEdit =
                          Boolean(currentUser) &&
                          rawPersonaById[p.id]?.user_id === currentUser?.id
                        const isSelected = selectedPersonaId === p.id

                        return (
                          <TableRow
                            key={p.id}
                            className={`bg-background ${
                              isSelected ? "bg-accent/40" : ""
                            }`}
                            onClick={() => {
                              setActivePersonaId(p.id)
                              setSelectedPersonaId(p.id)
                            }}
                          >
                            <TableCell className="pl-10 whitespace-normal">
                              <div className="flex items-start gap-2">
                                <span className="flex h-5 w-5 shrink-0 items-center justify-center">
                                  {isSelected ? (
                                    <Check
                                      className="h-4 w-4 text-emerald-600 dark:text-emerald-400"
                                      aria-label="Selected persona"
                                    />
                                  ) : null}
                                </span>
                                <div className="min-w-0">
                                  <div className="font-medium">{p.name}</div>
                                  {p.description ? (
                                    <div className="text-xs text-muted-foreground line-clamp-2">
                                      {p.description}
                                    </div>
                                  ) : null}
                                </div>
                              </div>
                            </TableCell>
                            <TableCell>
                              <span
                                className="inline-flex text-[#0A66C2]"
                                title="LinkedIn"
                              >
                                <FaLinkedinIn className="h-4 w-4" aria-hidden />
                                <span className="sr-only">LinkedIn</span>
                              </span>
                            </TableCell>
                            <TableCell>{view.badge}</TableCell>
                            <TableCell className="text-right">
                              <div className="flex items-center justify-end gap-1.5">
                                {view.connected &&
                                !view.needsReconnect ? null : (
                                  <Button
                                    type="button"
                                    size="sm"
                                    variant="default"
                                    onClick={(e) => {
                                      e.stopPropagation()
                                      void handleConnectLinkedIn(p.id)
                                    }}
                                    disabled={connectingPersonaId === p.id}
                                  >
                                    <ExternalLink className="h-4 w-4" />
                                    {view.needsReconnect
                                      ? "Reconnect"
                                      : "Connect"}
                                  </Button>
                                )}

                                <DropdownMenu>
                                  <DropdownMenuTrigger asChild>
                                    <Button
                                      type="button"
                                      size="sm"
                                      variant="outline"
                                      onClick={(e) => e.stopPropagation()}
                                    >
                                      <MoreHorizontal className="h-4 w-4" />
                                      <span className="sr-only">
                                        Persona actions
                                      </span>
                                    </Button>
                                  </DropdownMenuTrigger>
                                  <DropdownMenuContent align="end">
                                    <DropdownMenuLabel>
                                      Persona
                                    </DropdownMenuLabel>
                                    <DropdownMenuSeparator />
                                    <DropdownMenuItem
                                      onSelect={() => openEditPersona(p.id)}
                                      disabled={!canEdit}
                                    >
                                      Edit
                                    </DropdownMenuItem>
                                    <DropdownMenuItem
                                      onSelect={() => openSharePersona(p.id)}
                                      disabled={teams.length <= 1}
                                    >
                                      Share with team…
                                    </DropdownMenuItem>
                                    {view.connected && !view.needsReconnect ? (
                                      <DropdownMenuItem
                                        onSelect={() => {
                                          void handleConnectLinkedIn(p.id)
                                        }}
                                        disabled={connectingPersonaId === p.id}
                                      >
                                        Refresh LinkedIn connection…
                                      </DropdownMenuItem>
                                    ) : null}
                                    <DropdownMenuItem
                                      onSelect={() => openDeletePersona(p.id)}
                                      disabled={!canEdit}
                                      variant="destructive"
                                    >
                                      Delete
                                    </DropdownMenuItem>
                                    <DropdownMenuSeparator />
                                    <DropdownMenuItem
                                      onSelect={() =>
                                        openDisconnectPersona(p.id)
                                      }
                                      disabled={
                                        !(view.connected || view.needsReconnect)
                                      }
                                      variant="destructive"
                                    >
                                      Disconnect LinkedIn
                                    </DropdownMenuItem>
                                  </DropdownMenuContent>
                                </DropdownMenu>
                              </div>
                            </TableCell>
                          </TableRow>
                        )
                      })
                    ) : (
                      <TableRow className="hover:bg-transparent">
                        <TableCell
                          colSpan={4}
                          className="pl-10 text-muted-foreground"
                        >
                          No personas in this team yet.
                        </TableCell>
                      </TableRow>
                    )
                  ) : null}
                </React.Fragment>
              )
            })
          ) : (
            <TableRow className="hover:bg-transparent">
              <TableCell
                colSpan={4}
                className="h-32 text-center text-muted-foreground"
              >
                You’re not in any teams yet.
              </TableCell>
            </TableRow>
          )}
        </TableBody>
      </Table>

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
                Description{" "}
                <span className="text-muted-foreground">(optional)</span>
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

      <Dialog open={editTeamOpen} onOpenChange={setEditTeamOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Edit team</DialogTitle>
            <DialogDescription>Update team details.</DialogDescription>
          </DialogHeader>

          <div className="space-y-4">
            <div className="space-y-2">
              <Label htmlFor="team-edit-name">Name</Label>
              <Input
                id="team-edit-name"
                value={teamDraft.name}
                onChange={(e) =>
                  setTeamDraft((d) => ({ ...d, name: e.target.value }))
                }
              />
            </div>

            <div className="space-y-2">
              <Label htmlFor="team-edit-description">
                Description{" "}
                <span className="text-muted-foreground">(optional)</span>
              </Label>
              <Textarea
                id="team-edit-description"
                value={teamDraft.description}
                onChange={(e) =>
                  setTeamDraft((d) => ({ ...d, description: e.target.value }))
                }
              />
            </div>
          </div>

          <DialogFooter>
            <Button
              type="button"
              variant="outline"
              onClick={() => setEditTeamOpen(false)}
            >
              Cancel
            </Button>
            <Button
              type="button"
              onClick={() => updateTeamMutation.mutate()}
              disabled={updateTeamMutation.isPending}
            >
              {updateTeamMutation.isPending ? "Saving…" : "Save changes"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog open={deleteTeamOpen} onOpenChange={setDeleteTeamOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Delete team</DialogTitle>
            <DialogDescription>
              This will remove the team and its persona access links. Personas
              themselves are not deleted.
            </DialogDescription>
          </DialogHeader>

          <div className="rounded-lg border bg-muted/20 p-3 text-sm">
            Team:{" "}
            <span className="font-semibold">{activeTeam?.name ?? "—"}</span>
          </div>

          <DialogFooter>
            <Button
              type="button"
              variant="outline"
              onClick={() => setDeleteTeamOpen(false)}
            >
              Cancel
            </Button>
            <Button
              type="button"
              variant="destructive"
              onClick={() => deleteTeamMutation.mutate()}
              disabled={deleteTeamMutation.isPending}
            >
              {deleteTeamMutation.isPending ? "Deleting…" : "Delete team"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog
        open={sharePersonaOpen}
        onOpenChange={handleSharePersonaOpenChange}
      >
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Share persona with team</DialogTitle>
            <DialogDescription>
              Make this persona available to another team.
            </DialogDescription>
          </DialogHeader>

          <div className="space-y-3">
            <div className="text-sm">
              Persona:{" "}
              <span className="font-semibold">
                {activePersona?.name ?? "—"}
              </span>
            </div>
            <div className="space-y-2">
              <Label htmlFor="share-persona-team">Team</Label>
              <select
                id="share-persona-team"
                className="flex h-9 w-full rounded-md border border-input bg-background px-3 py-1 text-sm shadow-sm focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring disabled:cursor-not-allowed disabled:opacity-50"
                value={activeTeamId || ""}
                onChange={(e) => setActiveTeamId(e.target.value)}
              >
                <option value="" disabled>
                  Select a team
                </option>
                {teams.map((team) => (
                  <option key={team.id} value={team.id}>
                    {team.name}
                  </option>
                ))}
              </select>
            </div>
          </div>

          <DialogFooter>
            <Button
              type="button"
              variant="outline"
              onClick={() => handleSharePersonaOpenChange(false)}
            >
              Cancel
            </Button>
            <Button
              type="button"
              onClick={() => {
                if (!activeTeamId) return
                sharePersonaMutation.mutate(activeTeamId)
              }}
              disabled={!activeTeamId || sharePersonaMutation.isPending}
            >
              {sharePersonaMutation.isPending ? "Sharing…" : "Share"}
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

          {!canManageActivePersona ? (
            <div className="rounded-lg border bg-muted/20 p-3 text-sm text-muted-foreground">
              You can only edit personas you created.
            </div>
          ) : null}

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
                !canManageActivePersona ||
                Boolean(personaDraftError) ||
                updatePersonaMutation.isPending
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

          {activePersona ? (
            <div className="space-y-4">
              {!canManageActivePersona ? (
                <div className="rounded-lg border bg-muted/20 p-3 text-sm text-muted-foreground">
                  You can only delete personas you created.
                </div>
              ) : (
                <>
                  <div className="rounded-lg border bg-muted/20 p-3">
                    <p className="text-sm">
                      To confirm, type{" "}
                      <span className="font-semibold">
                        {activePersona.name}
                      </span>
                      .
                    </p>
                  </div>

                  <div className="space-y-2">
                    <Label htmlFor="persona-delete-confirm">Confirmation</Label>
                    <Input
                      id="persona-delete-confirm"
                      value={deleteConfirmText}
                      onChange={(e) => setDeleteConfirmText(e.target.value)}
                      placeholder={activePersona.name}
                    />
                  </div>
                </>
              )}
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
                !activePersona ||
                !canManageActivePersona ||
                deleteConfirmText.trim() !== activePersona.name.trim() ||
                deletePersonaMutation.isPending
              }
            >
              {deletePersonaMutation.isPending ? "Deleting..." : "Delete"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog
        open={disconnectPersonaOpen}
        onOpenChange={setDisconnectPersonaOpen}
      >
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Disconnect LinkedIn</DialogTitle>
            <DialogDescription>
              This will revoke LinkX’s access for this persona. You can
              reconnect anytime.
            </DialogDescription>
          </DialogHeader>

          <div className="rounded-lg border bg-muted/20 p-3 text-sm">
            Persona:{" "}
            <span className="font-semibold">{activePersona?.name ?? "—"}</span>
          </div>

          <DialogFooter>
            <Button
              type="button"
              variant="outline"
              onClick={() => setDisconnectPersonaOpen(false)}
            >
              Cancel
            </Button>
            <Button
              type="button"
              variant="destructive"
              onClick={() => {
                if (!activePersona) return
                disconnectLinkedInMutation.mutate(activePersona.id)
              }}
              disabled={!activePersona || disconnectLinkedInMutation.isPending}
            >
              {disconnectLinkedInMutation.isPending
                ? "Disconnecting…"
                : "Disconnect"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Separator />

      <div className="text-xs text-muted-foreground">
        Tip: “Reconnect required” means the stored token expired; click
        Reconnect.
      </div>

      {personasLoading ? null : null}
    </div>
  )
}

export default SocialAccountsPage
