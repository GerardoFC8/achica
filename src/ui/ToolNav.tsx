import { linksIn } from '../tools/links'
import { useCopy } from './copy'
import { useTool } from './tool-context'

/**
 * The way between tools: plain text links to the same site in the page's own
 * language, read from the registry. It hides itself while there is only one
 * tool to go to.
 *
 * The current tool is not a link, and says so with aria-current: a link to
 * the page you are on is a click that does nothing.
 */

const ITEM =
  'flex h-8 items-center border-b-2 px-2 text-[13px] leading-4 whitespace-nowrap coarse:min-h-11'

export function ToolNav() {
  const copy = useCopy()
  const current = useTool()
  const links = linksIn(copy.lang)

  if (links.length < 2) return null

  return (
    <nav aria-label={copy.nav.label}>
      <ul className="flex flex-wrap items-center">
        {links.map((link) => (
          <li key={link.id}>
            {link.id === current ? (
              <span aria-current="page" className={`${ITEM} border-ink font-medium text-ink`}>
                {copy.nav.tools[link.id]}
              </span>
            ) : (
              <a
                href={link.path}
                className={`${ITEM} border-transparent text-ink-soft hover:text-ink`}
              >
                {copy.nav.tools[link.id]}
              </a>
            )}
          </li>
        ))}
      </ul>
    </nav>
  )
}
