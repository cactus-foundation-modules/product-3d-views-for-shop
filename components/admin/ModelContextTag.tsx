'use client'

// The little context tag beside a model: which add-on combination the file
// shows. Untagged (the overwhelming majority) is the base model and shows a
// muted "＋ tag"; tagged shows the key and clicking either opens a small
// inline editor. Saves through the model PATCH route, which normalises the
// key order so however it is typed, it matches the storefront's sorted join.
import { useState } from 'react'

export function ModelContextTag({ model, onSaved }: {
  model: { id: string; context?: string }
  onSaved: () => void
}) {
  const [editing, setEditing] = useState(false)
  const [draft, setDraft] = useState(model.context ?? '')
  const [error, setError] = useState<string | null>(null)
  const [saving, setSaving] = useState(false)

  async function save() {
    setSaving(true)
    setError(null)
    const res = await fetch(`/api/m/product-3d-views-for-shop/admin/models/${model.id}`, {
      method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ context: draft }),
    })
    setSaving(false)
    if (!res.ok) {
      setError((await res.json().catch(() => ({}))).error ?? 'Could not save that tag.')
      return
    }
    setEditing(false)
    onSaved()
  }

  if (!editing) {
    const tagged = !!(model.context ?? '')
    return (
      <button
        type="button"
        onClick={() => { setDraft(model.context ?? ''); setEditing(true) }}
        title={tagged
          ? `Shown with the “${model.context}” add-on combination - click to change`
          : 'Base model. Click to tag it to an add-on combination (e.g. screens, or shelves:2)'}
        style={{
          border: '1px dashed var(--color-border)', background: 'none', borderRadius: 999,
          padding: '0.05rem 0.375rem', fontSize: '0.625rem', cursor: 'pointer',
          color: tagged ? 'var(--color-primary)' : 'var(--color-text-muted)', fontFamily: 'inherit',
          ...(tagged ? { borderStyle: 'solid', borderColor: 'var(--color-primary)' } : {}),
        }}
      >
        {tagged ? model.context : '＋ tag'}
      </button>
    )
  }

  return (
    <span style={{ display: 'inline-flex', gap: '0.25rem', alignItems: 'center', flexWrap: 'wrap' }}>
      <input
        autoFocus
        value={draft}
        placeholder="e.g. screens"
        onChange={(e) => setDraft(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === 'Enter') { e.preventDefault(); void save() }
          if (e.key === 'Escape') setEditing(false)
        }}
        style={{ width: 110, padding: '0.125rem 0.375rem', borderRadius: 6, border: '1px solid var(--color-border)', background: 'var(--color-bg)', color: 'var(--color-text)', fontSize: '0.6875rem' }}
        aria-label="Add-on combination tag for this model"
      />
      <button type="button" onClick={() => void save()} disabled={saving} style={{ border: 'none', background: 'var(--color-primary)', color: 'var(--color-on-primary)', borderRadius: 6, padding: '0.125rem 0.5rem', fontSize: '0.6875rem', cursor: 'pointer', fontFamily: 'inherit' }}>
        {saving ? '…' : 'Save'}
      </button>
      <button type="button" onClick={() => setEditing(false)} style={{ border: 'none', background: 'none', color: 'var(--color-text-muted)', fontSize: '0.6875rem', cursor: 'pointer', fontFamily: 'inherit' }}>
        Cancel
      </button>
      {error && <span role="alert" style={{ color: 'var(--color-danger)', fontSize: '0.625rem' }}>{error}</span>}
    </span>
  )
}
