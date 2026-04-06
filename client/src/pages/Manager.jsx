import { useState, useEffect, useCallback } from 'react'
import { useAuth } from '@/lib/auth'
import { api } from '@/lib/api'
import { useSSE } from '@/hooks/useSSE'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Card, CardHeader, CardTitle, CardContent } from '@/components/ui/card'
import { Badge } from '@/components/ui/badge'
import {
  LogOut, Truck, Users, Zap, CalendarClock, AlertTriangle,
  X, Map, IndianRupee, RefreshCw, Ban, Plus, Pencil, Clock,
  MapPin, UserPlus, Link2, Unlink, Trash2, Battery, CheckCircle2
} from 'lucide-react'
import { format } from 'date-fns'

const STATUS_BADGE = {
  BOOKED: 'info', ASSIGNED: 'info', EN_ROUTE: 'warning',
  ARRIVED: 'warning', IN_PROGRESS: 'success', COMPLETED: 'success', CANCELLED: 'danger',
}

export default function AdminPage() {
  const { auth, logout } = useAuth()
  const isSuperAdmin = auth.user.role === 'SUPER_ADMIN'

  // Data
  const [queue, setQueue] = useState([])
  const [activeRides, setActiveRides] = useState([])
  const [fleet, setFleet] = useState([])
  const [drivers, setDrivers] = useState([])
  const [slabs, setSlabs] = useState([])
  const [events, setEvents] = useState([])

  // UI state
  const [tab, setTab] = useState('dispatch')
  const [loading, setLoading] = useState('')
  const [error, setError] = useState('')

  // Modals / drawers
  const [vehicleDetail, setVehicleDetail] = useState(null)
  const [reassignRide, setReassignRide] = useState(null)
  const [cancelRide, setCancelRide] = useState(null)
  const [cancelReason, setCancelReason] = useState('')
  const [reassignDriverId, setReassignDriverId] = useState('')

  // Driver CRUD
  const [showDriverForm, setShowDriverForm] = useState(false)
  const [editingDriver, setEditingDriver] = useState(null)
  const [driverForm, setDriverForm] = useState({ name: '', phone: '', employeeId: '', pin: '1234' })

  // Vehicle CRUD
  const [showVehicleForm, setShowVehicleForm] = useState(false)
  const [editingVehicle, setEditingVehicle] = useState(null)
  const [vehicleForm, setVehicleForm] = useState({ plateNumber: '', model: '', year: '2024', batteryCapacity: '40', parkingBay: '' })

  // Vehicle-driver assignment
  const [assigningVehicle, setAssigningVehicle] = useState(null)
  const [assignDriverId, setAssignDriverId] = useState('')

  // Slab CRUD
  const [showSlabForm, setShowSlabForm] = useState(false)
  const [editingSlab, setEditingSlab] = useState(null)
  const [slabForm, setSlabForm] = useState({ name: '', minKm: '', maxKm: '', price: '' })

  // Fetchers
  const f = useCallback((fn) => async () => { try { return fn() } catch {} }, [])
  const fetchQueue = useCallback(async () => { try { setQueue(await api('GET', '/admin/queue', null, auth.token)) } catch {} }, [auth.token])
  const fetchActiveRides = useCallback(async () => { try { setActiveRides(await api('GET', '/admin/active-rides', null, auth.token)) } catch {} }, [auth.token])
  const fetchFleet = useCallback(async () => { try { setFleet(await api('GET', '/admin/fleet', null, auth.token)) } catch {} }, [auth.token])
  const fetchDrivers = useCallback(async () => { try { setDrivers(await api('GET', '/admin/drivers', null, auth.token)) } catch {} }, [auth.token])
  const fetchSlabs = useCallback(async () => { try { setSlabs(await api('GET', '/admin/slabs', null, auth.token)) } catch {} }, [auth.token])

  useEffect(() => { fetchQueue(); fetchActiveRides(); fetchFleet(); fetchDrivers(); fetchSlabs() }, [])

  // SSE
  useSSE('fleet', {
    ride_booked: (d) => { addEvent('info', `Ride booked: ${d.pickupAddress}`); fetchQueue() },
    ride_assigned: () => { addEvent('success', 'Ride assigned'); fetchQueue(); fetchActiveRides() },
    ride_status_change: (d) => { addEvent('info', `${d.rideId.slice(0,8)}: ${d.from} → ${d.to}`); fetchActiveRides() },
    ride_reassigned: () => { addEvent('warning', 'Ride reassigned'); fetchActiveRides() },
    ride_cancelled: (d) => { addEvent('danger', `Ride cancelled: ${d.reason || ''}`); fetchActiveRides(); fetchQueue() },
    driver_online: () => { addEvent('success', 'Driver came online'); fetchDrivers() },
    driver_offline: () => { addEvent('warning', 'Driver went offline'); fetchDrivers() },
    low_battery_alert: (d) => { addEvent('danger', `LOW BATTERY: ${d.soc}%`); fetchFleet() },
    battery_log: (d) => {
      const labels = { VEHICLE_PICKUP: 'Vehicle pickup', VEHICLE_DROP: 'Post-ride log', CHARGE_START: 'Charging started', CHARGE_END: 'Charging ended' }
      addEvent(d.eventType === 'CHARGE_START' ? 'info' : d.eventType === 'CHARGE_END' ? 'success' : 'info',
        `${labels[d.eventType] || d.eventType}: SOC ${d.soc}%`)
      fetchFleet()
    },
    vehicle_location: () => { fetchFleet() },
  })

  const fetchEvents = useCallback(async () => {
    try {
      const data = await api('GET', '/admin/events', null, auth.token);
      setEvents(data.map(e => ({ type: e.type, message: e.message, ts: new Date(e.createdAt) })));
    } catch {}
  }, [auth.token]);

  useEffect(() => {
    fetchQueue(); fetchActiveRides(); fetchFleet(); fetchDrivers(); fetchSlabs(); fetchEvents();
  }, []);

  const addEvent = (type, message) =>
  setEvents(prev => {
    const cutoff = Date.now() - 24 * 60 * 60 * 1000;
    return [{ type, message, ts: new Date() }, ...prev]
      .filter(e => e.ts.getTime() > cutoff);
  });

  useEffect(() => {
    const interval = setInterval(() => {
      const cutoff = Date.now() - 24 * 60 * 60 * 1000;
      setEvents(prev => prev.filter(e => e.ts.getTime() > cutoff));
    }, 60_000);
    return () => clearInterval(interval);
  }, []);

  // ===== DISPATCH ACTIONS =====
  const handleAssign = async (rideId) => {
    const d = drivers.find(d => d.online && d.active)
    const v = fleet.find(v => v.status === 'AVAILABLE' && (v.currentSoc || 100) > 20)
    if (!d) return setError('No online drivers available')
    if (!v) return setError('No available vehicles with >20% SOC')
    setLoading(rideId)
    try { await api('POST', '/admin/assign', { rideId, driverId: d.id, vehicleId: v.id }, auth.token); fetchQueue(); fetchActiveRides() }
    catch (e) { setError(e.message) }
    setLoading('')
  }

  const handleReassign = async () => {
    if (!reassignRide || !reassignDriverId) return
    setLoading('reassign')
    try { await api('POST', '/admin/reassign', { rideId: reassignRide.id, driverId: reassignDriverId }, auth.token); setReassignRide(null); fetchActiveRides() }
    catch (e) { setError(e.message) }
    setLoading('')
  }

  const handleCancelRide = async () => {
    if (!cancelRide || !cancelReason) return
    setLoading('cancel')
    try { await api('POST', '/admin/cancel-ride', { rideId: cancelRide.id, reason: cancelReason }, auth.token); setCancelRide(null); setCancelReason(''); fetchActiveRides(); fetchQueue() }
    catch (e) { setError(e.message) }
    setLoading('')
  }

  // ===== DRIVER CRUD ACTIONS =====
  const handleSaveDriver = async () => {
    setLoading('driver')
    try {
      if (editingDriver) {
        await api('PUT', `/admin/drivers/${editingDriver.id}`, driverForm, auth.token)
      } else {
        await api('POST', '/admin/drivers', driverForm, auth.token)
      }
      resetDriverForm(); fetchDrivers()
    } catch (e) { setError(e.message) }
    setLoading('')
  }

  const handleDeleteDriver = async (id) => {
    setLoading(`del-driver-${id}`)
    try { await api('DELETE', `/admin/drivers/${id}`, null, auth.token); fetchDrivers(); fetchFleet() }
    catch (e) { setError(e.message) }
    setLoading('')
  }

  const resetDriverForm = () => { setShowDriverForm(false); setEditingDriver(null); setDriverForm({ name: '', phone: '', employeeId: '', pin: '1234' }) }

  // ===== VEHICLE CRUD ACTIONS =====
  const handleSaveVehicle = async () => {
    setLoading('vehicle')
    try {
      const data = { ...vehicleForm, year: Number(vehicleForm.year), batteryCapacity: Number(vehicleForm.batteryCapacity) }
      if (editingVehicle) {
        await api('PUT', `/admin/vehicles/${editingVehicle.id}`, data, auth.token)
      } else {
        await api('POST', '/admin/vehicles', data, auth.token)
      }
      resetVehicleForm(); fetchFleet()
    } catch (e) { setError(e.message) }
    setLoading('')
  }

  const handleDeleteVehicle = async (id) => {
    setLoading(`del-veh-${id}`)
    try { await api('DELETE', `/admin/vehicles/${id}`, null, auth.token); fetchFleet() }
    catch (e) { setError(e.message) }
    setLoading('')
  }

  const handleAssignDriverToVehicle = async () => {
    if (!assigningVehicle || !assignDriverId) return
    setLoading('assign-veh')
    try { await api('POST', `/admin/vehicles/${assigningVehicle.id}/assign-driver`, { driverId: assignDriverId }, auth.token); setAssigningVehicle(null); setAssignDriverId(''); fetchFleet(); fetchDrivers() }
    catch (e) { setError(e.message) }
    setLoading('')
  }

  const handleUnassignDriver = async (vehicleId) => {
    setLoading(`unassign-${vehicleId}`)
    try { await api('POST', `/admin/vehicles/${vehicleId}/unassign-driver`, {}, auth.token); fetchFleet(); fetchDrivers() }
    catch (e) { setError(e.message) }
    setLoading('')
  }

  const resetVehicleForm = () => { setShowVehicleForm(false); setEditingVehicle(null); setVehicleForm({ plateNumber: '', model: '', year: '2024', batteryCapacity: '40', parkingBay: '' }) }

  const openVehicleDetail = async (vehicleId) => {
    try { setVehicleDetail(await api('GET', `/admin/vehicles/${vehicleId}/detail`, null, auth.token)) }
    catch (e) { setError(e.message) }
  }

  // ===== SLAB CRUD ACTIONS =====
  const handleSaveSlab = async () => {
    setLoading('slab')
    try {
      const data = { name: slabForm.name, minKm: Number(slabForm.minKm), maxKm: Number(slabForm.maxKm), price: Number(slabForm.price) }
      if (editingSlab) { await api('PUT', `/admin/slabs/${editingSlab.id}`, data, auth.token) }
      else { await api('POST', '/admin/slabs', data, auth.token) }
      resetSlabForm(); fetchSlabs()
    } catch (e) { setError(e.message) }
    setLoading('')
  }

  const handleDeleteSlab = async (id) => {
    try { await api('DELETE', `/admin/slabs/${id}`, null, auth.token); fetchSlabs() }
    catch (e) { setError(e.message) }
  }

  const resetSlabForm = () => { setShowSlabForm(false); setEditingSlab(null); setSlabForm({ name: '', minKm: '', maxKm: '', price: '' }) }

  // ===== RENDER =====
  const lowBatteryCount = fleet.filter(v => (v.currentSoc || 100) < 20).length
  const onlineDriverCount = drivers.filter(d => d.online).length

  const tabs = [
    { id: 'dispatch', label: 'Dispatch', icon: CalendarClock, count: queue.length },
    { id: 'active', label: 'Active rides', icon: Map, count: activeRides.length },
    { id: 'fleet', label: 'Fleet', icon: Truck, count: fleet.length },
    { id: 'drivers', label: 'Drivers', icon: Users, count: onlineDriverCount },
    ...(isSuperAdmin ? [{ id: 'slabs', label: 'Fare slabs', icon: IndianRupee, count: slabs.filter(s => s.active).length }] : []),
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
            {lowBatteryCount > 0 && <Badge variant="danger" className="gap-1"><AlertTriangle className="h-3 w-3" /> {lowBatteryCount} low battery</Badge>}
            <Button variant="ghost" size="icon" onClick={logout}><LogOut className="h-4 w-4" /></Button>
          </div>
        </div>
        <div className="max-w-6xl mx-auto flex border-t border-border overflow-x-auto">
          {tabs.map(t => (
            <button key={t.id} onClick={() => setTab(t.id)}
              className={`flex items-center justify-center gap-2 px-4 py-2.5 text-sm whitespace-nowrap transition-colors border-b-2 ${tab === t.id ? 'border-primary text-foreground' : 'border-transparent text-muted-foreground hover:text-foreground'}`}>
              <t.icon className="h-3.5 w-3.5" />{t.label}
              {t.count > 0 && <span className="text-xs bg-accent px-1.5 py-0.5 rounded-full">{t.count}</span>}
            </button>
          ))}
        </div>
      </header>

      <div className="max-w-6xl mx-auto p-4 flex gap-4">
        <div className="flex-1 min-w-0">
          {error && (
            <div className="mb-4 flex items-center justify-between text-sm text-destructive bg-destructive/10 p-3 rounded-lg">
              {error}<button onClick={() => setError('')}><X className="h-3.5 w-3.5" /></button>
            </div>
          )}

          {/* ===== DISPATCH ===== */}
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
                      <p className="text-xs text-muted-foreground">{ride.passenger?.name} · {format(new Date(ride.scheduledAt), 'dd MMM HH:mm')} · ₹{(ride.fare / 100).toFixed(0)}</p>
                    </div>
                    <Button size="sm" onClick={() => handleAssign(ride.id)} disabled={loading === ride.id}>
                      {loading === ride.id ? '...' : 'Assign'}
                    </Button>
                  </CardContent>
                </Card>
              ))}
            </div>
          )}

          {/* ===== ACTIVE RIDES ===== */}
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
                    <p className="text-sm truncate">{ride.pickupAddress} → {ride.dropAddress}</p>
                    <p className="text-xs text-muted-foreground">
                      {ride.passenger?.name}{ride.driver && ` · ${ride.driver.name} (${ride.driver.employeeId})`}{ride.vehicle && ` · ${ride.vehicle.plateNumber}`}
                    </p>
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

          {/* ===== FLEET ===== */}
          {tab === 'fleet' && (
            <div className="space-y-4">
              <div className="flex items-center justify-between">
                <h2 className="text-sm font-medium text-muted-foreground">Vehicles ({fleet.length})</h2>
                <Button size="sm" onClick={() => { setShowVehicleForm(true); setEditingVehicle(null); resetVehicleForm(); setShowVehicleForm(true) }}>
                  <Plus className="h-3.5 w-3.5 mr-1" /> Add vehicle
                </Button>
              </div>

              {showVehicleForm && (
                <Card className="border-primary/30">
                  <CardHeader className="pb-2"><CardTitle className="text-sm">{editingVehicle ? 'Edit vehicle' : 'New vehicle'}</CardTitle></CardHeader>
                  <CardContent className="space-y-3">
                    <div className="grid grid-cols-2 gap-2">
                      <Input placeholder="Plate number" value={vehicleForm.plateNumber} onChange={e => setVehicleForm(f => ({ ...f, plateNumber: e.target.value }))} />
                      <Input placeholder="Model" value={vehicleForm.model} onChange={e => setVehicleForm(f => ({ ...f, model: e.target.value }))} />
                      <Input placeholder="Year" type="number" value={vehicleForm.year} onChange={e => setVehicleForm(f => ({ ...f, year: e.target.value }))} />
                      <Input placeholder="Battery kWh" type="number" value={vehicleForm.batteryCapacity} onChange={e => setVehicleForm(f => ({ ...f, batteryCapacity: e.target.value }))} />
                      <Input placeholder="Parking bay" value={vehicleForm.parkingBay} onChange={e => setVehicleForm(f => ({ ...f, parkingBay: e.target.value }))} className="col-span-2" />
                    </div>
                    <div className="flex gap-2">
                      <Button variant="outline" className="flex-1" onClick={resetVehicleForm}>Cancel</Button>
                      <Button className="flex-1" onClick={handleSaveVehicle} disabled={loading === 'vehicle' || !vehicleForm.plateNumber || !vehicleForm.model}>
                        {loading === 'vehicle' ? 'Saving...' : 'Save'}
                      </Button>
                    </div>
                  </CardContent>
                </Card>
              )}

              <div className="grid grid-cols-2 lg:grid-cols-3 gap-3">
                {fleet.map(v => {
                  const soc = v.currentSoc ?? 100
                  const socColor = soc > 50 ? 'bg-emerald-500' : soc > 20 ? 'bg-amber-500' : 'bg-red-500'
                  return (
                    <Card key={v.id} className={soc < 20 ? 'border-red-500/40' : ''}>
                      <CardContent className="p-4 space-y-2">
                        <div className="flex items-center justify-between">
                          <p className="font-mono text-sm font-medium cursor-pointer hover:text-primary" onClick={() => openVehicleDetail(v.id)}>{v.plateNumber}</p>
                          <Badge variant={
                            v.status === 'AVAILABLE' ? 'success' :
                            v.status === 'ON_RIDE' ? 'warning' :
                            v.status === 'CHARGING' ? 'info' :
                            v.status === 'IDLE' ? 'secondary' :
                            'secondary'
                          }>
                            {v.status}
                          </Badge>
                        </div>
                        <p className="text-xs text-muted-foreground">{v.model} · {v.parkingBay || 'No bay'}</p>

                        {/* Driver assignment */}
                        {v.currentDriver ? (
                          <div className="flex items-center justify-between bg-accent/50 rounded p-2">
                            <div className="text-xs">
                              <span className="font-medium">{v.currentDriver.name}</span>
                              <span className="text-muted-foreground ml-1">{v.currentDriver.employeeId}</span>
                            </div>
                            <Button size="sm" variant="ghost" className="h-6 w-6 p-0" onClick={() => handleUnassignDriver(v.id)}
                              disabled={loading === `unassign-${v.id}`}>
                              <Unlink className="h-3 w-3" />
                            </Button>
                          </div>
                        ) : (
                          <Button size="sm" variant="outline" className="w-full text-xs gap-1" onClick={() => { setAssigningVehicle(v); setAssignDriverId('') }}>
                            <Link2 className="h-3 w-3" /> Assign driver
                          </Button>
                        )}

                        {/* SOC bar */}
                        <div className="space-y-1">
                          <div className="flex justify-between text-xs">
                            <span className="text-muted-foreground">SOC</span>
                            <span className={soc < 20 ? 'text-red-400 font-medium' : ''}>{soc}%</span>
                          </div>
                          <div className="h-1.5 bg-accent rounded-full overflow-hidden">
                            <div className={`h-full rounded-full ${socColor}`} style={{ width: `${soc}%` }} />
                          </div>
                        </div>

                        {/* Actions */}
                        <div className="flex gap-1 pt-1">
                          <Button size="sm" variant="ghost" className="flex-1 h-7 text-xs" onClick={() => {
                            setEditingVehicle(v); setShowVehicleForm(true)
                            setVehicleForm({ plateNumber: v.plateNumber, model: v.model, year: String(v.year || 2024), batteryCapacity: String(v.batteryCapacity || 40), parkingBay: v.parkingBay || '' })
                          }}><Pencil className="h-3 w-3 mr-1" /> Edit</Button>
                          <Button size="sm" variant="ghost" className="h-7 text-xs text-destructive" onClick={() => handleDeleteVehicle(v.id)}
                            disabled={loading === `del-veh-${v.id}`}>
                            <Trash2 className="h-3 w-3" />
                          </Button>
                        </div>
                      </CardContent>
                    </Card>
                  )
                })}
              </div>
            </div>
          )}

          {/* ===== DRIVERS ===== */}
          {tab === 'drivers' && (
            <div className="space-y-4">
              <div className="flex items-center justify-between">
                <h2 className="text-sm font-medium text-muted-foreground">Drivers ({drivers.length} total, {onlineDriverCount} online)</h2>
                <Button size="sm" onClick={() => { setShowDriverForm(true); setEditingDriver(null); setDriverForm({ name: '', phone: '', employeeId: '', pin: '1234' }) }}>
                  <UserPlus className="h-3.5 w-3.5 mr-1" /> Add driver
                </Button>
              </div>

              {showDriverForm && (
                <Card className="border-primary/30">
                  <CardHeader className="pb-2"><CardTitle className="text-sm">{editingDriver ? 'Edit driver' : 'New driver'}</CardTitle></CardHeader>
                  <CardContent className="space-y-3">
                    <div className="grid grid-cols-2 gap-2">
                      <Input placeholder="Name" value={driverForm.name} onChange={e => setDriverForm(f => ({ ...f, name: e.target.value }))} />
                      <Input placeholder="Phone (+91...)" value={driverForm.phone} onChange={e => setDriverForm(f => ({ ...f, phone: e.target.value }))} />
                      <Input placeholder="Employee ID (BRZ0031)" value={driverForm.employeeId} onChange={e => setDriverForm(f => ({ ...f, employeeId: e.target.value }))}
                        disabled={!!editingDriver} />
                      <Input placeholder="PIN" value={driverForm.pin} onChange={e => setDriverForm(f => ({ ...f, pin: e.target.value }))} />
                    </div>
                    <div className="flex gap-2">
                      <Button variant="outline" className="flex-1" onClick={resetDriverForm}>Cancel</Button>
                      <Button className="flex-1" onClick={handleSaveDriver}
                        disabled={loading === 'driver' || !driverForm.name || (!editingDriver && (!driverForm.phone || !driverForm.employeeId))}>
                        {loading === 'driver' ? 'Saving...' : 'Save'}
                      </Button>
                    </div>
                  </CardContent>
                </Card>
              )}

              <div className="space-y-2">
                {drivers.map(d => (
                  <Card key={d.id} className={!d.active ? 'opacity-50' : ''}>
                    <CardContent className="p-3 flex items-center justify-between">
                      <div className="flex items-center gap-3">
                        <div className={`h-2.5 w-2.5 rounded-full ${d.online ? 'bg-emerald-400' : 'bg-muted-foreground/30'}`} />
                        <div>
                          <div className="flex items-center gap-2">
                            <p className="text-sm font-medium">{d.name}</p>
                            {!d.active && <Badge variant="danger" className="text-[10px]">Deactivated</Badge>}
                          </div>
                          <p className="text-xs text-muted-foreground">{d.employeeId} · {d.phone}</p>
                        </div>
                      </div>
                      <div className="flex items-center gap-2">
                        {d.assignedVehicle && (
                          <Badge variant="outline" className="text-[10px]">{d.assignedVehicle.plateNumber}</Badge>
                        )}
                        <Badge variant={d.online ? 'success' : 'secondary'} className="text-[10px]">{d.online ? 'Online' : 'Offline'}</Badge>
                        <Button size="sm" variant="ghost" className="h-7 w-7 p-0" onClick={() => {
                          setEditingDriver(d); setShowDriverForm(true)
                          setDriverForm({ name: d.name, phone: d.phone, employeeId: d.employeeId, pin: '' })
                        }}><Pencil className="h-3 w-3" /></Button>
                        {d.active && (
                          <Button size="sm" variant="ghost" className="h-7 w-7 p-0 text-destructive" onClick={() => handleDeleteDriver(d.id)}
                            disabled={loading === `del-driver-${d.id}`}>
                            <Trash2 className="h-3 w-3" />
                          </Button>
                        )}
                      </div>
                    </CardContent>
                  </Card>
                ))}
              </div>
            </div>
          )}

          {/* ===== FARE SLABS (Super Admin) ===== */}
          {tab === 'slabs' && (
            <div className="space-y-4">
              <div className="flex items-center justify-between">
                <h2 className="text-sm font-medium text-muted-foreground">Fare slabs</h2>
                <Button size="sm" onClick={() => { setShowSlabForm(true); setEditingSlab(null); setSlabForm({ name: '', minKm: '', maxKm: '', price: '' }) }}>
                  <Plus className="h-3.5 w-3.5 mr-1" /> Add slab
                </Button>
              </div>

              {showSlabForm && (
                <Card className="border-primary/30">
                  <CardHeader className="pb-2"><CardTitle className="text-sm">{editingSlab ? 'Edit slab' : 'New slab'}</CardTitle></CardHeader>
                  <CardContent className="space-y-3">
                    <Input placeholder="Name (e.g. 10 KM)" value={slabForm.name} onChange={e => setSlabForm(f => ({ ...f, name: e.target.value }))} />
                    <div className="grid grid-cols-3 gap-2">
                      <div><label className="text-xs text-muted-foreground">Min KM</label><Input type="number" value={slabForm.minKm} onChange={e => setSlabForm(f => ({ ...f, minKm: e.target.value }))} /></div>
                      <div><label className="text-xs text-muted-foreground">Max KM</label><Input type="number" value={slabForm.maxKm} onChange={e => setSlabForm(f => ({ ...f, maxKm: e.target.value }))} /></div>
                      <div><label className="text-xs text-muted-foreground">Price (paise)</label><Input type="number" value={slabForm.price} onChange={e => setSlabForm(f => ({ ...f, price: e.target.value }))} /></div>
                    </div>
                    <p className="text-xs text-muted-foreground">Preview: ₹{slabForm.price ? (Number(slabForm.price) / 100).toFixed(0) : '0'}</p>
                    <div className="flex gap-2">
                      <Button variant="outline" className="flex-1" onClick={resetSlabForm}>Cancel</Button>
                      <Button className="flex-1" onClick={handleSaveSlab} disabled={loading === 'slab' || !slabForm.name || !slabForm.price}>
                        {loading === 'slab' ? 'Saving...' : 'Save'}
                      </Button>
                    </div>
                  </CardContent>
                </Card>
              )}

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
                          setEditingSlab(slab); setShowSlabForm(true)
                          setSlabForm({ name: slab.name, minKm: String(slab.minKm), maxKm: String(slab.maxKm), price: String(slab.price) })
                        }}><Pencil className="h-3.5 w-3.5" /></Button>
                        {slab.active && <Button size="sm" variant="ghost" className="text-destructive" onClick={() => handleDeleteSlab(slab.id)}><X className="h-3.5 w-3.5" /></Button>}
                      </div>
                    </CardContent>
                  </Card>
                ))}
              </div>
            </div>
          )}
        </div>

        {/* Sidebar: recent events */}
        <div className="w-64 shrink-0 hidden lg:block">
          <Card className="sticky top-[120px]">
            <CardHeader className="pb-2"><CardTitle className="text-sm flex items-center gap-2"><Zap className="h-3.5 w-3.5 text-primary" /> Recent events</CardTitle></CardHeader>
            <CardContent className="p-3 max-h-[60vh] overflow-y-auto">
              {events.length === 0 && <p className="text-xs text-muted-foreground text-center py-4">Waiting...</p>}
              {events.map((ev, i) => (
                <div key={i} className="py-1.5 border-b border-border/50 last:border-0">
                  <p className={`text-xs ${ev.type === 'danger' ? 'text-red-400' : ev.type === 'success' ? 'text-emerald-400' : ev.type === 'warning' ? 'text-amber-400' : 'text-muted-foreground'}`}>{ev.message}</p>
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
              <div><h2 className="font-bold">{vehicleDetail.plateNumber}</h2><p className="text-sm text-muted-foreground">{vehicleDetail.model}</p></div>
              <Button variant="ghost" size="icon" onClick={() => setVehicleDetail(null)}><X className="h-4 w-4" /></Button>
            </div>
            <div className="p-4 space-y-5">
              <div>
                <div className="flex justify-between text-sm mb-1"><span className="text-muted-foreground">Battery</span><span className="font-medium">{vehicleDetail.currentSoc ?? '—'}%</span></div>
                <div className="h-3 bg-accent rounded-full overflow-hidden">
                  <div className={`h-full rounded-full ${(vehicleDetail.currentSoc || 0) > 50 ? 'bg-emerald-500' : (vehicleDetail.currentSoc || 0) > 20 ? 'bg-amber-500' : 'bg-red-500'}`}
                    style={{ width: `${vehicleDetail.currentSoc || 0}%` }} />
                </div>
              </div>
              <div className="grid grid-cols-3 gap-3">
                <div className="bg-accent/50 rounded-lg p-3 text-center"><p className="text-xl font-bold">{vehicleDetail.todayTrips}</p><p className="text-xs text-muted-foreground">Trips today</p></div>
                <div className="bg-accent/50 rounded-lg p-3 text-center"><p className="text-xl font-bold">{vehicleDetail.kmToday}</p><p className="text-xs text-muted-foreground">KM today</p></div>
                <div className="bg-accent/50 rounded-lg p-3 text-center"><p className="text-xl font-bold">{vehicleDetail.batteryCapacity}</p><p className="text-xs text-muted-foreground">kWh</p></div>
              </div>
              {vehicleDetail.currentDriver && (
                <div>
                  <h3 className="text-xs font-medium text-muted-foreground uppercase tracking-wider mb-2">Current driver</h3>
                  <div className="bg-accent/50 rounded-lg p-3 flex items-center gap-3">
                    <Users className="h-4 w-4 text-primary" />
                    <div><p className="text-sm font-medium">{vehicleDetail.currentDriver.name}</p><p className="text-xs text-muted-foreground">{vehicleDetail.currentDriver.employeeId}</p></div>
                  </div>
                </div>
              )}
              <div>
                <h3 className="text-xs font-medium text-muted-foreground uppercase tracking-wider mb-2">Last 10 battery logs</h3>
                {vehicleDetail.batteryLogs.length === 0 ? <p className="text-sm text-muted-foreground text-center py-4">No logs</p> : (
                  <div className="space-y-1">
                    {vehicleDetail.batteryLogs.map(log => (
                      <div key={log.id} className="flex items-center justify-between py-2 border-b border-border/50 last:border-0">
                        <div>
                          <p className="text-sm font-medium">{log.eventType.replace(/_/g, ' ')}</p>
                          <p className="text-xs text-muted-foreground">{log.driver?.name} · {format(new Date(log.createdAt), 'dd MMM HH:mm')}</p>
                        </div>
                        <div className="text-right">
                          <p className={`text-sm font-medium ${log.soc < 20 ? 'text-red-400' : log.soc > 80 ? 'text-emerald-400' : ''}`}>{log.soc}%</p>
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

      {/* ===== ASSIGN DRIVER TO VEHICLE MODAL ===== */}
      {assigningVehicle && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4" onClick={() => setAssigningVehicle(null)}>
          <div className="absolute inset-0 bg-black/40" />
          <Card className="relative w-full max-w-sm" onClick={e => e.stopPropagation()}>
            <CardHeader><CardTitle className="text-base">Assign driver to {assigningVehicle.plateNumber}</CardTitle></CardHeader>
            <CardContent className="space-y-3">
              <select className="w-full h-9 rounded-md border border-input bg-transparent px-3 text-sm"
                value={assignDriverId} onChange={e => setAssignDriverId(e.target.value)}>
                <option value="">Choose driver...</option>
                {drivers.filter(d => d.active && !d.assignedVehicle).map(d => (
                  <option key={d.id} value={d.id}>{d.name} ({d.employeeId})</option>
                ))}
              </select>
              <p className="text-xs text-muted-foreground">Only showing drivers without a vehicle assignment</p>
              <div className="flex gap-2">
                <Button variant="outline" className="flex-1" onClick={() => setAssigningVehicle(null)}>Cancel</Button>
                <Button className="flex-1" onClick={handleAssignDriverToVehicle} disabled={loading === 'assign-veh' || !assignDriverId}>
                  {loading === 'assign-veh' ? 'Assigning...' : 'Assign'}
                </Button>
              </div>
            </CardContent>
          </Card>
        </div>
      )}

      {/* ===== REASSIGN RIDE MODAL ===== */}
      {reassignRide && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4" onClick={() => setReassignRide(null)}>
          <div className="absolute inset-0 bg-black/40" />
          <Card className="relative w-full max-w-sm" onClick={e => e.stopPropagation()}>
            <CardHeader><CardTitle className="text-base">Reassign ride {reassignRide.id.slice(0, 8)}</CardTitle></CardHeader>
            <CardContent className="space-y-3">
              <p className="text-sm text-muted-foreground">{reassignRide.pickupAddress} → {reassignRide.dropAddress}</p>
              <p className="text-xs text-muted-foreground">Current: {reassignRide.driver?.name || 'unassigned'}</p>
              <select className="w-full h-9 rounded-md border border-input bg-transparent px-3 text-sm"
                value={reassignDriverId} onChange={e => setReassignDriverId(e.target.value)}>
                <option value="">Choose new driver...</option>
                {drivers.filter(d => d.online && d.id !== reassignRide.driver?.id).map(d => (
                  <option key={d.id} value={d.id}>{d.name} ({d.employeeId})</option>
                ))}
              </select>
              <div className="flex gap-2">
                <Button variant="outline" className="flex-1" onClick={() => setReassignRide(null)}>Cancel</Button>
                <Button className="flex-1" onClick={handleReassign} disabled={loading === 'reassign' || !reassignDriverId}>
                  {loading === 'reassign' ? '...' : 'Reassign'}
                </Button>
              </div>
            </CardContent>
          </Card>
        </div>
      )}

      {/* ===== CANCEL RIDE MODAL ===== */}
      {cancelRide && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4" onClick={() => setCancelRide(null)}>
          <div className="absolute inset-0 bg-black/40" />
          <Card className="relative w-full max-w-sm" onClick={e => e.stopPropagation()}>
            <CardHeader><CardTitle className="text-base">Cancel ride {cancelRide.id.slice(0, 8)}</CardTitle></CardHeader>
            <CardContent className="space-y-3">
              <p className="text-sm text-muted-foreground">{cancelRide.pickupAddress} → {cancelRide.dropAddress}</p>
              <Input placeholder="Reason for cancellation" value={cancelReason} onChange={e => setCancelReason(e.target.value)} />
              <div className="flex gap-2">
                <Button variant="outline" className="flex-1" onClick={() => setCancelRide(null)}>Back</Button>
                <Button variant="destructive" className="flex-1" onClick={handleCancelRide} disabled={loading === 'cancel' || !cancelReason}>
                  {loading === 'cancel' ? '...' : 'Confirm cancel'}
                </Button>
              </div>
            </CardContent>
          </Card>
        </div>
      )}
    </div>
  )
}