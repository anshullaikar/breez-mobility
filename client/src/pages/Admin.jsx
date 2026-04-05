import { useState, useEffect } from 'react'
import { useAuth } from '@/lib/auth'
import { api } from '@/lib/api'
import { useSSE } from '@/hooks/useSSE'
import { Button } from '@/components/ui/button'
import { Card, CardHeader, CardTitle, CardDescription, CardContent } from '@/components/ui/card'
import { Badge } from '@/components/ui/badge'
import { LogOut, Truck, Users, Zap, CalendarClock, Battery, AlertTriangle, CheckCircle2 } from 'lucide-react'
import { format } from 'date-fns'

export default function AdminPage() {
  const { auth, logout } = useAuth()
  const [tab, setTab] = useState('dispatch')
  const [queue, setQueue] = useState([])
  const [fleet, setFleet] = useState([])
  const [drivers, setDrivers] = useState([])
  const [allRides, setAllRides] = useState([])
  const [events, setEvents] = useState([])
  const [assignLoading, setAssignLoading] = useState('')

  const fetchQueue = async () => {
    try { setQueue(await api('GET', '/admin/queue', null, auth.token)) } catch {}
  }
  const fetchFleet = async () => {
    try { setFleet(await api('GET', '/admin/fleet', null, auth.token)) } catch {}
  }
  const fetchDrivers = async () => {
    try { setDrivers(await api('GET', '/admin/drivers', null, auth.token)) } catch {}
  }
  const fetchRides = async () => {
    try { setAllRides(await api('GET', '/rides?limit=50', null, auth.token)) } catch {}
  }

  useEffect(() => {
    fetchQueue(); fetchFleet(); fetchDrivers(); fetchRides()
  }, [])

  // SSE: fleet-wide events
  useSSE('fleet', {
    ride_booked: (d) => {
      addEvent('info', `New ride booked: ${d.pickupAddress}`)
      fetchQueue()
    },
    ride_assigned: (d) => {
      addEvent('success', `Ride ${d.rideId.slice(0, 8)} assigned`)
      fetchQueue(); fetchRides()
    },
    ride_status_change: (d) => {
      addEvent('info', `Ride ${d.rideId.slice(0, 8)}: ${d.from} → ${d.to}`)
      fetchRides(); if (d.to === 'COMPLETED') fetchQueue()
    },
    driver_online: (d) => {
      addEvent('success', `Driver online: ${d.driverId.slice(0, 8)}`)
      fetchDrivers()
    },
    driver_offline: (d) => {
      addEvent('warning', `Driver offline: ${d.driverId.slice(0, 8)}`)
      fetchDrivers()
    },
    low_battery_alert: (d) => {
      addEvent('danger', `LOW BATTERY: SOC ${d.soc}%`)
      fetchFleet()
    },
    battery_log: () => fetchFleet(),
    driver_location: () => {}, // ignore high-frequency pings in event log
  })

  const addEvent = (type, message) => {
    setEvents(prev => [{ type, message, ts: new Date() }, ...prev].slice(0, 100))
  }

  const handleAssign = async (rideId) => {
    // Find first available driver
    const availableDriver = drivers.find(d => d.online && d.active)
    const availableVehicle = fleet.find(v => v.status === 'AVAILABLE' && (v.currentSoc || 100) > 20)
    if (!availableDriver || !availableVehicle) {
      addEvent('danger', 'No available driver or vehicle')
      return
    }
    setAssignLoading(rideId)
    try {
      await api('POST', '/admin/assign', {
        rideId, driverId: availableDriver.id, vehicleId: availableVehicle.id,
      }, auth.token)
      fetchQueue(); fetchRides()
    } catch (e) {
      addEvent('danger', `Assignment failed: ${e.message}`)
    }
    setAssignLoading('')
  }

  const tabs = [
    { id: 'dispatch', label: 'Dispatch', icon: CalendarClock, count: queue.length },
    { id: 'fleet', label: 'Fleet', icon: Truck, count: fleet.length },
    { id: 'drivers', label: 'Drivers', icon: Users, count: drivers.filter(d => d.online).length },
    { id: 'rides', label: 'All rides', icon: CheckCircle2, count: allRides.length },
  ]

  const lowBatteryCount = fleet.filter(v => (v.currentSoc || 100) < 20).length

  return (
    <div className="min-h-screen bg-background">
      <header className="sticky top-0 z-50 border-b bg-card/80 backdrop-blur-sm">
        <div className="max-w-5xl mx-auto flex items-center justify-between p-4">
          <div>
            <h1 className="font-bold text-lg">Breez Admin</h1>
            <p className="text-xs text-muted-foreground">{auth.user.name}</p>
          </div>
          <div className="flex items-center gap-3">
            {lowBatteryCount > 0 && (
              <Badge variant="danger" className="gap-1">
                <AlertTriangle className="h-3 w-3" /> {lowBatteryCount} low battery
              </Badge>
            )}
            <Button variant="ghost" size="icon" onClick={logout}><LogOut className="h-4 w-4" /></Button>
          </div>
        </div>
        <div className="max-w-5xl mx-auto flex border-t border-border">
          {tabs.map(t => (
            <button key={t.id} onClick={() => setTab(t.id)}
              className={`flex-1 flex items-center justify-center gap-2 py-2.5 text-sm transition-colors border-b-2 ${tab === t.id ? 'border-primary text-foreground' : 'border-transparent text-muted-foreground hover:text-foreground'}`}>
              <t.icon className="h-3.5 w-3.5" />
              {t.label}
              {t.count > 0 && <span className="text-xs bg-accent px-1.5 py-0.5 rounded-full">{t.count}</span>}
            </button>
          ))}
        </div>
      </header>

      <div className="max-w-5xl mx-auto p-4 flex gap-4">
        {/* Main content */}
        <div className="flex-1 min-w-0">
          {/* Dispatch queue */}
          {tab === 'dispatch' && (
            <div className="space-y-3">
              <h2 className="text-sm font-medium text-muted-foreground">Unassigned rides ({queue.length})</h2>
              {queue.length === 0 && <p className="text-sm text-muted-foreground text-center py-8">All rides assigned</p>}
              {queue.map(ride => (
                <Card key={ride.id}>
                  <CardContent className="p-4 flex items-center justify-between">
                    <div className="space-y-1 min-w-0 mr-4">
                      <div className="flex items-center gap-2">
                        <span className="font-mono text-xs text-muted-foreground">{ride.id.slice(0, 8)}</span>
                        <Badge variant="info">{ride.slab?.name}</Badge>
                      </div>
                      <p className="text-sm truncate">{ride.pickupAddress} → {ride.dropAddress}</p>
                      <p className="text-xs text-muted-foreground">
                        {ride.passenger?.name} · {format(new Date(ride.scheduledAt), 'dd MMM HH:mm')} · ₹{(ride.fare / 100).toFixed(0)}
                      </p>
                    </div>
                    <Button size="sm" onClick={() => handleAssign(ride.id)} disabled={assignLoading === ride.id}>
                      {assignLoading === ride.id ? '...' : 'Assign'}
                    </Button>
                  </CardContent>
                </Card>
              ))}
            </div>
          )}

          {/* Fleet grid */}
          {tab === 'fleet' && (
            <div className="grid grid-cols-2 lg:grid-cols-3 gap-3">
              {fleet.map(v => {
                const soc = v.currentSoc ?? 100
                const socColor = soc > 50 ? 'bg-emerald-500' : soc > 20 ? 'bg-amber-500' : 'bg-red-500'
                return (
                  <Card key={v.id} className={soc < 20 ? 'border-red-500/40' : ''}>
                    <CardContent className="p-4 space-y-2">
                      <div className="flex items-center justify-between">
                        <p className="font-mono text-sm font-medium">{v.plateNumber}</p>
                        <Badge variant={v.status === 'AVAILABLE' ? 'success' : v.status === 'ON_RIDE' ? 'warning' : 'secondary'}>
                          {v.status}
                        </Badge>
                      </div>
                      <p className="text-xs text-muted-foreground">{v.model}</p>
                      {v.currentDriver && (
                        <p className="text-xs">Driver: {v.currentDriver.name}</p>
                      )}
                      <div className="space-y-1">
                        <div className="flex justify-between text-xs">
                          <span className="text-muted-foreground">Battery</span>
                          <span className={soc < 20 ? 'text-red-400 font-medium' : ''}>{soc}%</span>
                        </div>
                        <div className="h-1.5 bg-accent rounded-full overflow-hidden">
                          <div className={`h-full rounded-full transition-all ${socColor}`} style={{ width: `${soc}%` }} />
                        </div>
                      </div>
                    </CardContent>
                  </Card>
                )
              })}
            </div>
          )}

          {/* Drivers */}
          {tab === 'drivers' && (
            <div className="space-y-2">
              {drivers.map(d => (
                <Card key={d.id}>
                  <CardContent className="p-3 flex items-center justify-between">
                    <div className="flex items-center gap-3">
                      <div className={`h-2.5 w-2.5 rounded-full ${d.online ? 'bg-emerald-400' : 'bg-muted-foreground/30'}`} />
                      <div>
                        <p className="text-sm font-medium">{d.name}</p>
                        <p className="text-xs text-muted-foreground">{d.employeeId} · {d.phone}</p>
                      </div>
                    </div>
                    <div className="text-right">
                      {d.assignedVehicle && (
                        <p className="text-xs text-muted-foreground">{d.assignedVehicle.plateNumber}</p>
                      )}
                      <Badge variant={d.online ? 'success' : 'secondary'} className="text-[10px]">
                        {d.online ? 'Online' : 'Offline'}
                      </Badge>
                    </div>
                  </CardContent>
                </Card>
              ))}
            </div>
          )}

          {/* All rides */}
          {tab === 'rides' && (
            <div className="space-y-2">
              {allRides.map(ride => (
                <Card key={ride.id}>
                  <CardContent className="p-3">
                    <div className="flex items-center justify-between mb-1">
                      <span className="font-mono text-xs text-muted-foreground">{ride.id.slice(0, 8)}</span>
                      <Badge variant={
                        ride.status === 'COMPLETED' ? 'success' : ride.status === 'CANCELLED' ? 'danger' :
                        ride.status === 'IN_PROGRESS' ? 'warning' : 'info'
                      } className="text-[10px]">{ride.status}</Badge>
                    </div>
                    <p className="text-sm truncate">{ride.pickupAddress} → {ride.dropAddress}</p>
                    <div className="flex items-center justify-between mt-1 text-xs text-muted-foreground">
                      <span>{ride.passenger?.name}{ride.driver ? ` · ${ride.driver.name}` : ''}</span>
                      <span>₹{(ride.fare / 100).toFixed(0)}</span>
                    </div>
                  </CardContent>
                </Card>
              ))}
            </div>
          )}
        </div>

        {/* Live event log sidebar */}
        <div className="w-72 shrink-0 hidden lg:block">
          <Card className="sticky top-[120px]">
            <CardHeader className="pb-2">
              <CardTitle className="text-sm flex items-center gap-2">
                <Zap className="h-3.5 w-3.5 text-primary" /> Live events
              </CardTitle>
            </CardHeader>
            <CardContent className="p-3 max-h-[60vh] overflow-y-auto">
              {events.length === 0 && <p className="text-xs text-muted-foreground text-center py-4">Waiting for events...</p>}
              {events.map((ev, i) => (
                <div key={i} className="py-1.5 border-b border-border/50 last:border-0">
                  <p className={`text-xs ${ev.type === 'danger' ? 'text-red-400' : ev.type === 'success' ? 'text-emerald-400' : ev.type === 'warning' ? 'text-amber-400' : 'text-muted-foreground'}`}>
                    {ev.message}
                  </p>
                  <p className="text-[10px] text-muted-foreground/60 font-mono">{format(ev.ts, 'HH:mm:ss')}</p>
                </div>
              ))}
            </CardContent>
          </Card>
        </div>
      </div>
    </div>
  )
}
