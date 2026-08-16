import { file, glob } from "astro/loaders"
import { z } from "astro/zod"
import { defineCollection } from "astro:content"

const docs = defineCollection({
  loader: glob({ base: "./src/content/docs", pattern: "**/[^_]*.{md,mdx}" }),
  schema: z.object({
    title: z.string(),
    description: z.string().optional(),
    sidebar: z
      .object({
        label: z.string().optional(),
        order: z.number().optional(),
        hidden: z.boolean().optional()
      })
      .optional()
  })
})

const docsSidebar = defineCollection({
  loader: file("./src/content/docs/sidebar-config.json"),
  schema: z.record(z.string(), z.number())
})

export const collections = { docs, docsSidebar }
