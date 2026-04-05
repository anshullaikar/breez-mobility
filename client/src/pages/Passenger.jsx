import { useState, useEffect } from 'react'
import { useAuth } from '@/lib/auth'
import { api } from '@/lib/api'
import { useSSE } from '@/hooks/useSSE'
import { Button } from '@/components/ui/button'
import { Card, CardHeader, CardTitle, CardContent } from '@/components/ui/card'
import { Badge } from '@/components/ui/badge'
import { Clock, Plus, LogOut, X, Car } from 'lucide-react'
import { format } from 'date-fns'
import AddressSearch from '@/components/AddressSearch'
import PassengerMap from '@/components/PassengerMap'

const STATUS_BADGE = {
  BOOKED: 'info', ASSIGNED: 'info', EN_ROUTE: 'warning',
  ARRIVED: 'warning', IN_PROGRESS: 'success', COMPLETED: 'success', CANCELLED: 'danger',
}

const STATUS_MESSAGE = {
  BOOKED: 'Waiting for driver assignment',
  ASSIGNED: 'Driver assigned — waiting for pickup day',
  EN_ROUTE: 'Driver is on the way to pick you up',
  ARRIVED: 'Driver has arrived at pickup',
  IN_PROGRESS: 'Ride in progress',
  COMPLETED: 'Ride completed',
  CANCELLED: 'Ride cancelled',
}

