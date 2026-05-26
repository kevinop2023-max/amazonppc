'use client'

import { useState } from 'react'

type UserRow = {
  id: string
  email: string
  createdAt: string
  lastSignIn: string | null
  role: 'admin' | 'user'
}

function fmt(s: string | null) {
  if (!s) return '—'
  return new Date(s).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })
}

export default function UserRoleTable({ users, currentUserId }: { users: UserRow[]; currentUserId: string }) {
  const [roles, setRoles] = useState<Record<string, 'admin' | 'user'>>(() =>
    Object.fromEntries(users.map(u => [u.id, u.role]))
  )
  const [saving, setSaving] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)

  async function changeRole(userId: string, newRole: 'admin' | 'user') {
    setSaving(userId)
    setError(null)
    const res = await fetch('/api/admin/users', {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ user_id: userId, role: newRole }),
    })
    if (res.ok) {
      setRoles(prev => ({ ...prev, [userId]: newRole }))
    } else {
      const j = await res.json().catch(() => ({}))
      setError(j.error ?? 'Failed to update role')
    }
    setSaving(null)
  }

  return (
    <div className="bg-white rounded-2xl border border-gray-100 shadow-sm overflow-hidden">
      {error && (
        <div className="px-5 py-3 bg-red-50 border-b border-red-100 text-xs text-red-600 font-medium">{error}</div>
      )}
      <table className="w-full text-sm">
        <thead>
          <tr className="border-b border-gray-100 bg-gray-50 text-left">
            <th className="px-5 py-3 text-xs font-semibold text-gray-500 w-[40%]">Email</th>
            <th className="px-4 py-3 text-xs font-semibold text-gray-500">Role</th>
            <th className="px-4 py-3 text-xs font-semibold text-gray-500">Joined</th>
            <th className="px-4 py-3 text-xs font-semibold text-gray-500">Last sign-in</th>
            <th className="px-4 py-3 text-xs font-semibold text-gray-500"></th>
          </tr>
        </thead>
        <tbody>
          {users.map((u, i) => {
            const role = roles[u.id] ?? u.role
            const isSelf = u.id === currentUserId
            const isLoading = saving === u.id
            return (
              <tr key={u.id} className={`border-b border-gray-50 ${i % 2 === 0 ? '' : 'bg-gray-50/40'}`}>
                <td className="px-5 py-3.5">
                  <div className="flex items-center gap-2">
                    <span className="text-gray-800 font-medium text-sm truncate max-w-[260px]">{u.email}</span>
                    {isSelf && <span className="text-[10px] font-bold px-1.5 py-0.5 bg-orange-50 text-orange-600 rounded-md">you</span>}
                  </div>
                </td>
                <td className="px-4 py-3.5">
                  <span className={`inline-flex text-[11px] font-bold px-2 py-0.5 rounded-md ${
                    role === 'admin' ? 'bg-purple-50 text-purple-700' : 'bg-gray-100 text-gray-500'
                  }`}>
                    {role}
                  </span>
                </td>
                <td className="px-4 py-3.5 text-xs text-gray-500">{fmt(u.createdAt)}</td>
                <td className="px-4 py-3.5 text-xs text-gray-500">{fmt(u.lastSignIn)}</td>
                <td className="px-4 py-3.5">
                  {!isSelf && (
                    <button
                      onClick={() => changeRole(u.id, role === 'admin' ? 'user' : 'admin')}
                      disabled={isLoading}
                      className="text-xs font-semibold px-3 py-1.5 rounded-lg border border-gray-200 text-gray-600 hover:bg-orange-50 hover:border-orange-200 hover:text-orange-600 transition-all disabled:opacity-40"
                    >
                      {isLoading ? '…' : role === 'admin' ? 'Demote to user' : 'Promote to admin'}
                    </button>
                  )}
                </td>
              </tr>
            )
          })}
        </tbody>
      </table>
    </div>
  )
}
