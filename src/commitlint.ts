import { defaultTrackerConfig } from './config.js'
import type { TrackerProvider } from './types.js'

export function trackerFooterPattern(provider: TrackerProvider): RegExp {
  const tracker = defaultTrackerConfig(provider)
  return new RegExp(
    `^(?:[Cc]lose|[Cc]loses|[Cc]losed|[Cc]losing|[Ff]ix|[Ff]ixes|[Ff]ixed|[Ff]ixing|[Rr]esolve|[Rr]esolves|[Rr]esolved|[Rr]esolving|[Cc]omplete|[Cc]ompletes|[Cc]ompleted|[Cc]ompleting|[Ii]mplements|[Ii]mplemented|[Ii]mplementing|[Rr]ef|[Rr]efs|[Rr]eferences|[Pp]art of|[Rr]elated to|[Cc]ontributes to)\\s+(?:${tracker.keyPattern})$`
  )
}
