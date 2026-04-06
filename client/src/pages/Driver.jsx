import { useState, useEffect, useCallback, useRef } from 'react'
import { useAuth } from '@/lib/auth'
import { api } from '@/lib/api'
import { useSSE } from '@/hooks/useSSE'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Card, CardHeader, CardTitle, CardContent } from '@/components/ui/card'
import { Badge } from '@/components/ui/badge'
import { LogOut, MapPin, Battery, Power, ChevronRight, Plug, Zap, Navigation, CheckCircle2, Crosshair, Radio } from 'lucide-react'
import DriverMap from '@/components/DriverMap'

const NEXT_STATUS = { ASSIGNED: 'EN_ROUTE', EN_ROUTE: 'ARRIVED', ARRIVED: 'IN_PROGRESS', IN_PROGRESS: 'COMPLETED' }
const NEXT_LABEL = { ASSIGNED: 'Start driving', EN_ROUTE: 'Arrived at pickup', ARRIVED: 'Start ride', IN_PROGRESS: 'Complete ride' }
const STATUS_COLOR = { ASSIGNED: 'info', EN_ROUTE: 'warning', ARRIVED: 'warning', IN_PROGRESS: 'success' }

export default function DriverPage() {
  const { auth, logout } = useAuth()
  const [shift, setShift] = useState(null)
  const [soc, setSoc] = useState('')
  const [chargerStation, setChargerStation] = useState('')
  const [loading, setLoading] = useState('')
  const [error, setError] = useState('')

  // Map state
  const [liveTracking, setLiveTracking] = useState(false)
  const [driverLocation, setDriverLocation] = useState(null)
  const watchIdRef = useRef(null)
  const pingIntervalRef = useRef(null)

  const fetchShift = useCallback(async () => {
    try {
      const data = await api('GET', '/drivers/shift-state', null, auth.token)
      console.log('[SHIFT STATE]', data.state, 'logs:', data.todaysLogs?.map(l => l.eventType))
      setShift(data)
    } catch (e) { setError(e.message) }
  }, [auth.token])

  useEffect(() => { fetchShift() }, [fetchShift])

  useSSE(`driver/${auth.user.id}`, {
    ride_assigned: () => fetchShift(),
    ride_update: () => fetchShift(),
  })

  // Live GPS tracking
  const startLiveTracking = useCallback(() => {
    if (!navigator.geolocation) { setError('Geolocation not supported'); return }

    watchIdRef.current = navigator.geolocation.watchPosition(
      (pos) => {
        const loc = { lat: pos.coords.latitude, lng: pos.coords.longitude }
        setDriverLocation(loc)
      },
      (err) => console.warn('GPS error:', err.message),
      { enableHighAccuracy: true, maximumAge: 5000 }
    )

    // Send pings to backend every 5 seconds
    pingIntervalRef.current = setInterval(async () => {
      if (driverLocation) {
        try {
          await api('POST', '/drivers/location', driverLocation, auth.token)
        } catch {}
      }
    }, 5000)

    setLiveTracking(true)
  }, [auth.token, driverLocation])

  const stopLiveTracking = useCallback(() => {
    if (watchIdRef.current !== null) {
      navigator.geolocation.clearWatch(watchIdRef.current)
      watchIdRef.current = null
    }
    if (pingIntervalRef.current) {
      clearInterval(pingIntervalRef.current)
      pingIntervalRef.current = null
    }
    setLiveTracking(false)
  }, [])

  // Cleanup on unmount
  useEffect(() => () => { stopLiveTracking() }, [])

  // Manual location update (drag pin on map)
  const handleManualLocation = useCallback(async (lat, lng) => {
    setDriverLocation({ lat, lng })
    try {
      await api('POST', '/drivers/location', { lat, lng }, auth.token)
    } catch {}
  }, [auth.token])

  // Use current location button
  const useCurrentLocation = () => {
    navigator.geolocation?.getCurrentPosition(
      (pos) => {
        const loc = { lat: pos.coords.latitude, lng: pos.coords.longitude }
        setDriverLocation(loc)
        handleManualLocation(loc.lat, loc.lng)
      },
      () => setError('Could not get location'),
      { enableHighAccuracy: true }
    )
  }

  const submitBattery = async () => {
    if (!soc) return
    setLoading('battery'); setError('')
    try {
      await api('POST', '/drivers/battery-log', { soc: Number(soc) }, auth.token)
      setSoc(''); await fetchShift()
    } catch (e) { setError(e.message) }
    setLoading('')
  }

  const goOnline = async () => {
    setLoading('online'); setError('')
    try {
      await api('POST', '/drivers/online', {}, auth.token)
      await fetchShift()
    } catch (e) { setError(e.message) }
    setLoading('')
  }

  const goOffline = async () => {
    setLoading('offline'); setError('')
    try {
      await api('POST', '/drivers/offline', {}, auth.token)
      stopLiveTracking()
      await fetchShift()
    } catch (e) { setError(e.message) }
    setLoading('')
  }

  const progressRide = async (rideId, currentStatus) => {
    setLoading(rideId); setError('')
    try {
      await api('PATCH', `/rides/${rideId}/status`, { status: NEXT_STATUS[currentStatus] }, auth.token)
      await fetchShift()
    } catch (e) { setError(e.message) }
    setLoading('')
  }

  const startCharging = async () => {
    if (!soc) return
    setLoading('charge'); setError('')
    try {
      await api('POST', '/drivers/start-charging', { soc: Number(soc), chargerStation }, auth.token)
      setSoc(''); setChargerStation(''); stopLiveTracking(); await fetchShift()
    } catch (e) { setError(e.message) }
    setLoading('')
  }

  const endCharging = async () => {
    if (!soc) return
    setLoading('charge'); setError('')
    try {
      await api('POST', '/drivers/end-charging', { soc: Number(soc) }, auth.token)
      setSoc(''); await fetchShift()
    } catch (e) { setError(e.message) }
    setLoading('')
  }

  if (!shift) return <div className="min-h-screen flex items-center justify-center"><p className="text-muted-foreground">Loading shift...</p></div>

  const showMap = shift.state !== 'NO_VEHICLE' && shift.state !== 'NEEDS_PICKUP_LOG'

  // Fix: override state based on last log
  const lastLog = shift.todaysLogs?.[shift.todaysLogs.length - 1]
  const effectiveState = lastLog?.eventType === 'CHARGE_START' ? 'CHARGING' : shift.state

  return (
    <div className="min-h-screen bg-background">
      <header className="sticky top-0 z-50 border-b bg-card/80 backdrop-blur-sm">
        <div className="max-w-lg mx-auto flex items-center justify-between p-4">
          <div>
            <h1 className="font-bold text-lg">Breez Driver</h1>
            <p className="text-xs text-muted-foreground">{auth.user.name} · {auth.user.employeeId}</p>
          </div>
          <div className="flex items-center gap-2">
            {shift.vehicle && <Badge variant="outline" className="text-xs">{shift.vehicle.plateNumber}</Badge>}
            <Button variant="ghost" size="icon" onClick={logout}><LogOut className="h-4 w-4" /></Button>
          </div>
        </div>
      </header>

      <main className="max-w-lg mx-auto p-4 space-y-4">
        {error && <p className="text-sm text-destructive bg-destructive/10 p-3 rounded-lg">{error}</p>}

        {/* Status bar */}
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-2">
            <div className={`h-2.5 w-2.5 rounded-full ${shift.online ? 'bg-emerald-400 animate-pulse' : 'bg-muted-foreground/30'}`} />
            <span className="text-sm font-medium">{effectiveState.replace(/_/g, ' ')}</span>
          </div>
          {shift.todayCompletedCount > 0 && (
            <span className="text-xs text-muted-foreground">{shift.todayCompletedCount} rides today</span>
          )}
        </div>

        {/* Map */}
        {showMap && (
          <>
            <DriverMap
              activeRide={shift.activeRide}
              driverLocation={driverLocation}
              onLocationUpdate={handleManualLocation}
              token={auth.token}
              liveTracking={liveTracking}
            />
            {/* Location controls */}
            <div className="flex gap-2">
              <Button size="sm" variant={liveTracking ? 'default' : 'outline'} className="flex-1 text-xs gap-1"
                onClick={liveTracking ? stopLiveTracking : startLiveTracking}>
                <Radio className="h-3 w-3" />
                {liveTracking ? 'Live tracking on' : 'Start live tracking'}
              </Button>
              <Button size="sm" variant="outline" className="text-xs gap-1" onClick={useCurrentLocation}>
                <Crosshair className="h-3 w-3" /> Use current location
              </Button>
            </div>
            {!liveTracking && (
              <p className="text-[10px] text-muted-foreground text-center">Drag the green pin to set your location manually</p>
            )}
          </>
        )}

        {/* NO_VEHICLE */}
        {effectiveState === 'NO_VEHICLE' && (
          <Card className="border-destructive/30">
            <CardContent className="p-6 text-center space-y-2">
              <Navigation className="h-10 w-10 text-muted-foreground mx-auto opacity-30" />
              <p className="font-medium">No vehicle assigned</p>
              <p className="text-sm text-muted-foreground">Contact your admin to get assigned a vehicle</p>
            </CardContent>
          </Card>
        )}

        {/* NEEDS_PICKUP_LOG */}
        {effectiveState === 'NEEDS_PICKUP_LOG' && (
          <Card className="border-amber-500/30">
            <CardHeader className="pb-2">
              <CardTitle className="text-base flex items-center gap-2">
                <Battery className="h-4 w-4 text-amber-400" /> Vehicle pickup — log battery
              </CardTitle>
            </CardHeader>
            <CardContent className="space-y-3">
              <p className="text-sm text-muted-foreground">
                {shift.vehicle.plateNumber} · {shift.vehicle.model}
                {shift.vehicle.parkingBay && ` · ${shift.vehicle.parkingBay}`}
              </p>
              <div>
                <label className="text-xs text-muted-foreground">Current SOC %</label>
                <Input type="number" placeholder="e.g. 85" value={soc} onChange={e => setSoc(e.target.value)} min="0" max="100" className="mt-1" />
              </div>
              <Button className="w-full" onClick={submitBattery} disabled={loading === 'battery' || !soc}>
                {loading === 'battery' ? 'Logging...' : 'Log battery & start shift'}
              </Button>
            </CardContent>
          </Card>
        )}

        {/* NEEDS_POSTRIDE_LOG */}
        {effectiveState === 'NEEDS_POSTRIDE_LOG' && (
          <Card className="border-amber-500/30">
            <CardHeader className="pb-2">
              <CardTitle className="text-base flex items-center gap-2">
                <Battery className="h-4 w-4 text-amber-400" /> Post-ride — log battery
              </CardTitle>
            </CardHeader>
            <CardContent className="space-y-3">
              <p className="text-sm text-muted-foreground">Log current SOC before your next assignment</p>
              <Input type="number" placeholder="Current SOC %" value={soc} onChange={e => setSoc(e.target.value)} min="0" max="100" />
              <Button className="w-full" onClick={submitBattery} disabled={loading === 'battery' || !soc}>
                {loading === 'battery' ? 'Logging...' : 'Log battery'}
              </Button>
            </CardContent>
          </Card>
        )}

        {/* CHARGING */}
        {effectiveState === 'CHARGING' && (
          <Card className="border-blue-500/30">
            <CardHeader className="pb-2">
              <CardTitle className="text-base flex items-center gap-2">
                <Zap className="h-4 w-4 text-blue-400" /> Charging in progress
              </CardTitle>
            </CardHeader>
            <CardContent className="space-y-3">
              <p className="text-sm text-muted-foreground">Enter SOC when charging is complete</p>
              <Input type="number" placeholder="SOC % after charge" value={soc} onChange={e => setSoc(e.target.value)} min="0" max="100" />
              <Button className="w-full" onClick={endCharging} disabled={loading === 'charge' || !soc}>
                {loading === 'charge' ? 'Logging...' : 'End charging'}
              </Button>
            </CardContent>
          </Card>
        )}

        {/* ONLINE/OFFLINE controls */}
        {(effectiveState === 'ONLINE' || effectiveState === 'OFFLINE') && (
          <>
            <div className="flex gap-2">
              {shift.state === 'OFFLINE' ? (
                <Button className="flex-1" onClick={goOnline} disabled={loading === 'online'}>
                  <Power className="h-4 w-4 mr-2" /> Go online
                </Button>
              ) : (
                <Button variant="outline" className="flex-1" onClick={goOffline} disabled={loading === 'offline'}>
                  <Power className="h-4 w-4 mr-2" /> Go offline
                </Button>
              )}
              {effectiveState !== 'CHARGING' && (
                <Button variant="secondary" className="flex-1" onClick={() => {
                  if (soc) startCharging(); else setError('Enter SOC before starting charge')
                }} disabled={loading === 'charge'}>
                  <Plug className="h-4 w-4 mr-2" /> Start charging
                </Button>
              )}
            </div>

            {effectiveState === 'ONLINE' && (
              <div className="flex gap-2">
                <Input type="number" placeholder="SOC % (for charging)" value={soc}
                  onChange={e => setSoc(e.target.value)} min="0" max="100" className="flex-1" />
                <Input placeholder="Charger station" value={chargerStation}
                  onChange={e => setChargerStation(e.target.value)} className="flex-1" />
              </div>
            )}

            {effectiveState === 'ONLINE' && shift.pendingAssignments === 0 && !shift.activeRide && (
              <div className="text-center py-6">
                <div className="h-3 w-3 rounded-full bg-emerald-400 animate-pulse mx-auto mb-3" />
                <p className="text-sm text-muted-foreground">Online — waiting for dispatch</p>
              </div>
            )}
          </>
        )}

        {/* Active ride card */}
        {shift.activeRide && (
          <Card className={shift.activeRide.status === 'IN_PROGRESS' ? 'border-primary/40' : ''}>
            <CardContent className="p-4 space-y-3">
              <div className="flex items-center justify-between">
                <Badge variant={STATUS_COLOR[shift.activeRide.status]}>
                  {shift.activeRide.status.replace('_', ' ')}
                </Badge>
                <span className="text-sm font-medium">₹{(shift.activeRide.fare / 100).toFixed(0)}</span>
              </div>
              <div className="space-y-1.5">
                <div className="flex items-start gap-2 text-sm">
                  <MapPin className="h-3.5 w-3.5 mt-0.5 text-emerald-400 shrink-0" />
                  <span>{shift.activeRide.pickupAddress}</span>
                </div>
                <div className="flex items-start gap-2 text-sm">
                  <MapPin className="h-3.5 w-3.5 mt-0.5 text-red-400 shrink-0" />
                  <span>{shift.activeRide.dropAddress}</span>
                </div>
              </div>
              <div className="text-sm text-muted-foreground">
                {shift.activeRide.passenger?.name} · {shift.activeRide.passenger?.phone}
              </div>
              {NEXT_STATUS[shift.activeRide.status] && (
                <Button className="w-full" onClick={() => progressRide(shift.activeRide.id, shift.activeRide.status)}
                  disabled={loading === shift.activeRide.id}>
                  {loading === shift.activeRide.id ? 'Updating...' : NEXT_LABEL[shift.activeRide.status]}
                  <ChevronRight className="h-4 w-4 ml-1" />
                </Button>
              )}
            </CardContent>
          </Card>
        )}

        {/* Today's battery log */}
        {shift.todaysLogs?.length > 0 && (
          <div>
            <h2 className="text-xs font-medium text-muted-foreground mb-2 uppercase tracking-wider">Today's battery log</h2>
            <div className="space-y-1">
              {shift.todaysLogs.map(log => (
                <div key={log.id} className="flex items-center gap-3 text-sm py-1.5">
                  <div className="h-6 w-6 rounded-full bg-accent flex items-center justify-center">
                    <CheckCircle2 className="h-3.5 w-3.5 text-emerald-400" />
                  </div>
                  <div className="flex-1">
                    <span className="font-medium">{log.eventType.replace(/_/g, ' ')}</span>
                    <span className="text-muted-foreground ml-2">SOC {log.soc}%</span>
                  </div>
                  <span className="text-xs text-muted-foreground">
                    {new Date(log.createdAt).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
                  </span>
                </div>
              ))}
            </div>
          </div>
        )}

        {/* Vehicle info */}
        {shift.vehicle && (
          <Card>
            <CardContent className="p-3 flex items-center justify-between">
              <div>
                <p className="text-sm font-medium">{shift.vehicle.plateNumber}</p>
                <p className="text-xs text-muted-foreground">{shift.vehicle.model}</p>
              </div>
              <div className="text-right">
                <p className="text-sm font-medium">{shift.vehicle.currentSoc ?? '—'}%</p>
                <div className="h-1.5 w-16 bg-accent rounded-full overflow-hidden mt-1">
                  <div className={`h-full rounded-full ${(shift.vehicle.currentSoc || 0) > 50 ? 'bg-emerald-500' : (shift.vehicle.currentSoc || 0) > 20 ? 'bg-amber-500' : 'bg-red-500'}`}
                    style={{ width: `${shift.vehicle.currentSoc || 0}%` }} />
                </div>
              </div>
            </CardContent>
          </Card>
        )}
      </main>
    </div>
  )
}