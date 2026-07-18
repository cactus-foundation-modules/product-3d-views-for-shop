'use client'

import { useEffect, useState } from 'react'
import { P3D_CONFIG_DEFAULTS, type P3dConfig } from '@/modules/product-3d-views-for-shop/lib/config'

// The 3D Viewer sub-tab, hosted inside shop's settings tab via the
// 'shop.settings-sub-tabs' slot (manifest `host`). Shop gives it the space and
// asks nothing else about it: its own fetch, its own save, its own permission
// check, its own module's API. Shop's "Save settings" button stands down while
// this is showing, because it would not save any of this.

const sectionHeading: React.CSSProperties = { margin: '0 0 0.25rem', fontSize: '1rem', fontWeight: 600 }
const sectionNote: React.CSSProperties = { margin: '0 0 1rem', fontSize: 'var(--text-sm)', color: 'var(--color-text-muted)' }
const checkboxRow: React.CSSProperties = { display: 'flex', alignItems: 'center', gap: 'var(--space-2)', marginBottom: 'var(--space-3)', cursor: 'pointer' }
const fieldGrid: React.CSSProperties = { display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '0.75rem', marginBottom: 'var(--form-gap)' }
const hint: React.CSSProperties = { display: 'block', marginTop: '0.25rem', fontSize: 'var(--text-sm)', color: 'var(--color-text-muted)' }

const TONE_MAPPING_LABELS: Record<P3dConfig['toneMapping'], string> = {
  none: 'None (as supplied)',
  aces: 'Filmic (ACES)',
  neutral: 'Neutral',
}

const SHADOW_SOFTNESS_LABELS: Record<P3dConfig['shadowSoftness'], string> = {
  sharp: 'Sharp',
  soft: 'Soft',
  softest: 'Softest',
}

const BACKGROUND_LABELS: Record<P3dConfig['background'], string> = {
  transparent: 'Transparent (follows the page)',
  colour: 'Solid colour',
  environment: 'Show the studio environment',
}

/** A labelled number input driven by a range slider, since every numeric setting
 *  here is "nudge it until it looks right", not "type the exact figure". */
function SliderField({
  label, value, min, max, step, disabled, onChange, help,
}: {
  label: string
  value: number
  min: number
  max: number
  step: number
  disabled?: boolean
  onChange: (value: number) => void
  help?: string
}) {
  return (
    <div className="field" style={{ margin: 0, opacity: disabled ? 0.5 : 1 }}>
      <label>
        {label} <span style={{ color: 'var(--color-text-muted)', fontWeight: 400 }}>{value}</span>
      </label>
      <input
        type="range"
        min={min}
        max={max}
        step={step}
        value={value}
        disabled={disabled}
        onChange={(e) => onChange(Number(e.target.value))}
      />
      {help && <span style={hint}>{help}</span>}
    </div>
  )
}

