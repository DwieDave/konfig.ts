import tailwindcss from "@tailwindcss/vite"
import { defineConfig, fontProviders } from "astro/config"
import { fileURLToPath } from "node:url"

const SANS = "@fontsource-variable/atkinson-hyperlegible-next/files/atkinson-hyperlegible-next-latin"
const MONO = "@fontsource-variable/atkinson-hyperlegible-mono/files/atkinson-hyperlegible-mono-latin"

export default defineConfig({
  site: "https://dwiedave.github.io",
  base: "/konfig.ts",
  output: "static",
  trailingSlash: "never",
  compressHTML: true,
  vite: {
    plugins: [tailwindcss()],
    resolve: {
      alias: { "@/": fileURLToPath(new URL("./src/", import.meta.url)) }
    },
    server: {
      fs: { allow: [fileURLToPath(new URL("../../", import.meta.url))] }
    }
  },
  fonts: [
    {
      provider: fontProviders.local(),
      name: "Atkinson Hyperlegible Next",
      cssVariable: "--font-atkinson-sans",
      fallbacks: ["ui-sans-serif", "system-ui", "sans-serif"],
      options: {
        variants: [
          { src: [`${SANS}-wght-normal.woff2`], weight: "200 800", style: "normal" },
          { src: [`${SANS}-wght-italic.woff2`], weight: "200 800", style: "italic" }
        ]
      }
    },
    {
      provider: fontProviders.local(),
      name: "Atkinson Hyperlegible Mono",
      cssVariable: "--font-atkinson-mono",
      fallbacks: ["ui-monospace", "SFMono-Regular", "monospace"],
      options: {
        variants: [
          { src: [`${MONO}-wght-normal.woff2`], weight: "200 800", style: "normal" },
          { src: [`${MONO}-wght-italic.woff2`], weight: "200 800", style: "italic" }
        ]
      }
    }
  ]
})
