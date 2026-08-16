import { pluginCollapsibleSections } from "@expressive-code/plugin-collapsible-sections"
import { pluginLineNumbers } from "@expressive-code/plugin-line-numbers"

export default {
  plugins: [pluginCollapsibleSections(), pluginLineNumbers()],
  defaultProps: {
    showLineNumbers: false
  },
  styleOverrides: {
    borderColor: "oklch(27.4% 0.006 286.033)",
    borderRadius: "calc(0.5rem - 1px)",
    borderWidth: "1px",
    codeBackground: "#0d0d10",
    codeFontFamily: "var(--font-mono), ui-monospace, SFMono-Regular, Menlo, monospace",
    codeFontSize: "0.8125rem",
    codeLineHeight: "1.65",
    codePaddingBlock: "1rem",
    codePaddingInline: "1.25rem",
    uiFontFamily: "var(--font-mono), ui-monospace, monospace",
    frames: {
      editorTabBarBackground: "#09090b",
      editorActiveTabBackground: "#0d0d10",
      editorActiveTabIndicatorTopColor: "transparent",
      editorActiveTabIndicatorBottomColor: "#0d0d10",
      editorTabBarBorderBottomColor: "oklch(27.4% 0.006 286.033)",
      terminalBackground: "#0d0d10",
      terminalTitlebarBackground: "#09090b",
      terminalTitlebarBorderBottomColor: "oklch(27.4% 0.006 286.033)",
      shadowColor: "transparent"
    }
  },
  themes: ["github-dark"],
  useDarkModeMediaQuery: false,
  themeCssSelector: () => false
}
