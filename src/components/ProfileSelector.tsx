'use client'

import { useRouter, useSearchParams } from 'next/navigation'

interface Profile {
  profile_id: number
  account_name: string | null
  marketplace: string
}

const MARKETPLACE_LABELS: Record<string, string> = {
  ATVPDKIKX0DER: 'US', A2EUQ1WTGCTBG2: 'CA', A1AM78C64UM0Y8: 'MX',
  A1PA6795UKMFR9: 'DE', A1RKKUPIHCS9HS: 'ES', A13V1IB3VIYZZH: 'FR',
  APJ6JRA9NG5V4:  'IT', A1F83G8C2ARO7P: 'UK', A21TJRUUN4KGV:  'IN',
  A1VC38T7YXB528: 'JP', AAHKV2X7PCTS1:  'CN', A39IBJ37TRP1C6: 'AU',
}

export default function ProfileSelector({
  profiles,
  currentProfileId,
}: {
  profiles: Profile[]
  currentProfileId: number
}) {
  const router = useRouter()
  const searchParams = useSearchParams()

  function onChange(e: React.ChangeEvent<HTMLSelectElement>) {
    const params = new URLSearchParams(searchParams.toString())
    params.set('profile_id', e.target.value)
    router.push(`/dashboard?${params.toString()}`)
  }

  return (
    <select
      value={currentProfileId}
      onChange={onChange}
      className="text-sm font-medium text-gray-700 bg-white border border-gray-200 rounded-xl px-3 py-1.5 shadow-sm focus:outline-none focus:ring-2 focus:ring-orange-400 cursor-pointer"
    >
      {profiles.map(p => {
        const mkt = MARKETPLACE_LABELS[p.marketplace] ?? p.marketplace
        return (
          <option key={p.profile_id} value={p.profile_id}>
            {p.account_name ?? `Profile ${p.profile_id}`} · {mkt}
          </option>
        )
      })}
    </select>
  )
}
