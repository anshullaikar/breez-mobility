import { useEffect, useRef, useState, useCallback } from 'react'
import { MapContainer, TileLayer, Marker, Popup, useMap, Polyline } from 'react-leaflet'
import L from 'leaflet'
import 'leaflet/dist/leaflet.css'
import { api } from '@/lib/api'

// Fix leaflet default icon issue with bundlers
delete L.Icon.Default.prototype._getIconUrl
L.Icon.Default.mergeOptions({
  iconRetinaUrl: 'https://cdnjs.cloudflare.com/ajax/libs/leaflet/1.9.4/images/marker-icon-2x.png',
  iconUrl: 'https://cdnjs.cloudflare.com/ajax/libs/leaflet/1.9.4/images/marker-icon.png',
  shadowUrl: 'https://cdnjs.cloudflare.com/ajax/libs/leaflet/1.9.4/images/marker-shadow.png',
})

const driverIcon = new L.DivIcon({
  html: `<div style="background:#34d399;width:14px;height:14px;border-radius:50%;border:3px solid #fff;box-shadow:0 2px 6px rgba(0,0,0,0.3)"></div>`,
  className: '', iconSize: [14, 14], iconAnchor: [7, 7],
})

const pickupIcon = new L.DivIcon({
  html: `<div style="background:#60a5fa;width:14px;height:14px;border-radius:50%;border:3px solid #fff;box-shadow:0 2px 6px rgba(0,0,0,0.3)"></div>`,
  className: '', iconSize: [14, 14], iconAnchor: [7, 7],
})

const dropIcon = new L.DivIcon({
  html: `<div style="background:#f87171;width:14px;height:14px;border-radius:50%;border:3px solid #fff;box-shadow:0 2px 6px rgba(0,0,0,0.3)"></div>`,
  className: '', iconSize: [14, 14], iconAnchor: [7, 7],
})

function haversineKm(lat1, lng1, lat2, lng2) {
  const R = 6371
  const dLat = (lat2 - lat1) * Math.PI / 180
  const dLng = (lng2 - lng1) * Math.PI / 180
  const a = Math.sin(dLat / 2) ** 2 + Math.cos(lat1 * Math.PI / 180) * Math.cos(lat2 * Math.PI / 180) * Math.sin(dLng / 2) ** 2
  return R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a))
}

function formatEta(km) {
  // Assume avg 25 km/h in city traffic
  const minutes = Math.round((km / 25) * 60)
  if (minutes < 1) return 'Arriving now'
  if (minutes < 60) return `${minutes} min`
  return `${Math.floor(minutes / 60)}h ${minutes % 60}m`
}

// Sub-component to fly map to bounds when ride changes
function FitBounds({ points }) {
  const map = useMap()
  useEffect(() => {
    if (points.length >= 2) {
      const bounds = L.latLngBounds(points)
      map.fitBounds(bounds, { padding: [50, 50], maxZoom: 15 })
    } else if (points.length === 1) {
      map.setView(points[0], 14)
    }
  }, [points.map(p => `${p[0]},${p[1]}`).join('|')])
  return null
}

