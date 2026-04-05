import { useEffect, useRef, useCallback } from 'react'
import { MapContainer, TileLayer, Marker, Popup, useMap, useMapEvents, Polyline } from 'react-leaflet'
import L from 'leaflet'
import 'leaflet/dist/leaflet.css'

delete L.Icon.Default.prototype._getIconUrl
L.Icon.Default.mergeOptions({
  iconRetinaUrl: 'https://cdnjs.cloudflare.com/ajax/libs/leaflet/1.9.4/images/marker-icon-2x.png',
  iconUrl: 'https://cdnjs.cloudflare.com/ajax/libs/leaflet/1.9.4/images/marker-icon.png',
  shadowUrl: 'https://cdnjs.cloudflare.com/ajax/libs/leaflet/1.9.4/images/marker-shadow.png',
})

const pickupIcon = new L.DivIcon({
  html: `<div style="background:#34d399;width:16px;height:16px;border-radius:50%;border:3px solid #fff;box-shadow:0 2px 8px rgba(0,0,0,0.3)"></div>`,
  className: '', iconSize: [16, 16], iconAnchor: [8, 8],
})
const dropIcon = new L.DivIcon({
  html: `<div style="background:#f87171;width:16px;height:16px;border-radius:50%;border:3px solid #fff;box-shadow:0 2px 8px rgba(0,0,0,0.3)"></div>`,
  className: '', iconSize: [16, 16], iconAnchor: [8, 8],
})
const driverIcon = new L.DivIcon({
  html: `<div style="background:#60a5fa;width:16px;height:16px;border-radius:50%;border:3px solid #fff;box-shadow:0 2px 8px rgba(0,0,0,0.3)"></div>`,
  className: '', iconSize: [16, 16], iconAnchor: [8, 8],
})

function haversineKm(lat1, lng1, lat2, lng2) {
  const R = 6371
  const dLat = (lat2 - lat1) * Math.PI / 180
  const dLng = (lng2 - lng1) * Math.PI / 180
  const a = Math.sin(dLat / 2) ** 2 + Math.cos(lat1 * Math.PI / 180) * Math.cos(lat2 * Math.PI / 180) * Math.sin(dLng / 2) ** 2
  return R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a))
}

function formatEta(km) {
  const minutes = Math.round((km / 25) * 60)
  if (minutes < 1) return 'Arriving now'
  if (minutes < 60) return `${minutes} min`
  return `${Math.floor(minutes / 60)}h ${minutes % 60}m`
}

function FitBounds({ points }) {
  const map = useMap()
  const prevKey = useRef('')
  useEffect(() => {
    const key = points.map(p => `${p[0].toFixed(3)},${p[1].toFixed(3)}`).join('|')
    if (key === prevKey.current) return
    prevKey.current = key
    if (points.length >= 2) map.fitBounds(L.latLngBounds(points), { padding: [40, 40], maxZoom: 15 })
    else if (points.length === 1) map.setView(points[0], 14)
  }, [points.map(p => `${p[0].toFixed(3)},${p[1].toFixed(3)}`).join('|')])
  return null
}

// Allows clicking on map to set a location
function MapClickHandler({ onMapClick, enabled }) {
  useMapEvents({
    click: (e) => {
      if (enabled && onMapClick) onMapClick(e.latlng.lat, e.latlng.lng)
    },
  })
  return null
}