export function Settings3dTab() {
  const [config, setConfig] = useState<P3dConfig | null>(null)
  const [saving, setSaving] = useState(false)
  const [message, setMessage] = useState('')
  const [saveError, setSaveError] = useState('')
  const [forbidden, setForbidden] = useState(false)

  useEffect(() => {
    // no-store, same reason shop's tab does it: a cached copy served after a save
    // shows the pre-save values and reads as "it didn't save".
    fetch('/api/m/product-3d-views-for-shop/admin/settings', { cache: 'no-store' })
      .then(async (res) => {
        if (res.status === 403) { setForbidden(true); return }
        if (!res.ok) { setSaveError("Couldn't load the 3D viewer settings."); return }
        setConfig((await res.json()).config)
      })
      .catch(() => setSaveError("Couldn't reach the server. Check your connection and try again."))
  }, [])

  function set<K extends keyof P3dConfig>(key: K, value: P3dConfig[K]) {
    setConfig((c) => (c ? { ...c, [key]: value } : c))
    setMessage('')
  }

  async function save() {
    if (!config) return
    setSaving(true)
    setMessage('')
    setSaveError('')
    try {
      const res = await fetch('/api/m/product-3d-views-for-shop/admin/settings', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(config),
      })
      if (res.ok) {
        setConfig((await res.json()).config)
        setMessage('3D viewer settings saved.')
      } else {
        // Never fail silently - a swallowed non-2xx is exactly what makes a save
        // look like it did nothing.
        const data = await res.json().catch(() => null)
        setSaveError(data?.error ?? `Couldn't save (error ${res.status}). Please try again.`)
      }
    } catch {
      setSaveError("Couldn't reach the server. Check your connection and try again.")
    } finally {
      setSaving(false)
    }
  }

  if (forbidden) return <div>Only shop managers can view or change the 3D viewer settings.</div>
  if (!config) {
    return saveError
      ? <div className="alert alert-danger">{saveError}</div>
      : null
  }

  // Exposure is applied by the renderer as part of a tone curve, so with tone
  // mapping off there is nothing for it to scale. Greyed rather than hidden: a
  // field that vanishes reads as a bug, one that greys explains itself.
  const exposureDisabled = config.toneMapping === 'none'
  const isDefault = JSON.stringify(config) === JSON.stringify(P3D_CONFIG_DEFAULTS)

  return (
    <div>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: '1rem', marginBottom: 'var(--space-4)' }}>
        <p style={{ margin: 0, color: 'var(--color-text-muted)', fontSize: 'var(--text-sm)' }}>
          How every 3D model on the site is lit and handled. Applies to the whole catalogue, not one product.
        </p>
        <div style={{ display: 'flex', gap: '0.5rem', flexShrink: 0 }}>
          <button
            className="btn btn-secondary"
            type="button"
            disabled={saving || isDefault}
            onClick={() => { setConfig(P3D_CONFIG_DEFAULTS); setMessage('') }}
          >
            Reset to defaults
          </button>
          <button className="btn btn-primary" type="button" disabled={saving} onClick={save}>
            {saving ? 'Saving…' : 'Save 3D settings'}
          </button>
        </div>
      </div>

      {message && <div className="alert alert-success" style={{ marginBottom: '1rem' }}>{message}</div>}
      {saveError && <div className="alert alert-danger" style={{ marginBottom: '1rem' }}>{saveError}</div>}

      <div className="card" style={{ marginBottom: '1rem' }}>
        <h3 style={sectionHeading}>Lighting</h3>
        <p style={sectionNote}>
          The studio environment is what makes chrome, steel and glass look like metal rather than black
          plastic. Turn it down and shiny products go dark.
        </p>

        <label style={checkboxRow}>
          <input type="checkbox" checked={config.shadowsEnabled} onChange={(e) => set('shadowsEnabled', e.target.checked)} />
          Cast a shadow under the model
        </label>
        <p style={{ ...sectionNote, marginTop: '-0.5rem' }}>
          Grounds the model instead of leaving it floating. Worth a look at your own products first: a model
          whose picture already has a shadow painted into it will end up with two. Shadows are on the main
          viewer only, never the little spinning thumbnails, where they would cost real speed for something
          too small to see.
        </p>

        <div style={fieldGrid}>
          <div className="field" style={{ margin: 0, opacity: config.shadowsEnabled ? 1 : 0.5 }}>
            <label>Shadow edge</label>
            <select
              value={config.shadowSoftness}
              disabled={!config.shadowsEnabled}
              onChange={(e) => set('shadowSoftness', e.target.value as P3dConfig['shadowSoftness'])}
            >
              {Object.entries(SHADOW_SOFTNESS_LABELS).map(([key, label]) => (
                <option key={key} value={key}>{label}</option>
              ))}
            </select>
            <span style={hint}>Softer looks more natural and costs a little more to draw.</span>
          </div>
          <SliderField
            label="Shadow strength"
            value={config.shadowOpacity}
            min={0} max={1} step={0.05}
            disabled={!config.shadowsEnabled}
            onChange={(v) => set('shadowOpacity', v)}
          />
        </div>

        <div style={fieldGrid}>
          <div className="field" style={{ margin: 0 }}>
            <label>Colour handling</label>
            <select value={config.toneMapping} onChange={(e) => set('toneMapping', e.target.value as P3dConfig['toneMapping'])}>
              {Object.entries(TONE_MAPPING_LABELS).map(([key, label]) => (
                <option key={key} value={key}>{label}</option>
              ))}
            </select>
            <span style={hint}>
              If a model looks washed out here but right in the software it came from, try Filmic.
            </span>
          </div>
          <SliderField
            label="Brightness"
            value={config.exposure}
            min={0.1} max={3} step={0.05}
            disabled={exposureDisabled}
            onChange={(v) => set('exposure', v)}
            help={exposureDisabled ? 'Pick a colour handling other than None to use this.' : undefined}
          />
        </div>

        <div style={fieldGrid}>
          <SliderField label="Studio environment" value={config.environmentIntensity} min={0} max={3} step={0.05} onChange={(v) => set('environmentIntensity', v)} />
          <SliderField label="Overall light" value={config.ambientIntensity} min={0} max={5} step={0.05} onChange={(v) => set('ambientIntensity', v)} />
          <SliderField label="Main light" value={config.keyLightIntensity} min={0} max={5} step={0.05} onChange={(v) => set('keyLightIntensity', v)} />
          <SliderField label="Fill light" value={config.fillLightIntensity} min={0} max={5} step={0.05} onChange={(v) => set('fillLightIntensity', v)} />
        </div>
      </div>

      <div className="card" style={{ marginBottom: '1rem' }}>
        <h3 style={sectionHeading}>Stage</h3>
        <p style={sectionNote}>What sits behind the model in the main viewer.</p>

        <div style={fieldGrid}>
          <div className="field" style={{ margin: 0 }}>
            <label>Background</label>
            <select value={config.background} onChange={(e) => set('background', e.target.value as P3dConfig['background'])}>
              {Object.entries(BACKGROUND_LABELS).map(([key, label]) => (
                <option key={key} value={key}>{label}</option>
              ))}
            </select>
            <span style={hint}>Transparent suits most themes, and follows your light and dark modes for free.</span>
          </div>
          <div className="field" style={{ margin: 0, opacity: config.background === 'colour' ? 1 : 0.5 }}>
            <label>Background colour</label>
            <input
              type="color"
              value={config.backgroundColour}
              disabled={config.background !== 'colour'}
              onChange={(e) => set('backgroundColour', e.target.value)}
              style={{ height: '2.5rem', padding: '0.25rem' }}
            />
            <span style={hint}>Used only when the background is set to a solid colour.</span>
          </div>
        </div>
      </div>

      <div className="card" style={{ marginBottom: '1rem' }}>
        <h3 style={sectionHeading}>Handling</h3>
        <p style={sectionNote}>
          How the model behaves when a shopper takes hold of it. Anyone who has asked their device for less
          movement gets a still model regardless of the spin settings.
        </p>

        <label style={checkboxRow}>
          <input type="checkbox" checked={config.autoRotate} onChange={(e) => set('autoRotate', e.target.checked)} />
          Turn the model slowly until the shopper grabs it
        </label>
        <label style={checkboxRow}>
          <input
            type="checkbox"
            checked={config.spinModel}
            onChange={(e) => set('spinModel', e.target.checked)}
          />
          Spin the model itself, and leave its shadow where it is
        </label>
        <p style={{ ...sectionNote, marginTop: '-0.5rem' }}>
          Off, everything moves together: the idle spin and a shopper&rsquo;s drag both swing the view around
          the model, so its shadow appears to travel round with it. On, the model itself turns on the spot -
          idling or dragged sideways - while the shadow stays anchored to the floor beneath, changing shape as
          the model turns, which is what makes the turning obvious. Dragging up and down still tilts the view.
          Needs shadows switched on above to be worth anything.
        </p>
        <label style={checkboxRow}>
          <input type="checkbox" checked={config.enablePan} onChange={(e) => set('enablePan', e.target.checked)} />
          Let the shopper slide the model around
        </label>

        <div style={fieldGrid}>
          <SliderField
            label="Turn speed"
            value={config.autoRotateSpeed}
            min={0.1} max={10} step={0.1}
            disabled={!config.autoRotate}
            onChange={(v) => set('autoRotateSpeed', v)}
          />
          <SliderField
            label="Weight"
            value={config.dampingFactor}
            min={0.01} max={1} step={0.01}
            onChange={(v) => set('dampingFactor', v)}
            help="Lower feels heavier and glides further after a drag."
          />
          <SliderField
            label="Closest zoom"
            value={config.minDistance}
            min={0.1} max={50} step={0.1}
            onChange={(v) => set('minDistance', v)}
            help="Lower lets a shopper get nearer before the model stops them."
          />
          <SliderField
            label="Furthest zoom"
            value={config.maxDistance}
            min={0.1} max={50} step={0.1}
            onChange={(v) => set('maxDistance', v)}
            help="Must be greater than the closest zoom."
          />
          <SliderField
            label="Lens angle"
            value={config.fieldOfView}
            min={10} max={120} step={1}
            onChange={(v) => set('fieldOfView', v)}
            help="Lower flattens the model out. Higher exaggerates its depth."
          />
        </div>
      </div>

      <div className="card">
        <h3 style={sectionHeading}>Speed</h3>
        <p style={sectionNote}>
          Worth turning down only if shoppers on older phones report the viewer struggling. On anything
          modern the defaults are free.
        </p>

        <label style={checkboxRow}>
          <input type="checkbox" checked={config.antialias} onChange={(e) => set('antialias', e.target.checked)} />
          Smooth the model&rsquo;s edges
        </label>
        <label style={checkboxRow}>
          <input type="checkbox" checked={config.thumbnailAutoRotate} onChange={(e) => set('thumbnailAutoRotate', e.target.checked)} />
          Spin the small 3D thumbnails in the picture strip
        </label>

        <div style={fieldGrid}>
          <SliderField
            label="Sharpness limit"
            value={config.pixelRatioCap}
            min={1} max={3} step={0.5}
            onChange={(v) => set('pixelRatioCap', v)}
            help="Caps how sharp the viewer draws on high-resolution screens. 2 is plenty."
          />
          <SliderField
            label="Fine-detail sharpening"
            value={config.superSampling}
            min={1} max={2} step={0.25}
            onChange={(v) => set('superSampling', v)}
            help="Turn up if fine fabrics or fine detail look grainy or choppy when zoomed out. Draws extra detail and smooths it down, at a real cost to speed - 2 draws four times the work, so nudge it up only as far as it needs to go."
          />
        </div>
      </div>
    </div>
  )
}
