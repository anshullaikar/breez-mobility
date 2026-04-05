import { useState, useEffect } from 'react'
import { useAuth } from '@/lib/auth'
import { api } from '@/lib/api'
import { useSSE } from '@/hooks/useSSE'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Card, CardHeader, CardTitle, CardContent } from '@/components/ui/card'
import { Badge } from '@/components/ui/badge'
import { MapPin, Clock, IndianRupee, Plus, LogOut, X } from 'lucide-react'
import { format } from 'date-fns'

const STATUS_BADGE = {
  BOOKED: 'info', ASSIGNED: 'info', EN_ROUTE: 'warning',
  ARRIVED: 'warning', IN_PROGRESS: 'success', COMPLETED: 'success', CANCELLED: 'danger',
}

export default function PassengerPage() {
  const { auth, logout } = useAuth()
  const [rides, setRides] = useState([])
  const [slabs, setSlabs] = useState([])
  const [booking, setBooking] = useState(false)
  const [form, setForm] = useState({ pickupAddress: '', dropAddress: '', scheduledAt: '', slabId: '' })
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState('')
  const [trackingRide, setTrackingRide] = useState(null)

  const fetchRides = async () => {
    try {
      const data = await api('GET', '/rides', null, auth.token)
      setRides(data)
    } catch {}
  }

  const fetchSlabs = async () => {
    try {
      const data = await api('GET', '/admin/slabs', null, auth.token)
      setSlabs(data)
    } catch {}
  }

  useEffect(() => { fetchRides(); fetchSlabs() }, [])

  // SSE: track active ride
  useSSE(trackingRide ? `ride/${trackingRide}` : null, {
    status_change: (d) => {
      setRides(prev => prev.map(r => r.id === d.rideId ? { ...r, status: d.to } : r))
    },
    driver_assigned: (d) => {
      fetchRides() // refresh to get driver details
    },
    driver_location: (d) => {
      // Could update a map marker here
    },
  }, [trackingRide])

  const handleBook = async () => {
    setLoading(true); setError('')
    try {
      await api('POST', '/rides', {
        pickupAddress: form.pickupAddress,
        pickupLat: 19.076 + (Math.random() - 0.5) * 0.1,
        pickupLng: 72.877 + (Math.random() - 0.5) * 0.1,
        dropAddress: form.dropAddress,
        dropLat: 19.076 + (Math.random() - 0.5) * 0.1,
        dropLng: 72.877 + (Math.random() - 0.5) * 0.1,
        scheduledAt: new Date(form.scheduledAt).toISOString(),
        slabId: form.slabId,
      }, auth.token)
      setBooking(false)
      setForm({ pickupAddress: '', dropAddress: '', scheduledAt: '', slabId: '' })
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
  }, [activeRide?.id])

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
        {error && <p className="text-sm text-destructive bg-destructive/10 p-3 rounded-lg">{error}</p>}

        {/* Book ride */}
        {!booking ? (
          <Button className="w-full h-12 text-base" onClick={() => setBooking(true)}>
            <Plus className="h-4 w-4 mr-2" /> Schedule a ride
          </Button>
        ) : (
          <Card>
            <CardHeader className="pb-3">
              <CardTitle className="text-base flex items-center justify-between">
                New booking
                <Button variant="ghost" size="icon" onClick={() => setBooking(false)}><X className="h-4 w-4" /></Button>
              </CardTitle>
            </CardHeader>
            <CardContent className="space-y-3">
              <Input placeholder="Pickup address" value={form.pickupAddress} onChange={e => setForm(f => ({ ...f, pickupAddress: e.target.value }))} />
              <Input placeholder="Drop address" value={form.dropAddress} onChange={e => setForm(f => ({ ...f, dropAddress: e.target.value }))} />
              <Input type="datetime-local" value={form.scheduledAt} onChange={e => setForm(f => ({ ...f, scheduledAt: e.target.value }))} />
              <div className="grid grid-cols-2 gap-2">
                {slabs.map(s => (
                  <button key={s.id} onClick={() => setForm(f => ({ ...f, slabId: s.id }))}
                    className={`p-3 rounded-lg border text-left text-sm transition-colors ${form.slabId === s.id ? 'border-primary bg-primary/10' : 'border-border hover:bg-accent'}`}>
                    <p className="font-medium">{s.name}</p>
                    <p className="text-muted-foreground">₹{(s.price / 100).toFixed(0)}</p>
                  </button>
                ))}
              </div>
              <Button className="w-full" onClick={handleBook} disabled={loading || !form.pickupAddress || !form.dropAddress || !form.scheduledAt || !form.slabId}>
                {loading ? 'Booking...' : 'Confirm booking'}
              </Button>
            </CardContent>
          </Card>
        )}

        {/* Active ride */}
        {activeRide && (
          <Card className="border-primary/30">
            <CardContent className="p-4 space-y-3">
              <div className="flex items-center justify-between">
                <p className="font-medium">Active ride</p>
                <Badge variant={STATUS_BADGE[activeRide.status]}>{activeRide.status.replace('_', ' ')}</Badge>
              </div>
              <div className="space-y-1 text-sm">
                <div className="flex items-center gap-2 text-muted-foreground">
                  <MapPin className="h-3.5 w-3.5 text-emerald-400" />
                  {activeRide.pickupAddress}
                </div>
                <div className="flex items-center gap-2 text-muted-foreground">
                  <MapPin className="h-3.5 w-3.5 text-red-400" />
                  {activeRide.dropAddress}
                </div>
              </div>
              {activeRide.driver && (
                <div className="text-sm bg-accent/50 p-2 rounded">
                  Driver: <span className="font-medium">{activeRide.driver.name}</span>
                  {activeRide.vehicle && <span className="text-muted-foreground"> · {activeRide.vehicle.plateNumber}</span>}
                </div>
              )}
              {['BOOKED', 'ASSIGNED'].includes(activeRide.status) && (
                <Button variant="destructive" size="sm" className="w-full" onClick={() => handleCancel(activeRide.id)}>Cancel ride</Button>
              )}
            </CardContent>
          </Card>
        )}

        {/* Ride history */}
        <div>
          <h2 className="text-sm font-medium text-muted-foreground mb-3">Your rides</h2>
          <div className="space-y-2">
            {rides.length === 0 && <p className="text-sm text-muted-foreground text-center py-8">No rides yet</p>}
            {rides.map(ride => (
              <Card key={ride.id} className="cursor-pointer hover:bg-accent/30 transition-colors" onClick={() => setTrackingRide(ride.id)}>
                <CardContent className="p-3">
                  <div className="flex items-center justify-between mb-1">
                    <span className="text-xs text-muted-foreground font-mono">{ride.id.slice(0, 8)}</span>
                    <Badge variant={STATUS_BADGE[ride.status]} className="text-[10px]">{ride.status}</Badge>
                  </div>
                  <div className="flex items-center justify-between">
                    <div className="text-sm truncate mr-4">
                      <span>{ride.pickupAddress}</span>
                      <span className="text-muted-foreground mx-1">→</span>
                      <span>{ride.dropAddress}</span>
                    </div>
                    <span className="text-sm font-medium whitespace-nowrap">₹{(ride.fare / 100).toFixed(0)}</span>
                  </div>
                  <p className="text-xs text-muted-foreground mt-1">
                    <Clock className="h-3 w-3 inline mr-1" />
                    {format(new Date(ride.scheduledAt), 'dd MMM, hh:mm a')}
                  </p>
                </CardContent>
              </Card>
            ))}
          </div>
        </div>
      </main>
    </div>
  )
}
