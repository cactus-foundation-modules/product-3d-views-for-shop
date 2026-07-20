'use client'

// "That name is already taken" - asked before a model's bytes are sent.
//
// Both surfaces that upload a model (the Variations tab's 3D column and the
// pick-a-model dialogue) need the same question, so it lives here as a hook: the
// caller renders `dialog` and passes `ask` to uploadModel, which pauses on it.
//
// The question is worth asking rather than deciding. Overwriting loses a file the
// site owner may still be using; renaming quietly leaves two near-identical models
// and a public url nobody chose. Neither is a safe guess.

import { useCallback, useState } from 'react'
import type { ModelClashAsk, ModelClashChoice } from '@/modules/product-3d-views-for-shop/lib/upload-model-client'

type Pending = {
  existingName: string
  suggestedName: string
  resolve: (choice: ModelClashChoice) => void
}

export function useModelClashPrompt(): { ask: ModelClashAsk; dialog: React.ReactNode } {
  // The uploader awaits the promise `ask` hands back; the buttons settle it.
  const [pending, setPending] = useState<Pending | null>(null)

  const ask = useCallback<ModelClashAsk>((info) => {
    return new Promise<ModelClashChoice>((resolve) => setPending({ ...info, resolve }))
  }, [])

  const choose = useCallback((choice: ModelClashChoice) => {
    pending?.resolve(choice)
    setPending(null)
  }, [pending])

  const dialog = pending ? (
    <div
      role="dialog"
      aria-modal="true"
      style={{ position: 'fixed', inset: 0, zIndex: 10001, background: 'var(--color-overlay)', display: 'flex', alignItems: 'center', justifyContent: 'center', padding: '1.5rem' }}
      onClick={(e) => e.target === e.currentTarget && choose('cancel')}
    >
      <div style={{ background: 'var(--color-surface)', color: 'var(--color-text)', border: '1px solid var(--color-border)', borderRadius: 8, maxWidth: 'min(460px, 92vw)', width: '100%', padding: '1.25rem', display: 'flex', flexDirection: 'column', gap: '0.75rem', boxShadow: '0 25px 50px -12px rgba(0,0,0,.25)' }}>
        <h3 style={{ margin: 0, fontSize: '1rem', fontWeight: 600 }}>“{pending.existingName}” is already here</h3>
        <p style={{ margin: 0, fontSize: '0.875rem', color: 'var(--color-text-muted)' }}>
          A 3D file with that name is already filed with this product. Replace it (anything showing it switches to the new model), or keep both and upload this one as “{pending.suggestedName}”.
        </p>
        <div style={{ display: 'flex', gap: '0.5rem', justifyContent: 'flex-end', flexWrap: 'wrap', marginTop: '0.25rem' }}>
          <button type="button" className="btn btn-secondary btn-sm" onClick={() => choose('cancel')}>Cancel</button>
          <button type="button" className="btn btn-danger btn-sm" onClick={() => choose('replace')}>Replace</button>
          <button type="button" className="btn btn-primary btn-sm" onClick={() => choose('suffix')}>Keep both</button>
        </div>
      </div>
    </div>
  ) : null

  return { ask, dialog }
}