export default function DriverMap({ activeRide, driverLocation, onLocationUpdate, token, liveTracking }) {
  const [driverPos, setDriverPos] = useState(driverLocation || { lat: 19.076, lng: 72.8777 })
  const markerRef = useRef(null)

  // Update driver pos when external location changes (live tracking)
  useEffect(() => {
    if (driverLocation) setDriverPos(driverLocation)
  }, [driverLocation?.lat, driverLocation?.lng])

  const handleDragEnd = useCallback(() => {
    const marker = markerRef.current
    if (marker) {
      const { lat, lng } = marker.getLatLng()
      setDriverPos({ lat, lng })
      if (onLocationUpdate) onLocationUpdate(lat, lng)
    }
  }, [onLocationUpdate])

  // Calculate distances and ETAs
  const pickupLat = activeRide?.pickupLat
  const pickupLng = activeRide?.pickupLng
  const dropLat = activeRide?.dropLat
  const dropLng = activeRide?.dropLng

  const distToPickup = pickupLat ? haversineKm(driverPos.lat, driverPos.lng, pickupLat, pickupLng) : null
  const distToDrop = dropLat ? haversineKm(driverPos.lat, driverPos.lng, dropLat, dropLng) : null
  const totalRideDist = (pickupLat && dropLat) ? haversineKm(pickupLat, pickupLng, dropLat, dropLng) : null

  // Build points array for fitting bounds
  const points = [[driverPos.lat, driverPos.lng]]
  if (pickupLat) points.push([pickupLat, pickupLng])
  if (dropLat) points.push([dropLat, dropLng])

  // Route line from driver to next destination
  const isEnRoute = activeRide && ['ASSIGNED', 'EN_ROUTE'].includes(activeRide.status)
  const isOnRide = activeRide && ['ARRIVED', 'IN_PROGRESS'].includes(activeRide.status)

  const routeLine = []
  if (isEnRoute && pickupLat) {
    routeLine.push([driverPos.lat, driverPos.lng], [pickupLat, pickupLng])
  } else if (isOnRide && dropLat) {
    routeLine.push([driverPos.lat, driverPos.lng], [dropLat, dropLng])
  }

  return (
    <div className="space-y-2">
      <div className="rounded-lg overflow-hidden border border-border" style={{ height: '280px' }}>
        <MapContainer center={[driverPos.lat, driverPos.lng]} zoom={13} style={{ height: '100%', width: '100%' }}
          zoomControl={false} attributionControl={false}>
          <TileLayer url="https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png" />

          <FitBounds points={points} />

          {/* Driver marker - draggable when not live tracking */}
          <Marker position={[driverPos.lat, driverPos.lng]} icon={driverIcon}
            draggable={!liveTracking} ref={markerRef}
            eventHandlers={{ dragend: handleDragEnd }}>
            <Popup>
              <span style={{ fontSize: '12px', fontFamily: 'system-ui' }}>Your location</span>
            </Popup>
          </Marker>

          {/* Pickup marker */}
          {pickupLat && (
            <Marker position={[pickupLat, pickupLng]} icon={pickupIcon}>
              <Popup>
                <span style={{ fontSize: '12px', fontFamily: 'system-ui' }}>Pickup: {activeRide.pickupAddress}</span>
              </Popup>
            </Marker>
          )}

          {/* Drop marker */}
          {dropLat && (
            <Marker position={[dropLat, dropLng]} icon={dropIcon}>
              <Popup>
                <span style={{ fontSize: '12px', fontFamily: 'system-ui' }}>Drop: {activeRide.dropAddress}</span>
              </Popup>
            </Marker>
          )}

          {/* Route line */}
          {routeLine.length === 2 && (
            <Polyline positions={routeLine} pathOptions={{ color: isEnRoute ? '#60a5fa' : '#34d399', weight: 3, dashArray: '8 8', opacity: 0.7 }} />
          )}
        </MapContainer>
      </div>

      {/* ETA info bar */}
      {activeRide && (
        <div className="flex items-center justify-between text-xs bg-accent/50 rounded-lg px-3 py-2">
          {isEnRoute && distToPickup !== null && (
            <>
              <span className="text-muted-foreground">To pickup</span>
              <span className="font-medium">{distToPickup.toFixed(1)} km · {formatEta(distToPickup)}</span>
            </>
          )}
          {isOnRide && distToDrop !== null && (
            <>
              <span className="text-muted-foreground">To drop-off</span>
              <span className="font-medium">{distToDrop.toFixed(1)} km · {formatEta(distToDrop)}</span>
            </>
          )}
          {!isEnRoute && !isOnRide && totalRideDist !== null && (
            <>
              <span className="text-muted-foreground">Ride distance</span>
              <span className="font-medium">{totalRideDist.toFixed(1)} km</span>
            </>
          )}
        </div>
      )}
    </div>
  )
}