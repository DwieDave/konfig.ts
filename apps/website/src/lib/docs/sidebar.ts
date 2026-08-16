import { base } from "@/lib/site"

/** The subset of a docs collection entry the sidebar needs. Kept structural so it is unit-testable. */
export interface DocEntry {
  readonly id: string
  readonly data: {
    readonly title: string
    readonly sidebar?: {
      readonly label?: string | undefined
      readonly order?: number | undefined
      readonly hidden?: boolean | undefined
    } | undefined
  }
}

export interface SidebarGroupData<E extends DocEntry> {
  readonly dir: string
  readonly label: string
  readonly entries: ReadonlyArray<E>
  readonly isOpen: boolean
}

export type SidebarItem<E extends DocEntry> =
  | { readonly kind: "entry"; readonly entry: E }
  | { readonly kind: "group"; readonly group: SidebarGroupData<E> }

export const entryLabel = (e: DocEntry): string => e.data.sidebar?.label ?? e.data.title
export const entryOrder = (e: DocEntry): number => e.data.sidebar?.order ?? Infinity
export const entrySlug = (id: string): string => id.replace(/\/index$/, "")
export const entryHref = (id: string): string => `${base}/docs/${entrySlug(id)}/`

export const groupLabel = (dir: string): string =>
  dir
    .split("-")
    .map((w) => (w === "cli" ? "CLI" : w.charAt(0).toUpperCase() + w.slice(1)))
    .join(" ")

const sortByOrderLabel = <T>(items: ReadonlyArray<T>, order: (t: T) => number, label: (t: T) => string): Array<T> =>
  [...items].sort((a, b) => {
    const diff = order(a) - order(b)
    return diff !== 0 ? diff : label(a).localeCompare(label(b))
  })

/**
 * Builds the sidebar tree the way effect.website does: root-level entries and
 * one collapsible group per top-level directory. Groups order by
 * `groupOrder[dir]`, else by their smallest member order.
 */
export const buildSidebar = <E extends DocEntry>(
  entries: ReadonlyArray<E>,
  currentId: string,
  groupOrder: Readonly<Record<string, number>>
): ReadonlyArray<SidebarItem<E>> => {
  const visible = entries.filter((e) => e.data.sidebar?.hidden !== true)
  const roots: Array<E> = []
  const groupMap = new Map<string, Array<E>>()
  for (const e of visible) {
    const parts = e.id.split("/")
    const dir = parts[0]
    if (parts.length === 1 || dir === undefined) {
      roots.push(e)
      continue
    }
    const list = groupMap.get(dir)
    if (list === undefined) groupMap.set(dir, [e])
    else list.push(e)
  }
  const groups: Array<SidebarGroupData<E>> = [...groupMap.entries()].map(([dir, es]) => ({
    dir,
    label: groupLabel(dir),
    entries: sortByOrderLabel(es, entryOrder, entryLabel),
    isOpen: es.some((e) => e.id === currentId)
  }))
  const orderOf = (g: SidebarGroupData<E>): number => {
    const configured = groupOrder[g.dir]
    if (configured !== undefined) return configured
    const min = Math.min(...g.entries.map(entryOrder).filter(Number.isFinite))
    return Number.isFinite(min) ? min : Infinity
  }
  return sortByOrderLabel<SidebarItem<E>>(
    [
      ...roots.map((entry): SidebarItem<E> => ({ kind: "entry", entry })),
      ...groups.map((group): SidebarItem<E> => ({ kind: "group", group }))
    ],
    (item) => (item.kind === "entry" ? entryOrder(item.entry) : orderOf(item.group)),
    (item) => (item.kind === "entry" ? entryLabel(item.entry) : item.group.label)
  )
}

/** Flat reading order (for prev / next links). */
export const flatten = <E extends DocEntry>(items: ReadonlyArray<SidebarItem<E>>): ReadonlyArray<E> =>
  items.flatMap((item) => (item.kind === "entry" ? [item.entry] : [...item.group.entries]))
