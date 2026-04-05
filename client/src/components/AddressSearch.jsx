import { useState, useEffect, useRef, useCallback } from 'react'
import { MapPin, Search, Loader2 } from 'lucide-react'

// Debounce hook
function useDebounce(value, delay) {
  const [debounced, setDebounced] = useState(value)
  useEffect(() => {
    const timer = setTimeout(() => setDebounced(value), delay)
    return () => clearTimeout(timer)
  }, [value, delay])
  return debounced
}

// Nominatim geocoding - free, no API key
async function searchAddress(query) {
  if (!query || query.length < 3) return []
  const url = `https://nominatim.openstreetmap.org/search?` +
    `q=${encodeURIComponent(query)}&format=json&addressdetails=1&limit=5&countrycodes=in`
  const res = await fetch(url, {
    headers: { 'Accept-Language': 'en', 'User-Agent': 'BreezMobility/1.0' }
  })
  if (!res.ok) return []
  const data = await res.json()
  return data.map(item => ({
    display: item.display_name,
    short: [item.address?.road, item.address?.suburb, item.address?.city].filter(Boolean).join(', ') || item.display_name.split(',').slice(0, 3).join(','),
    lat: parseFloat(item.lat),
    lng: parseFloat(item.lon),
  }))
}

export default function AddressSearch({ placeholder, value, onSelect, icon = 'pickup' }) {
  const [query, setQuery] = useState(value || '')
  const [results, setResults] = useState([])
  const [loading, setLoading] = useState(false)
  const [open, setOpen] = useState(false)
  const wrapperRef = useRef(null)

  const debouncedQuery = useDebounce(query, 400)

  // Search on debounced query change
  useEffect(() => {
    if (!debouncedQuery || debouncedQuery.length < 3) { setResults([]); return }
    let cancelled = false
    setLoading(true)
    searchAddress(debouncedQuery).then(res => {
      if (!cancelled) { setResults(res); setLoading(false); setOpen(true) }
    }).catch(() => { if (!cancelled) setLoading(false) })
    return () => { cancelled = true }
  }, [debouncedQuery])

  // Close dropdown on outside click
  useEffect(() => {
    const handler = (e) => {
      if (wrapperRef.current && !wrapperRef.current.contains(e.target)) setOpen(false)
    }
    document.addEventListener('mousedown', handler)
    return () => document.removeEventListener('mousedown', handler)
  }, [])

  // Update query when value prop changes (e.g. map pin drag)
  useEffect(() => {
    if (value && value !== query) setQuery(value)
  }, [value])

  const handleSelect = (result) => {
    setQuery(result.short)
    setOpen(false)
    setResults([])
    onSelect({ address: result.short, lat: result.lat, lng: result.lng, full: result.display })
  }

  const iconColor = icon === 'pickup' ? 'text-emerald-400' : 'text-red-400'

  return (
    <div ref={wrapperRef} className="relative">
      <div className="relative">
        <MapPin className={`absolute left-3 top-1/2 -translate-y-1/2 h-3.5 w-3.5 ${iconColor}`} />
        <input
          type="text"
          placeholder={placeholder}
          value={query}
          onChange={(e) => { setQuery(e.target.value); if (!e.target.value) onSelect(null) }}
          onFocus={() => results.length > 0 && setOpen(true)}
          className="flex h-9 w-full rounded-md border border-input bg-transparent pl-9 pr-8 py-1 text-sm shadow-sm transition-colors placeholder:text-muted-foreground focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring"
        />
        {loading && <Loader2 className="absolute right-3 top-1/2 -translate-y-1/2 h-3.5 w-3.5 animate-spin text-muted-foreground" />}
        {!loading && query.length >= 3 && <Search className="absolute right-3 top-1/2 -translate-y-1/2 h-3.5 w-3.5 text-muted-foreground" />}
      </div>

      {open && results.length > 0 && (
        <div className="absolute z-50 mt-1 w-full rounded-md border bg-card shadow-lg max-h-48 overflow-y-auto">
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