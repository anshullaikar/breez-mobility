import { useState, useEffect, useCallback } from 'react'
import { useAuth } from '@/lib/auth'
import { api } from '@/lib/api'
import { useSSE } from '@/hooks/useSSE'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Card, CardHeader, CardTitle, CardContent } from '@/components/ui/card'
import { Badge } from '@/components/ui/badge'
import {
  LogOut, Truck, Users, Zap, CalendarClock, Battery, AlertTriangle,
  CheckCircle2, X, Map, IndianRupee, RefreshCw, Ban, ChevronRight,
  Plus, Pencil, Clock, MapPin
} from 'lucide-react'
import { format } from 'date-fns'

const STATUS_BADGE = {
  BOOKED: 'info', ASSIGNED: 'info', EN_ROUTE: 'warning',
  ARRIVED: 'warning', IN_PROGRESS: 'success', COMPLETED: 'success', CANCELLED: 'danger',
}

export default function AdminPage() {
  const { auth, logout } = useAuth()
  const [tab, setTab] = useState('dispatch')
  const [queue, setQueue] = useState([])
  const [activeRides, setActiveRides] = useState([])
  const [fleet, setFleet] = useState([])
  const [drivers, setDrivers] = useState([])
  const [slabs, setSlabs] = useState([])
  const [events, setEvents] = useState([])
  const [loading, setLoading] = useState('')
  const [error, setError] = useState('')

  // Drawers / modals
  const [vehicleDetail, setVehicleDetail] = useState(null)
  const [reassignRide, setReassignRide] = useState(null)
  const [cancelRide, setCancelRide] = useState(null)
  const [cancelReason, setCancelReason] = useState('')
  const [reassignDriverId, setReassignDriverId] = useState('')
  const [editingSlab, setEditingSlab] = useState(null)
  const [newSlab, setNewSlab] = useState(null)
  const [slabForm, setSlabForm] = useState({ name: '', minKm: '', maxKm: '', price: '' })

  const isSuperAdmin = auth.user.role === 'SUPER_ADMIN'

  // Fetchers
  const fetchQueue = useCallback(async () => {
    try { setQueue(await api('GET', '/admin/queue', null, auth.token)) } catch {}
  }, [auth.token])
  const fetchActiveRides = useCallback(async () => {
    try { setActiveRides(await api('GET', '/admin/active-rides', null, auth.token)) } catch {}
  }, [auth.token])
  const fetchFleet = useCallback(async () => {
    try { setFleet(await api('GET', '/admin/fleet', null, auth.token)) } catch {}
  }, [auth.token])
  const fetchDrivers = useCallback(async () => {
    try { setDrivers(await api('GET', '/admin/drivers', null, auth.token)) } catch {}
  }, [auth.token])
  const fetchSlabs = useCallback(async () => {
    try { setSlabs(await api('GET', '/admin/slabs', null, auth.token)) } catch {}
  }, [auth.token])

  useEffect(() => {
    fetchQueue(); fetchActiveRides(); fetchFleet(); fetchDrivers(); fetchSlabs()
  }, [])

  // SSE
  useSSE('fleet', {
    ride_booked: (d) => { addEvent('info', `Ride booked: ${d.pickupAddress}`); fetchQueue() },
    ride_assigned: () => { fetchQueue(); fetchActiveRides() },
    ride_status_change: (d) => {
      addEvent('info', `Ride ${d.rideId.slice(0, 8)}: ${d.from} → ${d.to}`)
      fetchActiveRides(); if (d.to === 'COMPLETED') fetchQueue()
    },
    ride_reassigned: (d) => { addEvent('warning', `Ride ${d.rideId.slice(0, 8)} reassigned`); fetchActiveRides() },
    ride_cancelled: (d) => { addEvent('danger', `Ride ${d.rideId.slice(0, 8)} cancelled`); fetchActiveRides(); fetchQueue() },
    driver_online: (d) => { addEvent('success', `Driver online`); fetchDrivers() },
    driver_offline: (d) => { addEvent('warning', `Driver offline`); fetchDrivers() },
    low_battery_alert: (d) => { addEvent('danger', `LOW BATTERY: SOC ${d.soc}%`); fetchFleet() },
    battery_log: () => fetchFleet(),
    driver_location: () => {},
  })

  const addEvent = (type, message) => {
    setEvents(prev => [{ type, message, ts: new Date() }, ...prev].slice(0, 100))
  }

  // Actions
  const handleAssign = async (rideId) => {
    const onlineDrivers = drivers.filter(d => d.online && d.active)
    const availableVehicle = fleet.find(v => v.status === 'AVAILABLE' && (v.currentSoc || 100) > 20)
    if (onlineDrivers.length === 0) return setError('No online drivers')
    if (!availableVehicle) return setError('No available vehicles with >20% SOC')
    setLoading(rideId)
    try {
      await api('POST', '/admin/assign', { rideId, driverId: onlineDrivers[0].id, vehicleId: availableVehicle.id }, auth.token)
      fetchQueue(); fetchActiveRides()
    } catch (e) { setError(e.message) }
    setLoading('')
  }

  const handleReassign = async () => {
    if (!reassignRide || !reassignDriverId) return
    setLoading('reassign')
    try {
      await api('POST', '/admin/reassign', { rideId: reassignRide.id, driverId: reassignDriverId }, auth.token)
      setReassignRide(null); setReassignDriverId('')
      fetchActiveRides()
    } catch (e) { setError(e.message) }
    setLoading('')
  }

  const handleCancelRide = async () => {
    if (!cancelRide || !cancelReason) return
    setLoading('cancel')
    try {
      await api('POST', '/admin/cancel-ride', { rideId: cancelRide.id, reason: cancelReason }, auth.token)
      setCancelRide(null); setCancelReason('')
      fetchActiveRides(); fetchQueue()
    } catch (e) { setError(e.message) }
    setLoading('')
  }

  const openVehicleDetail = async (vehicleId) => {
    try {
      const detail = await api('GET', `/admin/vehicles/${vehicleId}/detail`, null, auth.token)
      setVehicleDetail(detail)
    } catch (e) { setError(e.message) }
  }

  const handleSaveSlab = async () => {
    setLoading('slab')
    try {
      if (editingSlab) {
        await api('PUT', `/admin/slabs/${editingSlab.id}`, {
          name: slabForm.name, minKm: Number(slabForm.minKm), maxKm: Number(slabForm.maxKm), price: Number(slabForm.price),
        }, auth.token)
      } else {
        await api('POST', '/admin/slabs', {
          name: slabForm.name, minKm: Number(slabForm.minKm), maxKm: Number(slabForm.maxKm), price: Number(slabForm.price),
        }, auth.token)
      }
      setEditingSlab(null); setNewSlab(null)
      setSlabForm({ name: '', minKm: '', maxKm: '', price: '' })
      fetchSlabs()
    } catch (e) { setError(e.message) }
    setLoading('')
  }

  const handleDeleteSlab = async (id) => {
    try {
      await api('DELETE', `/admin/slabs/${id}`, null, auth.token)
      fetchSlabs()
    } catch (e) { setError(e.message) }
  }

  const lowBatteryCount = fleet.filter(v => (v.currentSoc || 100) < 20).length
  const onlineDriverCount = drivers.filter(d => d.online).length

  const tabs = [
    { id: 'dispatch', label: 'Dispatch', icon: CalendarClock, count: queue.length },
    { id: 'active', label: 'Active rides', icon: Map, count: activeRides.length },
    { id: 'fleet', label: 'Fleet', icon: Truck, count: fleet.length },
    { id: 'drivers', label: 'Drivers', icon: Users, count: onlineDriverCount },
    ...(isSuperAdmin ? [{ id: 'slabs', label: 'Fare slabs', icon: IndianRupee, count: slabs.length }] : []),
  ]

  return (
    <div className="min-h-screen bg-background">
      {/* Header */}
      <header className="sticky top-0 z-50 border-b bg-card/80 backdrop-blur-sm">
        <div className="max-w-6xl mx-auto flex items-center justify-between p-4">
          <div>
            <h1 className="font-bold text-lg">Breez Admin</h1>
            <p className="text-xs text-muted-foreground">{auth.user.name} · {isSuperAdmin ? 'Super admin' : 'Ops admin'}</p>
          </div>
          <div className="flex items-center gap-3">
            {lowBatteryCount > 0 && (
              <Badge variant="danger" className="gap-1"><AlertTriangle className="h-3 w-3" /> {lowBatteryCount} low battery</Badge>
            )}
            <Button variant="ghost" size="icon" onClick={logout}><LogOut className="h-4 w-4" /></Button>
          </div>
        </div>
        <div className="max-w-6xl mx-auto flex border-t border-border overflow-x-auto">
          {tabs.map(t => (
            <button key={t.id} onClick={() => setTab(t.id)}
              className={`flex items-center justify-center gap-2 px-4 py-2.5 text-sm whitespace-nowrap transition-colors border-b-2 ${tab === t.id ? 'border-primary text-foreground' : 'border-transparent text-muted-foreground hover:text-foreground'}`}>
              <t.icon className="h-3.5 w-3.5" />
              {t.label}
              {t.count > 0 && <span className="text-xs bg-accent px-1.5 py-0.5 rounded-full">{t.count}</span>}
            </button>
          ))}
        </div>
      </header>

      <div className="max-w-6xl mx-auto p-4 flex gap-4">
        <div className="flex-1 min-w-0">
          {error && (
            <div className="mb-4 flex items-center justify-between text-sm text-destructive bg-destructive/10 p-3 rounded-lg">
              {error}
              <button onClick={() => setError('')}><X className="h-3.5 w-3.5" /></button>
            </div>
          )}

          {/* ===== DISPATCH TAB ===== */}
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
                      <div className="flex items-center gap-1 text-sm">
                        <MapPin className="h-3 w-3 text-emerald-400 shrink-0" />
                        <span className="truncate">{ride.pickupAddress}</span>
                        <span className="text-muted-foreground mx-1">→</span>
                        <MapPin className="h-3 w-3 text-red-400 shrink-0" />
                        <span className="truncate">{ride.dropAddress}</span>
                      </div>
                      <p className="text-xs text-muted-foreground">
                        {ride.passenger?.name} · {format(new Date(ride.scheduledAt), 'dd MMM HH:mm')} · ₹{(ride.fare / 100).toFixed(0)}
                      </p>
                    </div>
                    <Button size="sm" onClick={() => handleAssign(ride.id)} disabled={loading === ride.id}>
                      {loading === ride.id ? '...' : 'Assign'}
                    </Button>
                  </CardContent>
                </Card>
              ))}
            </div>
          )}

          {/* ===== ACTIVE RIDES TAB ===== */}
          {tab === 'active' && (
            <div className="space-y-3">
              <h2 className="text-sm font-medium text-muted-foreground">Active rides ({activeRides.length})</h2>
              {activeRides.length === 0 && <p className="text-sm text-muted-foreground text-center py-8">No active rides</p>}
              {activeRides.map(ride => (
                <Card key={ride.id}>
                  <CardContent className="p-4 space-y-2">
                    <div className="flex items-center justify-between">
                      <div className="flex items-center gap-2">
                        <span className="font-mono text-xs text-muted-foreground">{ride.id.slice(0, 8)}</span>
                        <Badge variant={STATUS_BADGE[ride.status]}>{ride.status.replace('_', ' ')}</Badge>
                      </div>
                      <span className="text-sm font-medium">₹{(ride.fare / 100).toFixed(0)}</span>
                    </div>
                    <div className="flex items-center gap-1 text-sm">
                      <MapPin className="h-3 w-3 text-emerald-400 shrink-0" />
                      <span className="truncate">{ride.pickupAddress}</span>
                      <span className="text-muted-foreground mx-1">→</span>
                      <MapPin className="h-3 w-3 text-red-400 shrink-0" />
                      <span className="truncate">{ride.dropAddress}</span>
                    </div>
                    <div className="flex items-center justify-between text-xs text-muted-foreground">
                      <span>
                        Passenger: {ride.passenger?.name}
                        {ride.driver && <> · Driver: {ride.driver.name} ({ride.driver.employeeId})</>}
                        {ride.vehicle && <> · {ride.vehicle.plateNumber}</>}
                      </span>
                      <span><Clock className="h-3 w-3 inline mr-1" />{format(new Date(ride.scheduledAt), 'HH:mm')}</span>
                    </div>
                    <div className="flex gap-2 pt-1">
                      {['ASSIGNED', 'EN_ROUTE'].includes(ride.status) && (
                        <Button size="sm" variant="outline" className="gap-1" onClick={() => { setReassignRide(ride); setReassignDriverId('') }}>
                          <RefreshCw className="h-3 w-3" /> Reassign
                        </Button>
                      )}
                      <Button size="sm" variant="destructive" className="gap-1" onClick={() => { setCancelRide(ride); setCancelReason('') }}>
                        <Ban className="h-3 w-3" /> Cancel
                      </Button>
                    </div>
                  </CardContent>
                </Card>
              ))}
            </div>
          )}

          {/* ===== FLEET TAB ===== */}
          {tab === 'fleet' && (
            <div className="grid grid-cols-2 lg:grid-cols-3 gap-3">
              {fleet.map(v => {
                const soc = v.currentSoc ?? 100
                const socColor = soc > 50 ? 'bg-emerald-500' : soc > 20 ? 'bg-amber-500' : 'bg-red-500'
                return (
                  <Card key={v.id} className={`cursor-pointer hover:bg-accent/30 transition-colors ${soc < 20 ? 'border-red-500/40' : ''}`}
                    onClick={() => openVehicleDetail(v.id)}>
                    <CardContent className="p-4 space-y-2">
                      <div className="flex items-center justify-between">
                        <p className="font-mono text-sm font-medium">{v.plateNumber}</p>
                        <Badge variant={v.status === 'AVAILABLE' ? 'success' : v.status === 'ON_RIDE' ? 'warning' : v.status === 'CHARGING' ? 'info' : 'secondary'}>
                          {v.status}
                        </Badge>
                      </div>
                      <p className="text-xs text-muted-foreground">{v.model}</p>
                      {v.currentDriver && <p className="text-xs">Driver: {v.currentDriver.name}</p>}
                      <div className="space-y-1">
                        <div className="flex justify-between text-xs">
                          <span className="text-muted-foreground">Battery</span>
                          <span className={soc < 20 ? 'text-red-400 font-medium' : ''}>{soc}%</span>
                        </div>
                        <div className="h-2 bg-accent rounded-full overflow-hidden">
                          <div className={`h-full rounded-full transition-all ${socColor}`} style={{ width: `${soc}%` }} />
                        </div>
                      </div>
                    </CardContent>
                  </Card>
                )
              })}
            </div>
          )}

          {/* ===== DRIVERS TAB ===== */}
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
                        <p className="text-xs text-muted-foreground">{d.assignedVehicle.plateNumber} · SOC {d.assignedVehicle.currentSoc ?? '—'}%</p>
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

          {/* ===== FARE SLABS TAB (Super Admin) ===== */}
          {tab === 'slabs' && (
            <div className="space-y-4">
              <div className="flex items-center justify-between">
                <h2 className="text-sm font-medium text-muted-foreground">Fare slabs</h2>
                <Button size="sm" onClick={() => { setNewSlab(true); setEditingSlab(null); setSlabForm({ name: '', minKm: '', maxKm: '', price: '' }) }}>
                  <Plus className="h-3.5 w-3.5 mr-1" /> Add slab
                </Button>
              </div>

              {/* Slab editor */}
              {(editingSlab || newSlab) && (
                <Card className="border-primary/30">
                  <CardHeader className="pb-2">
                    <CardTitle className="text-sm">{editingSlab ? 'Edit slab' : 'New slab'}</CardTitle>
                  </CardHeader>
                  <CardContent className="space-y-3">
                    <Input placeholder="Name (e.g. 10 KM)" value={slabForm.name} onChange={e => setSlabForm(f => ({ ...f, name: e.target.value }))} />
                    <div className="grid grid-cols-3 gap-2">
                      <div>
                        <label className="text-xs text-muted-foreground">Min KM</label>
                        <Input type="number" value={slabForm.minKm} onChange={e => setSlabForm(f => ({ ...f, minKm: e.target.value }))} />
                      </div>
                      <div>
                        <label className="text-xs text-muted-foreground">Max KM</label>
                        <Input type="number" value={slabForm.maxKm} onChange={e => setSlabForm(f => ({ ...f, maxKm: e.target.value }))} />
                      </div>
                      <div>
                        <label className="text-xs text-muted-foreground">Price (paise)</label>
                        <Input type="number" value={slabForm.price} onChange={e => setSlabForm(f => ({ ...f, price: e.target.value }))} />
                      </div>
                    </div>
                    <p className="text-xs text-muted-foreground">
                      Preview: ₹{slabForm.price ? (Number(slabForm.price) / 100).toFixed(0) : '0'}
                    </p>
                    <div className="flex gap-2">
                      <Button variant="outline" className="flex-1" onClick={() => { setEditingSlab(null); setNewSlab(null) }}>Cancel</Button>
                      <Button className="flex-1" onClick={handleSaveSlab}
                        disabled={loading === 'slab' || !slabForm.name || !slabForm.minKm || !slabForm.maxKm || !slabForm.price}>
                        {loading === 'slab' ? 'Saving...' : 'Save'}
                      </Button>
                    </div>
                  </CardContent>
                </Card>
              )}

              {/* Slab list */}
              <div className="space-y-2">
                {slabs.map(slab => (
                  <Card key={slab.id} className={!slab.active ? 'opacity-50' : ''}>
                    <CardContent className="p-4 flex items-center justify-between">
                      <div>
                        <div className="flex items-center gap-2">
                          <p className="font-medium">{slab.name}</p>
                          {!slab.active && <Badge variant="secondary">Inactive</Badge>}
                        </div>
                        <p className="text-sm text-muted-foreground">{slab.minKm}–{slab.maxKm} km</p>
                      </div>
                      <div className="flex items-center gap-3">
                        <p className="text-lg font-bold">₹{(slab.price / 100).toFixed(0)}</p>
                        <Button size="sm" variant="ghost" onClick={() => {
                          setEditingSlab(slab); setNewSlab(null)
                          setSlabForm({ name: slab.name, minKm: String(slab.minKm), maxKm: String(slab.maxKm), price: String(slab.price) })
                        }}>
                          <Pencil className="h-3.5 w-3.5" />
                        </Button>
                        {slab.active && (
                          <Button size="sm" variant="ghost" className="text-destructive" onClick={() => handleDeleteSlab(slab.id)}>
                            <X className="h-3.5 w-3.5" />
                          </Button>
                        )}
                      </div>
                    </CardContent>
                  </Card>
                ))}
              </div>
            </div>
          )}
        </div>

        {/* ===== SIDEBAR: Live events ===== */}
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

      {/* ===== VEHICLE DETAIL DRAWER ===== */}
      {vehicleDetail && (
        <div className="fixed inset-0 z-50 flex justify-end" onClick={() => setVehicleDetail(null)}>
          <div className="absolute inset-0 bg-black/40" />
          <div className="relative w-full max-w-md bg-card border-l shadow-xl overflow-y-auto" onClick={e => e.stopPropagation()}>
            <div className="sticky top-0 bg-card border-b p-4 flex items-center justify-between">
              <div>
                <h2 className="font-bold">{vehicleDetail.plateNumber}</h2>
                <p className="text-sm text-muted-foreground">{vehicleDetail.model}</p>
              </div>
              <Button variant="ghost" size="icon" onClick={() => setVehicleDetail(null)}><X className="h-4 w-4" /></Button>
            </div>
            <div className="p-4 space-y-5">
              {/* SOC bar */}
              <div>
                <div className="flex justify-between text-sm mb-1">
                  <span className="text-muted-foreground">Battery</span>
                  <span className="font-medium">{vehicleDetail.currentSoc ?? '—'}%</span>
                </div>
                <div className="h-3 bg-accent rounded-full overflow-hidden">
                  <div className={`h-full rounded-full ${(vehicleDetail.currentSoc || 0) > 50 ? 'bg-emerald-500' : (vehicleDetail.currentSoc || 0) > 20 ? 'bg-amber-500' : 'bg-red-500'}`}
                    style={{ width: `${vehicleDetail.currentSoc || 0}%` }} />
                </div>
              </div>

              {/* Stats */}
              <div className="grid grid-cols-3 gap-3">
                <div className="bg-accent/50 rounded-lg p-3 text-center">
                  <p className="text-xl font-bold">{vehicleDetail.todayTrips}</p>
                  <p className="text-xs text-muted-foreground">Trips today</p>
                </div>
                <div className="bg-accent/50 rounded-lg p-3 text-center">
                  <p className="text-xl font-bold">{vehicleDetail.kmToday}</p>
                  <p className="text-xs text-muted-foreground">KM today</p>
                </div>
                <div className="bg-accent/50 rounded-lg p-3 text-center">
                  <p className="text-xl font-bold">{vehicleDetail.batteryCapacity}</p>
                  <p className="text-xs text-muted-foreground">kWh cap</p>
                </div>
              </div>

              {/* Current driver */}
              {vehicleDetail.currentDriver && (
                <div>
                  <h3 className="text-xs font-medium text-muted-foreground uppercase tracking-wider mb-2">Current driver</h3>
                  <div className="bg-accent/50 rounded-lg p-3 flex items-center gap-3">
                    <div className="h-8 w-8 rounded-full bg-primary/10 flex items-center justify-center">
                      <Users className="h-4 w-4 text-primary" />
                    </div>
                    <div>
                      <p className="text-sm font-medium">{vehicleDetail.currentDriver.name}</p>
                      <p className="text-xs text-muted-foreground">{vehicleDetail.currentDriver.employeeId}</p>
                    </div>
                  </div>
                </div>
              )}

              {/* Battery logs */}
              <div>
                <h3 className="text-xs font-medium text-muted-foreground uppercase tracking-wider mb-2">Last 10 battery logs</h3>
                {vehicleDetail.batteryLogs.length === 0 ? (
                  <p className="text-sm text-muted-foreground text-center py-4">No logs yet</p>
                ) : (
                  <div className="space-y-1">
                    {vehicleDetail.batteryLogs.map(log => (
                      <div key={log.id} className="flex items-center justify-between py-2 border-b border-border/50 last:border-0">
                        <div>
                          <p className="text-sm font-medium">{log.eventType.replace(/_/g, ' ')}</p>
                          <p className="text-xs text-muted-foreground">
                            {log.driver?.name} · {format(new Date(log.createdAt), 'dd MMM HH:mm')}
                          </p>
                        </div>
                        <div className="text-right">
                          <p className={`text-sm font-medium ${log.soc < 20 ? 'text-red-400' : log.soc > 80 ? 'text-emerald-400' : ''}`}>
                            {log.soc}%
                          </p>
                          {log.range && <p className="text-xs text-muted-foreground">{log.range} km</p>}
                        </div>
                      </div>
                    ))}
                  </div>
                )}
              </div>
            </div>
          </div>
        </div>
      )}

      {/* ===== REASSIGN MODAL ===== */}
      {reassignRide && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4" onClick={() => setReassignRide(null)}>
          <div className="absolute inset-0 bg-black/40" />
          <Card className="relative w-full max-w-sm" onClick={e => e.stopPropagation()}>
            <CardHeader>
              <CardTitle className="text-base">Reassign ride {reassignRide.id.slice(0, 8)}</CardTitle>
            </CardHeader>
            <CardContent className="space-y-3">
              <p className="text-sm text-muted-foreground">
                {reassignRide.pickupAddress} → {reassignRide.dropAddress}
              </p>
              <p className="text-xs text-muted-foreground">
                Current: {reassignRide.driver?.name || 'unassigned'}
              </p>
              <div>
                <label className="text-xs text-muted-foreground">Select new driver</label>
                <select className="w-full mt-1 h-9 rounded-md border border-input bg-transparent px-3 text-sm"
                  value={reassignDriverId} onChange={e => setReassignDriverId(e.target.value)}>
                  <option value="">Choose driver...</option>
                  {drivers.filter(d => d.online && d.id !== reassignRide.driver?.id).map(d => (
                    <option key={d.id} value={d.id}>{d.name} ({d.employeeId})</option>
                  ))}
                </select>
              </div>
              <div className="flex gap-2">
                <Button variant="outline" className="flex-1" onClick={() => setReassignRide(null)}>Cancel</Button>
                <Button className="flex-1" onClick={handleReassign} disabled={loading === 'reassign' || !reassignDriverId}>
                  {loading === 'reassign' ? 'Reassigning...' : 'Reassign'}
                </Button>
              </div>
            </CardContent>
          </Card>
        </div>
      )}

      {/* ===== CANCEL MODAL ===== */}
      {cancelRide && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4" onClick={() => setCancelRide(null)}>
          <div className="absolute inset-0 bg-black/40" />
          <Card className="relative w-full max-w-sm" onClick={e => e.stopPropagation()}>
            <CardHeader>
              <CardTitle className="text-base">Cancel ride {cancelRide.id.slice(0, 8)}</CardTitle>
            </CardHeader>
            <CardContent className="space-y-3">
              <p className="text-sm text-muted-foreground">
                {cancelRide.pickupAddress} → {cancelRide.dropAddress}
              </p>
              <Input placeholder="Reason for cancellation" value={cancelReason} onChange={e => setCancelReason(e.target.value)} />
              <div className="flex gap-2">
                <Button variant="outline" className="flex-1" onClick={() => setCancelRide(null)}>Back</Button>
                <Button variant="destructive" className="flex-1" onClick={handleCancelRide} disabled={loading === 'cancel' || !cancelReason}>
                  {loading === 'cancel' ? 'Cancelling...' : 'Confirm cancel'}
                </Button>
              </div>
            </CardContent>
          </Card>
        </div>
      )}
    </div>
  )
}
