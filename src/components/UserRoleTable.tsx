'use client'

import { useState } from 'react'
import { useRouter } from 'next/navigation'

export type UserRow = {
  id: string
  email: string
  name: string
  createdAt: string
  lastSignIn: string | null
  role: 'admin' | 'user'
}

type Modal =
  | { mode: 'edit'; user: UserRow }
  | { mode: 'add' }
  | { mode: 'delete'; user: UserRow }
  | null

function fmt(s: string | null) {
  if (!s) return '—'
  return new Date(s).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })
}

function RolePill({ role }: { role: 'admin' | 'user' }) {
  return (
    <span className={`inline-flex text-[11px] font-bold px-2 py-0.5 rounded-md ${
      role === 'admin' ? 'bg-purple-50 text-purple-700' : 'bg-gray-100 text-gray-500'
    }`}>
      {role}
    </span>
  )
}

// ── Shared modal shell ─────────────────────────────────────────────────────────

function Modal({ title, onClose, children }: { title: string; onClose: () => void; children: React.ReactNode }) {
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
      <div className="absolute inset-0 bg-black/30 backdrop-blur-sm" onClick={onClose} />
      <div className="relative bg-white rounded-2xl shadow-xl border border-gray-100 w-full max-w-md">
        <div className="flex items-center justify-between px-6 py-4 border-b border-gray-100">
          <h2 className="text-base font-semibold text-gray-900">{title}</h2>
          <button onClick={onClose} className="text-gray-400 hover:text-gray-600 transition-colors text-lg leading-none">✕</button>
        </div>
        <div className="px-6 py-5">{children}</div>
      </div>
    </div>
  )
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="space-y-1.5">
      <label className="block text-xs font-semibold text-gray-600">{label}</label>
      {children}
    </div>
  )
}

const inputCls = 'w-full text-sm border border-gray-200 rounded-lg px-3 py-2 outline-none focus:border-orange-300 focus:ring-1 focus:ring-orange-100 transition-all placeholder:text-gray-300'

// ── Edit user modal ────────────────────────────────────────────────────────────

function EditModal({ user, currentUserId, onClose, onSaved }: {
  user: UserRow; currentUserId: string; onClose: () => void; onSaved: () => void
}) {
  const isSelf = user.id === currentUserId
  const [name, setName]         = useState(user.name)
  const [password, setPassword] = useState('')
  const [role, setRole]         = useState<'admin' | 'user'>(user.role)
  const [saving, setSaving]     = useState(false)
  const [error, setError]       = useState<string | null>(null)
  const [showDelete, setShowDelete] = useState(false)
  const [deleting, setDeleting] = useState(false)

  async function save() {
    setSaving(true); setError(null)
    const body: Record<string, unknown> = { user_id: user.id }
    if (name !== user.name) body.name = name
    if (password)           body.password = password
    if (role !== user.role) body.role = role

    const res = await fetch('/api/admin/users', {
      method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body),
    })
    if (res.ok) { onSaved() }
    else { const j = await res.json().catch(() => ({})); setError(j.error ?? 'Save failed') }
    setSaving(false)
  }

  async function deleteUser() {
    setDeleting(true); setError(null)
    const res = await fetch('/api/admin/users', {
      method: 'DELETE', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ user_id: user.id }),
    })
    if (res.ok) { onSaved() }
    else { const j = await res.json().catch(() => ({})); setError(j.error ?? 'Delete failed') }
    setDeleting(false)
  }

  if (showDelete) {
    return (
      <Modal title="Delete user?" onClose={onClose}>
        <p className="text-sm text-gray-600 mb-1">This permanently deletes <span className="font-semibold text-gray-900">{user.email}</span> and cannot be undone.</p>
        {error && <p className="text-xs text-red-600 mt-2">{error}</p>}
        <div className="flex gap-3 mt-5">
          <button onClick={() => setShowDelete(false)} className="flex-1 px-4 py-2 text-sm font-semibold rounded-xl border border-gray-200 text-gray-600 hover:bg-gray-50 transition-all">
            Cancel
          </button>
          <button onClick={deleteUser} disabled={deleting} className="flex-1 px-4 py-2 text-sm font-semibold rounded-xl bg-red-500 hover:bg-red-600 text-white transition-all disabled:opacity-50">
            {deleting ? 'Deleting…' : 'Delete'}
          </button>
        </div>
      </Modal>
    )
  }

  return (
    <Modal title="Edit user" onClose={onClose}>
      <div className="space-y-4">
        <Field label="Email">
          <p className="text-sm text-gray-500 py-2">{user.email}</p>
        </Field>
        <Field label="Display name">
          <input className={inputCls} value={name} onChange={e => setName(e.target.value)} placeholder="Full name" />
        </Field>
        <Field label="New password">
          <input className={inputCls} type="password" value={password} onChange={e => setPassword(e.target.value)} placeholder="Leave blank to keep current" />
        </Field>
        {!isSelf && (
          <Field label="Role">
            <select className={inputCls} value={role} onChange={e => setRole(e.target.value as 'admin' | 'user')}>
              <option value="user">User</option>
              <option value="admin">Admin</option>
            </select>
          </Field>
        )}
        {error && <p className="text-xs text-red-600">{error}</p>}
        <div className="flex items-center gap-3 pt-1">
          {!isSelf && (
            <button onClick={() => setShowDelete(true)} className="text-xs font-semibold text-red-500 hover:text-red-700 transition-colors mr-auto">
              Delete user
            </button>
          )}
          <button onClick={onClose} className="px-4 py-2 text-sm font-semibold rounded-xl border border-gray-200 text-gray-600 hover:bg-gray-50 transition-all">
            Cancel
          </button>
          <button onClick={save} disabled={saving} className="px-4 py-2 text-sm font-semibold rounded-xl bg-orange-500 hover:bg-orange-600 text-white transition-all disabled:opacity-50">
            {saving ? 'Saving…' : 'Save'}
          </button>
        </div>
      </div>
    </Modal>
  )
}

