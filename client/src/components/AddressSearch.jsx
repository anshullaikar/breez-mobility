import { useState, useEffect, useRef } from 'react'
import { MapPin, Search, Loader2, Navigation } from 'lucide-react'

function useDebounce(value, delay) {
  const [debounced, setDebounced] = useState(value)
  useEffect(() => {
    const timer = setTimeout(() => setDebounced(value), delay)
    return () => clearTimeout(timer)
  }, [value, delay])
  return debounced
}

async function searchAddress(query) {
  if (!query || query.length < 3) return []
  const res = await fetch(
    `https://nominatim.openstreetmap.org/search?q=${encodeURIComponent(query)}&format=json&addressdetails=1&limit=5&countrycodes=in`,
    { headers: { 'Accept-Language': 'en', 'User-Agent': 'BreezMobility/1.0' } }
  )
  if (!res.ok) return []
  return (await res.json()).map(item => ({
    display: item.display_name,
    short: [item.address?.road, item.address?.suburb, item.address?.city].filter(Boolean).join(', ') || item.display_name.split(',').slice(0, 3).join(','),
    lat: parseFloat(item.lat),
    lng: parseFloat(item.lon),
  }))
}

async function reverseGeocode(lat, lng) {
  const res = await fetch(
    `https://nominatim.openstreetmap.org/reverse?lat=${lat}&lon=${lng}&format=json&addressdetails=1`,
    { headers: { 'Accept-Language': 'en', 'User-Agent': 'BreezMobility/1.0' } }
  )
  if (!res.ok) return null
  const data = await res.json()
  const short = [data.address?.road, data.address?.suburb, data.address?.city].filter(Boolean).join(', ')
  return { address: short || data.display_name.split(',').slice(0, 3).join(','), lat, lng, full: data.display_name }
}

export default function AddressSearch({ placeholder, value, onSelect, icon = 'pickup', onFocus }) {
  const [query, setQuery] = useState(value || '')
  const [results, setResults] = useState([])
  const [loading, setLoading] = useState(false)
  const [locating, setLocating] = useState(false)
  const [open, setOpen] = useState(false)
  const wrapperRef = useRef(null)
  const isFocused = useRef(false)          // ← add this
  const debouncedQuery = useDebounce(query, 400)

  useEffect(() => {
    if (!debouncedQuery || debouncedQuery.length < 3) { setResults([]); return }
    let cancelled = false
    setLoading(true)
    searchAddress(debouncedQuery).then(res => {
      if (!cancelled) { setResults(res); setLoading(false); setOpen(true) }
    }).catch(() => { if (!cancelled) setLoading(false) })
    return () => { cancelled = true }
  }, [debouncedQuery])

  useEffect(() => {
    const handler = (e) => { if (wrapperRef.current && !wrapperRef.current.contains(e.target)) setOpen(false) }
    document.addEventListener('mousedown', handler)
    return () => document.removeEventListener('mousedown', handler)
  }, [])

  useEffect(() => {
    if (!isFocused.current && value && value !== query) setQuery(value)
  }, [value])                              // ← add the isFocused guard

  const handleSelect = (result) => {
    setQuery(result.short)
    setOpen(false)
    setResults([])
    onSelect({ address: result.short, lat: result.lat, lng: result.lng })
  }

  const handleUseCurrentLocation = async () => {
    if (!navigator.geolocation) return
    setLocating(true)
    navigator.geolocation.getCurrentPosition(
      async (pos) => {
        const result = await reverseGeocode(pos.coords.latitude, pos.coords.longitude)
        if (result) {
          setQuery(result.address)
          onSelect(result)
        }
        setLocating(false)
      },
      () => setLocating(false),
      { enableHighAccuracy: true, timeout: 10000 }
    )
  }

  // Called from map when user taps/drags pin
  const handleMapSelect = async (lat, lng) => {
    const result = await reverseGeocode(lat, lng)
    if (result) {
      setQuery(result.address)
      onSelect(result)
    }
  }

  // Expose handleMapSelect via ref pattern
  useEffect(() => {
    if (wrapperRef.current) wrapperRef.current._handleMapSelect = handleMapSelect
  })

  const iconColor = icon === 'pickup' ? 'text-emerald-400' : 'text-red-400'

  return (
    <div ref={wrapperRef} className="relative">
      <div className="relative flex gap-1">
        <div className="relative flex-1">
          <MapPin className={`absolute left-3 top-1/2 -translate-y-1/2 h-3.5 w-3.5 ${iconColor}`} />
          <input
            type="text"
            placeholder={placeholder}
            value={query}
            onChange={(e) => { setQuery(e.target.value); if (!e.target.value) onSelect(null) }}
            onFocus={() => {
              isFocused.current = true      // ← set on focus
              results.length > 0 && setOpen(true)
              onFocus?.()
            }}
            className="flex h-9 w-full rounded-md border border-input bg-transparent pl-9 pr-3 py-1 text-sm shadow-sm transition-colors placeholder:text-muted-foreground focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring"
            onBlur={() => {
              isFocused.current = false     // ← clear on blur
            }}
          />
        </div>
        <button onClick={handleUseCurrentLocation} disabled={locating}
          className="h-9 w-9 rounded-md border border-input flex items-center justify-center hover:bg-accent transition-colors shrink-0"
          title="Use current location">
          {locating ? <Loader2 className="h-3.5 w-3.5 animate-spin text-muted-foreground" /> : <Navigation className="h-3.5 w-3.5 text-muted-foreground" />}
        </button>
      </div>

      {open && results.length > 0 && (
        <div className="absolute z-50 mt-1 w-full rounded-md border bg-card shadow-lg max-h-48 overflow-y-auto"     onMouseDown={(e) => e.preventDefault()}>
          {results.map((r, i) => (
            <button key={i} onClick={() => handleSelect(r)}
              className="w-full text-left px-3 py-2 text-sm hover:bg-accent transition-colors border-b border-border/50 last:border-0">
              <p className="font-medium truncate">{r.short}</p>
              <p className="text-xs text-muted-foreground truncate">{r.display}</p>
            </button>
          ))}
        </div>
      )}
    </div>
  )
}

export { reverseGeocode }