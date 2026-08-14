import { createFileRoute, redirect } from "@tanstack/react-router"
import { z } from "zod"

const searchSchema = z.object({
  linkedin: z.string().optional(),
})

export const Route = createFileRoute("/_layout/accounts")({
  validateSearch: (search) => searchSchema.parse(search),
  beforeLoad: ({ search }) => {
    throw redirect({
      to: "/social-accounts",
      search,
    })
  },
})
