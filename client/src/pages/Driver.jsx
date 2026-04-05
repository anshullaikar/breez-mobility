import { useState, useEffect } from 'react'
import { useAuth } from '@/lib/auth'
import { api } from '@/lib/api'
import { useSSE } from '@/hooks/useSSE'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Card, CardHeader, CardTitle, CardContent } from '@/components/ui/card'
import { Badge } from '@/components/ui/badge'
import { LogOut, Navigation, MapPin, Battery, Power, ChevronRight } from 'lucide-react'

const NEXT_STATUS = {
  ASSIGNED: 'EN_ROUTE', EN_ROUTE: 'ARRIVED', ARRIVED: 'IN_PROGRESS', IN_PROGRESS: 'COMPLETED',
}
const NEXT_LABEL = {
  ASSIGNED: 'Start driving', EN_ROUTE: 'Arrived at pickup', ARRIVED: 'Start ride', IN_PROGRESS: 'Complete ride',
}

export default function DriverPage() {
  const { auth, logout } = useAuth()
  const [online, setOnline] = useState(false)
  const [assignments, setAssignments] = useState([])
  const [loading, setLoading] = useState('')
  const [error, setError] = useState('')

  const fetchAssignments = async () => {
    try {
      const data = await api('GET', '/drivers/assignments', null, auth.token)
      setAssignments(data)
    } catch {}
  }

  useEffect(() => { fetchAssignments() }, [])

  // SSE: listen for new assignments
  useSSE(`driver/${auth.user.id}`, {
    ride_assigned: () => fetchAssignments(),
    ride_update: () => fetchAssignments(),
  })

  const toggleOnline = async () => {
    try {
      await api('POST', online ? '/drivers/offline' : '/drivers/online', {}, auth.token)
      setOnline(!online)
    } catch (e) { setError(e.message) }
  }

  const progressRide = async (rideId, currentStatus) => {
    const nextStatus = NEXT_STATUS[currentStatus]
    if (!nextStatus) return
    setLoading(rideId); setError('')
    try {
      await api('PATCH', `/rides/${rideId}/status`, { status: nextStatus }, auth.token)
      fetchAssignments()
    } catch (e) { setError(e.message) }
    setLoading('')
  }

  const [batteryForm, setBatteryForm] = useState({ vehicleId: '', soc: '', eventType: '' })
  const [showBattery, setShowBattery] = useState(false)

  const submitBattery = async () => {
    setLoading('battery'); setError('')
    try {
      await api('POST', '/drivers/battery-log', {
        vehicleId: batteryForm.vehicleId,
        eventType: batteryForm.eventType,
        soc: Number(batteryForm.soc),
        range: Math.floor(Number(batteryForm.soc) * 3.5),
      }, auth.token)
      setShowBattery(false)
      setBatteryForm({ vehicleId: '', soc: '', eventType: '' })
    } catch (e) { setError(e.message) }
    setLoading('')
  }

  return (
    <div className="min-h-screen bg-background">
      <header className="sticky top-0 z-50 border-b bg-card/80 backdrop-blur-sm">
        <div className="max-w-lg mx-auto flex items-center justify-between p-4">
          <div>
            <h1 className="font-bold text-lg">Breez Driver</h1>
            <p className="text-xs text-muted-foreground">{auth.user.name} · {auth.user.employeeId}</p>
          </div>
          <div className="flex gap-2">
            <Button variant={online ? 'default' : 'outline'} size="sm" onClick={toggleOnline}>
              <Power className="h-3.5 w-3.5 mr-1" /> {online ? 'Online' : 'Offline'}
            </Button>
            <Button variant="ghost" size="icon" onClick={logout}><LogOut className="h-4 w-4" /></Button>
          </div>
        </div>
      </header>

      <main className="max-w-lg mx-auto p-4 space-y-4">
        {error && <p className="text-sm text-destructive bg-destructive/10 p-3 rounded-lg">{error}</p>}

        {/* Active assignments */}
        {assignments.length === 0 ? (
          <div className="text-center py-12">
            <Navigation className="h-10 w-10 text-muted-foreground mx-auto mb-3 opacity-30" />
            <p className="text-muted-foreground">No assignments yet</p>
            <p className="text-xs text-muted-foreground mt-1">Go online and wait for dispatch</p>
          </div>
        ) : (
          assignments.map(ride => (
            <Card key={ride.id} className={ride.status === 'IN_PROGRESS' ? 'border-primary/40' : ''}>
              <CardContent className="p-4 space-y-3">
                <div className="flex items-center justify-between">
                  <Badge variant={ride.status === 'IN_PROGRESS' ? 'success' : ride.status === 'ASSIGNED' ? 'info' : 'warning'}>
                    {ride.status.replace('_', ' ')}
                  </Badge>
                  <span className="text-xs text-muted-foreground font-mono">{ride.id.slice(0, 8)}</span>
                </div>

                <div className="space-y-1.5">
                  <div className="flex items-start gap-2 text-sm">
                    <MapPin className="h-3.5 w-3.5 mt-0.5 text-emerald-400 shrink-0" />
                    <span>{ride.pickupAddress}</span>
                  </div>
                  <div className="flex items-start gap-2 text-sm">
                    <MapPin className="h-3.5 w-3.5 mt-0.5 text-red-400 shrink-0" />
                    <span>{ride.dropAddress}</span>
                  </div>
                </div>

                <div className="flex items-center justify-between text-sm">
                  <span className="text-muted-foreground">
                    {ride.passenger?.name} · {ride.passenger?.phone}
                  </span>
                  <span className="font-medium">₹{(ride.fare / 100).toFixed(0)}</span>
                </div>

                {ride.vehicle && (
                  <p className="text-xs text-muted-foreground">
                    {ride.vehicle.plateNumber} · {ride.vehicle.model}
                  </p>
                )}

                {NEXT_STATUS[ride.status] && (
                  <Button className="w-full" onClick={() => progressRide(ride.id, ride.status)}
                    disabled={loading === ride.id}>
                    {loading === ride.id ? 'Updating...' : NEXT_LABEL[ride.status]}
                    <ChevronRight className="h-4 w-4 ml-1" />
                  </Button>
                )}
              </CardContent>
            </Card>
          ))
        )}

        {/* Battery log */}
        <div className="pt-4 border-t border-border">
          {!showBattery ? (
            <Button variant="outline" className="w-full" onClick={() => setShowBattery(true)}>
              <Battery className="h-4 w-4 mr-2" /> Submit battery log
            </Button>
          ) : (
            <Card>
              <CardHeader className="pb-2"><CardTitle className="text-sm">Battery log</CardTitle></CardHeader>
              <CardContent className="space-y-3">
                <Input placeholder="Vehicle ID" value={batteryForm.vehicleId}
                  onChange={e => setBatteryForm(f => ({ ...f, vehicleId: e.target.value }))} />
                <Input placeholder="SOC %" type="number" value={batteryForm.soc}
                  onChange={e => setBatteryForm(f => ({ ...f, soc: e.target.value }))} />
                <div className="grid grid-cols-2 gap-2">
                  {['VEHICLE_PICKUP', 'VEHICLE_DROP', 'CHARGE_START', 'CHARGE_END'].map(ev => (
                    <button key={ev} onClick={() => setBatteryForm(f => ({ ...f, eventType: ev }))}
                      className={`p-2 rounded border text-xs transition-colors ${batteryForm.eventType === ev ? 'border-primary bg-primary/10' : 'border-border hover:bg-accent'}`}>
                      {ev.replace(/_/g, ' ')}
                    </button>
                  ))}
                </div>
                <div className="flex gap-2">
                  <Button variant="outline" className="flex-1" onClick={() => setShowBattery(false)}>Cancel</Button>
                  <Button className="flex-1" onClick={submitBattery} disabled={loading === 'battery' || !batteryForm.vehicleId || !batteryForm.soc || !batteryForm.eventType}>
                    {loading === 'battery' ? 'Submitting...' : 'Submit'}
                  </Button>
                </div>
              </CardContent>
            </Card>
          )}
        </div>
      </main>
    </div>
  )
}