// ── Add user modal ─────────────────────────────────────────────────────────────

function AddModal({ onClose, onSaved }: { onClose: () => void; onSaved: () => void }) {
  const [email, setEmail]       = useState('')
  const [name, setName]         = useState('')
  const [password, setPassword] = useState('')
  const [role, setRole]         = useState<'admin' | 'user'>('user')
  const [saving, setSaving]     = useState(false)
  const [error, setError]       = useState<string | null>(null)

  async function create() {
    if (!email || !password) { setError('Email and password are required'); return }
    setSaving(true); setError(null)
    const res = await fetch('/api/admin/users', {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email, name, password, role }),
    })
    if (res.ok) { onSaved() }
    else { const j = await res.json().catch(() => ({})); setError(j.error ?? 'Failed to create user') }
    setSaving(false)
  }

  return (
    <Modal title="Add user" onClose={onClose}>
      <div className="space-y-4">
        <Field label="Email *">
          <input className={inputCls} type="email" value={email} onChange={e => setEmail(e.target.value)} placeholder="user@example.com" />
        </Field>
        <Field label="Display name">
          <input className={inputCls} value={name} onChange={e => setName(e.target.value)} placeholder="Full name" />
        </Field>
        <Field label="Password *">
          <input className={inputCls} type="password" value={password} onChange={e => setPassword(e.target.value)} placeholder="Minimum 6 characters" />
        </Field>
        <Field label="Role">
          <select className={inputCls} value={role} onChange={e => setRole(e.target.value as 'admin' | 'user')}>
            <option value="user">User</option>
            <option value="admin">Admin</option>
          </select>
        </Field>
        {error && <p className="text-xs text-red-600">{error}</p>}
        <div className="flex gap-3 pt-1">
          <button onClick={onClose} className="flex-1 px-4 py-2 text-sm font-semibold rounded-xl border border-gray-200 text-gray-600 hover:bg-gray-50 transition-all">
            Cancel
          </button>
          <button onClick={create} disabled={saving} className="flex-1 px-4 py-2 text-sm font-semibold rounded-xl bg-orange-500 hover:bg-orange-600 text-white transition-all disabled:opacity-50">
            {saving ? 'Creating…' : 'Create user'}
          </button>
        </div>
      </div>
    </Modal>
  )
}

// ── Main table ─────────────────────────────────────────────────────────────────

export default function UserRoleTable({ users: initial, currentUserId }: { users: UserRow[]; currentUserId: string }) {
  const router = useRouter()
  const [modal, setModal] = useState<Modal>(null)

  function closeAndRefresh() {
    setModal(null)
    router.refresh()
  }

  return (
    <>
      <div className="bg-white rounded-2xl border border-gray-100 shadow-sm overflow-hidden">
        {/* Header bar */}
        <div className="flex items-center justify-between px-5 py-3.5 border-b border-gray-100 bg-gray-50">
          <span className="text-xs text-gray-400">{initial.length} account{initial.length !== 1 ? 's' : ''} — click a row to edit</span>
          <button
            onClick={() => setModal({ mode: 'add' })}
            className="flex items-center gap-1.5 px-3.5 py-1.5 text-xs font-semibold rounded-lg bg-orange-500 hover:bg-orange-600 text-white transition-all shadow-sm"
          >
            + Add user
          </button>
        </div>

        <table className="w-full text-sm">
          <thead>
            <tr className="border-b border-gray-100 text-left">
              <th className="px-5 py-3 text-xs font-semibold text-gray-500">Name / Email</th>
              <th className="px-4 py-3 text-xs font-semibold text-gray-500">Role</th>
              <th className="px-4 py-3 text-xs font-semibold text-gray-500">Joined</th>
              <th className="px-4 py-3 text-xs font-semibold text-gray-500">Last sign-in</th>
            </tr>
          </thead>
          <tbody>
            {initial.map((u, i) => {
              const isSelf = u.id === currentUserId
              return (
                <tr
                  key={u.id}
                  onClick={() => setModal({ mode: 'edit', user: u })}
                  className={`border-b border-gray-50 cursor-pointer transition-colors hover:bg-orange-50/40 ${i % 2 === 0 ? '' : 'bg-gray-50/30'}`}
                >
                  <td className="px-5 py-3.5">
                    <div className="flex flex-col gap-0.5">
                      <div className="flex items-center gap-2">
                        <span className="text-gray-800 font-medium text-sm truncate max-w-[260px]">
                          {u.name || u.email}
                        </span>
                        {isSelf && <span className="text-[10px] font-bold px-1.5 py-0.5 bg-orange-50 text-orange-600 rounded-md shrink-0">you</span>}
                      </div>
                      {u.name && <span className="text-xs text-gray-400 truncate max-w-[260px]">{u.email}</span>}
                    </div>
                  </td>
                  <td className="px-4 py-3.5"><RolePill role={u.role} /></td>
                  <td className="px-4 py-3.5 text-xs text-gray-500">{fmt(u.createdAt)}</td>
                  <td className="px-4 py-3.5 text-xs text-gray-500">{fmt(u.lastSignIn)}</td>
                </tr>
              )
            })}
          </tbody>
        </table>
      </div>

      {modal?.mode === 'edit' && (
        <EditModal user={modal.user} currentUserId={currentUserId} onClose={() => setModal(null)} onSaved={closeAndRefresh} />
      )}
      {modal?.mode === 'add' && (
        <AddModal onClose={() => setModal(null)} onSaved={closeAndRefresh} />
      )}
    </>
  )
}
