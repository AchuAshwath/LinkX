import { existsSync } from "node:fs"
import { fileURLToPath } from "node:url"
import { defineConfig } from "@hey-api/openapi-ts"

const openApiInputPath = fileURLToPath(
  new URL("./openapi.json", import.meta.url),
)

if (!existsSync(openApiInputPath)) {
  throw new Error(
    `Missing OpenAPI spec at "${openApiInputPath}". Run "bash ./scripts/generate-client.sh" first.`,
  )
}

export default defineConfig({
  input: openApiInputPath,
  output: "./src/client",

  plugins: [
    "legacy/axios",
    {
      name: "@hey-api/sdk",
      // NOTE: this doesn't allow tree-shaking
      asClass: true,
      operationId: true,
      classNameBuilder: "{{name}}Service",
      methodNameBuilder: (operation) => {
        // @ts-expect-error
        let name: string = operation.name
        // @ts-expect-error
        const service: string = operation.service

        if (service && name.toLowerCase().startsWith(service.toLowerCase())) {
          name = name.slice(service.length)
        }

        return name.charAt(0).toLowerCase() + name.slice(1)
      },
    },
    {
      name: "@hey-api/schemas",
      type: "json",
    },
  ],
})
