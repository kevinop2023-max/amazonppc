import { redirect } from 'next/navigation'

export default function KeywordsRedirect({ searchParams }: { searchParams: Record<string, string> }) {
  const qs = new URLSearchParams(searchParams).toString()
  redirect(`/dashboard/targeting${qs ? '?' + qs : ''}`)
}