export default function PassengerMap({ pickup, drop, driverLocation, rideStatus, mode = 'view', onMapClick }) {
  const points = []
  if (pickup) points.push([pickup.lat, pickup.lng])
  if (drop) points.push([drop.lat, drop.lng])
  if (driverLocation) points.push([driverLocation.lat, driverLocation.lng])

  const center = pickup ? [pickup.lat, pickup.lng] : drop ? [drop.lat, drop.lng] : [28.6139, 77.2090]

  const isDriverTracked = driverLocation && ['EN_ROUTE', 'ARRIVED', 'IN_PROGRESS'].includes(rideStatus)
  let etaInfo = null
  if (isDriverTracked && pickup && rideStatus === 'EN_ROUTE') {
    const dist = haversineKm(driverLocation.lat, driverLocation.lng, pickup.lat, pickup.lng)
    etaInfo = { label: 'Driver arriving', dist, eta: formatEta(dist) }
  } else if (isDriverTracked && drop && rideStatus === 'IN_PROGRESS') {
    const dist = haversineKm(driverLocation.lat, driverLocation.lng, drop.lat, drop.lng)
    etaInfo = { label: 'To destination', dist, eta: formatEta(dist) }
  } else if (rideStatus === 'ARRIVED') {
    etaInfo = { label: 'Driver waiting at pickup', dist: 0, eta: 'Arrived' }
  } else if (pickup && drop) {
    const dist = haversineKm(pickup.lat, pickup.lng, drop.lat, drop.lng)
    etaInfo = { label: 'Trip distance', dist, eta: formatEta(dist) }
  }

  const routeLine = []
  if (driverLocation && pickup && ['EN_ROUTE', 'ASSIGNED'].includes(rideStatus)) {
    routeLine.push([driverLocation.lat, driverLocation.lng], [pickup.lat, pickup.lng])
  } else if (driverLocation && drop && rideStatus === 'IN_PROGRESS') {
    routeLine.push([driverLocation.lat, driverLocation.lng], [drop.lat, drop.lng])
  } else if (pickup && drop) {
    routeLine.push([pickup.lat, pickup.lng], [drop.lat, drop.lng])
  }

  const isBookingMode = mode === 'booking'

  return (
    <div className="space-y-2">
      <div className="rounded-lg overflow-hidden border border-border relative" style={{ height: isBookingMode ? '200px' : '240px' }}>
        <MapContainer center={center} zoom={13} style={{ height: '100%', width: '100%' }}
          zoomControl={false} attributionControl={false}>
          <TileLayer url="https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png" />
          {points.length > 0 && <FitBounds points={points} />}
          <MapClickHandler onMapClick={onMapClick} enabled={isBookingMode} />

          {pickup && (
            <Marker position={[pickup.lat, pickup.lng]} icon={pickupIcon}>
              <Popup><span style={{ fontSize: '12px' }}>Pickup: {pickup.address}</span></Popup>
            </Marker>
          )}
          {drop && (
            <Marker position={[drop.lat, drop.lng]} icon={dropIcon}>
              <Popup><span style={{ fontSize: '12px' }}>Drop: {drop.address}</span></Popup>
            </Marker>
          )}
          {driverLocation && isDriverTracked && (
            <Marker position={[driverLocation.lat, driverLocation.lng]} icon={driverIcon}>
              <Popup><span style={{ fontSize: '12px' }}>Your driver</span></Popup>
            </Marker>
          )}
          {routeLine.length === 2 && (
            <Polyline positions={routeLine} pathOptions={{
              color: rideStatus === 'IN_PROGRESS' ? '#34d399' : '#60a5fa',
              weight: 3, dashArray: '8 8', opacity: 0.7,
            }} />
          )}
        </MapContainer>
        {isBookingMode && (
          <div className="absolute bottom-2 left-2 bg-card/90 backdrop-blur-sm text-[10px] text-muted-foreground px-2 py-1 rounded z-[1000]">
            Tap map to set {!pickup ? 'pickup' : !drop ? 'drop-off' : 'location'}
          </div>
        )}
      </div>
      {etaInfo && (
        <div className="flex items-center justify-between text-xs bg-accent/50 rounded-lg px-3 py-2">
          <span className="text-muted-foreground">{etaInfo.label}</span>
          <span className="font-medium">
            {etaInfo.dist > 0 ? `${etaInfo.dist.toFixed(1)} km · ` : ''}{etaInfo.eta}
          </span>
        </div>
      )}
    </div>
  )
}

export { haversineKm }