export default function PassengerPage() {
  const { auth, logout } = useAuth()
  const [rides, setRides] = useState([])
  const [slabs, setSlabs] = useState([])
  const [booking, setBooking] = useState(false)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState('')
  const [trackingRide, setTrackingRide] = useState(null)
  const [driverLocation, setDriverLocation] = useState(null)

  // Booking form with geocoded addresses
  const [pickup, setPickup] = useState(null) // { address, lat, lng }
  const [drop, setDrop] = useState(null)
  const [scheduledAt, setScheduledAt] = useState('')
  const [selectedSlab, setSelectedSlab] = useState('')

  const fetchRides = async () => {
    try { setRides(await api('GET', '/rides', null, auth.token)) } catch {}
  }
  const fetchSlabs = async () => {
    try { setSlabs(await api('GET', '/admin/slabs', null, auth.token)) } catch {}
  }

  useEffect(() => { fetchRides(); fetchSlabs() }, [])

  // SSE: track active ride
  useSSE(trackingRide ? `ride/${trackingRide}` : null, {
    status_change: (d) => {
      setRides(prev => prev.map(r => r.id === d.rideId ? { ...r, status: d.to } : r))
      fetchRides() // full refresh to get driver details
    },
    driver_assigned: () => fetchRides(),
    driver_location: (d) => setDriverLocation({ lat: d.lat, lng: d.lng }),
    ride_cancelled: () => fetchRides(),
  }, [trackingRide])

  const handleBook = async () => {
    if (!pickup || !drop || !scheduledAt || !selectedSlab) return
    setLoading(true); setError('')
    try {
      await api('POST', '/rides', {
        pickupAddress: pickup.address,
        pickupLat: pickup.lat,
        pickupLng: pickup.lng,
        dropAddress: drop.address,
        dropLat: drop.lat,
        dropLng: drop.lng,
        scheduledAt: new Date(scheduledAt).toISOString(),
        slabId: selectedSlab,
      }, auth.token)
      setBooking(false)
      setPickup(null); setDrop(null); setScheduledAt(''); setSelectedSlab('')
      fetchRides()
    } catch (e) { setError(e.message) }
    setLoading(false)
  }

  const handleCancel = async (rideId) => {
    try {
      await api('PATCH', `/rides/${rideId}/cancel`, { reason: 'Cancelled by passenger' }, auth.token)
      fetchRides()
    } catch (e) { setError(e.message) }
  }

  const activeRide = rides.find(r => !['COMPLETED', 'CANCELLED'].includes(r.status))
  useEffect(() => {
    if (activeRide) setTrackingRide(activeRide.id)
    else { setTrackingRide(null); setDriverLocation(null) }
  }, [activeRide?.id])

  // Build map data from active ride
  const activePickup = activeRide?.pickupLat ? { lat: activeRide.pickupLat, lng: activeRide.pickupLng, address: activeRide.pickupAddress } : null
  const activeDrop = activeRide?.dropLat ? { lat: activeRide.dropLat, lng: activeRide.dropLng, address: activeRide.dropAddress } : null

  return (
    <div className="min-h-screen bg-background">
      <header className="sticky top-0 z-50 border-b bg-card/80 backdrop-blur-sm">
        <div className="max-w-lg mx-auto flex items-center justify-between p-4">
          <div>
            <h1 className="font-bold text-lg">Breez</h1>
            <p className="text-xs text-muted-foreground">{auth.user.name}</p>
          </div>
          <Button variant="ghost" size="icon" onClick={logout}><LogOut className="h-4 w-4" /></Button>
        </div>
      </header>

      <main className="max-w-lg mx-auto p-4 space-y-4">
        {error && (
          <div className="flex items-center justify-between text-sm text-destructive bg-destructive/10 p-3 rounded-lg">
            {error}
            <button onClick={() => setError('')}><X className="h-3.5 w-3.5" /></button>
          </div>
        )}

        {/* Active ride with map */}
        {activeRide && (
          <Card className="border-primary/30 overflow-hidden">
            {/* Map */}
            <PassengerMap
              pickup={activePickup}
              drop={activeDrop}
              driverLocation={driverLocation}
              rideStatus={activeRide.status}
            />
            <CardContent className="p-4 space-y-3">
              <div className="flex items-center justify-between">
                <Badge variant={STATUS_BADGE[activeRide.status]}>{activeRide.status.replace('_', ' ')}</Badge>
                <span className="text-sm font-medium">₹{(activeRide.fare / 100).toFixed(0)}</span>
              </div>
              <p className="text-sm text-muted-foreground">{STATUS_MESSAGE[activeRide.status]}</p>
              <div className="space-y-1 text-sm">
                <p><span className="text-emerald-400 mr-1">●</span> {activeRide.pickupAddress}</p>
                <p><span className="text-red-400 mr-1">●</span> {activeRide.dropAddress}</p>
              </div>
              {activeRide.driver && (
                <div className="flex items-center gap-3 bg-accent/50 p-3 rounded-lg">
                  <div className="h-9 w-9 rounded-full bg-primary/10 flex items-center justify-center">
                    <Car className="h-4 w-4 text-primary" />
                  </div>
                  <div>
                    <p className="text-sm font-medium">{activeRide.driver.name}</p>
                    <p className="text-xs text-muted-foreground">
                      {activeRide.vehicle?.plateNumber} · {activeRide.vehicle?.model}
                    </p>
                  </div>
                </div>
              )}
              <p className="text-xs text-muted-foreground">
                <Clock className="h-3 w-3 inline mr-1" />
                Scheduled for {format(new Date(activeRide.scheduledAt), 'dd MMM, hh:mm a')}
              </p>
              {['BOOKED', 'ASSIGNED'].includes(activeRide.status) && (
                <Button variant="destructive" size="sm" className="w-full" onClick={() => handleCancel(activeRide.id)}>
                  Cancel ride
                </Button>
              )}
            </CardContent>
          </Card>
        )}

        {/* Book ride */}
        {!booking && !activeRide ? (
          <Button className="w-full h-12 text-base" onClick={() => setBooking(true)}>
            <Plus className="h-4 w-4 mr-2" /> Schedule a ride
          </Button>
        ) : null}

        {booking && (
          <Card>
            <CardHeader className="pb-3">
              <CardTitle className="text-base flex items-center justify-between">
                New booking
                <Button variant="ghost" size="icon" onClick={() => setBooking(false)}><X className="h-4 w-4" /></Button>
              </CardTitle>
            </CardHeader>
            <CardContent className="space-y-3">
              <AddressSearch
                placeholder="Pickup location"
                icon="pickup"
                value={pickup?.address || ''}
                onSelect={(result) => setPickup(result)}
              />
              <AddressSearch
                placeholder="Drop-off location"
                icon="drop"
                value={drop?.address || ''}
                onSelect={(result) => setDrop(result)}
              />

              {/* Map preview while booking */}
              {(pickup || drop) && (
                <PassengerMap pickup={pickup} drop={drop} driverLocation={null} rideStatus={null} />
              )}

              <div>
                <label className="text-xs text-muted-foreground">Schedule pickup (min 3 hours ahead)</label>
                <input
                  type="datetime-local"
                  value={scheduledAt}
                  onChange={e => setScheduledAt(e.target.value)}
                  className="flex h-9 w-full rounded-md border border-input bg-transparent px-3 py-1 text-sm mt-1 focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring"
                />
              </div>

              <div>
                <label className="text-xs text-muted-foreground mb-2 block">Select distance slab</label>
                <div className="grid grid-cols-2 gap-2">
                  {slabs.filter(s => s.active).map(s => (
                    <button key={s.id} onClick={() => setSelectedSlab(s.id)}
                      className={`p-3 rounded-lg border text-left text-sm transition-colors ${selectedSlab === s.id ? 'border-primary bg-primary/10' : 'border-border hover:bg-accent'}`}>
                      <p className="font-medium">{s.name}</p>
                      <p className="text-muted-foreground">₹{(s.price / 100).toFixed(0)}</p>
                    </button>
                  ))}
                </div>
              </div>

              <Button className="w-full" onClick={handleBook}
                disabled={loading || !pickup || !drop || !scheduledAt || !selectedSlab}>
                {loading ? 'Booking...' : `Confirm booking${selectedSlab ? ` · ₹${(slabs.find(s => s.id === selectedSlab)?.price / 100 || 0).toFixed(0)}` : ''}`}
              </Button>
            </CardContent>
          </Card>
        )}

        {/* Ride history */}
        {!booking && (
          <div>
            <h2 className="text-sm font-medium text-muted-foreground mb-3">
              {rides.length > 0 ? 'Your rides' : ''}
            </h2>
            <div className="space-y-2">
              {rides.filter(r => r.id !== activeRide?.id).length === 0 && !activeRide && (
                <p className="text-sm text-muted-foreground text-center py-8">No rides yet. Schedule your first ride!</p>
              )}
              {rides.filter(r => r.id !== activeRide?.id).map(ride => (
                <Card key={ride.id} className="hover:bg-accent/30 transition-colors">
                  <CardContent className="p-3">
                    <div className="flex items-center justify-between mb-1">
                      <span className="text-xs text-muted-foreground font-mono">{ride.id.slice(0, 8)}</span>
                      <Badge variant={STATUS_BADGE[ride.status]} className="text-[10px]">{ride.status}</Badge>
                    </div>
                    <div className="text-sm truncate">
                      <span className="text-emerald-400 mr-1">●</span>{ride.pickupAddress}
                      <span className="text-muted-foreground mx-1">→</span>
                      <span className="text-red-400 mr-1">●</span>{ride.dropAddress}
                    </div>
                    <div className="flex items-center justify-between mt-1">
                      <p className="text-xs text-muted-foreground">
                        <Clock className="h-3 w-3 inline mr-1" />
                        {format(new Date(ride.scheduledAt), 'dd MMM, hh:mm a')}
                      </p>
                      <span className="text-sm font-medium">₹{(ride.fare / 100).toFixed(0)}</span>
                    </div>
                  </CardContent>
                </Card>
              ))}
            </div>
          </div>
        )}
      </main>
    </div>
  )
}