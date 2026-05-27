'use client'

export default function LocalTime({ iso, options }: {
  iso: string
  options?: Intl.DateTimeFormatOptions
}) {
  return (
    <span suppressHydrationWarning>
      {new Date(iso).toLocaleString('en-US', options)}
    </span>
  )
}
