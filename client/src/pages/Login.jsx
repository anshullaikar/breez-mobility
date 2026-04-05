import { useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { useAuth } from '@/lib/auth'
import { api } from '@/lib/api'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Card, CardHeader, CardTitle, CardDescription, CardContent } from '@/components/ui/card'
import { User, Truck, Shield } from 'lucide-react'

export default function LoginPage() {
  const [role, setRole] = useState(null)
  const [phone, setPhone] = useState('')
  const [otp, setOtp] = useState('')
  const [otpSent, setOtpSent] = useState(false)
  const [name, setName] = useState('')
  const [employeeId, setEmployeeId] = useState('')
  const [pin, setPin] = useState('')
  const [error, setError] = useState('')
  const [loading, setLoading] = useState(false)
  const { login, sendOtp } = useAuth()
  const navigate = useNavigate()

  const handleSendOtp = async () => {
    setLoading(true); setError('')
    try {
      const res = await sendOtp(phone)
      setOtpSent(true)
      if (res.code) setOtp(res.code) // dev mode auto-fill
    } catch (e) { setError(e.message) }
    setLoading(false)
  }

  const handleLogin = async () => {
    setLoading(true); setError('')
    try {
      if (role === 'passenger') {
        await login('passenger', { phone, code: otp, name: name || undefined })
        navigate('/passenger')
      } else if (role === 'driver') {
        await login('driver', { employeeId, pin })
        navigate('/driver')
      } else if (role === 'admin') {
        await login('admin', { phone, pin })
        navigate('/admin')
      }
    } catch (e) { setError(e.message) }
    setLoading(false)
  }

  if (!role) {
    return (
      <div className="min-h-screen flex items-center justify-center p-4">
        <div className="w-full max-w-md space-y-6">
          <div className="text-center space-y-2">
            <h1 className="text-3xl font-bold tracking-tight">Breez</h1>
            <p className="text-muted-foreground">Pre-scheduled EV rides</p>
          </div>
          <div className="space-y-3">
            {[
              { id: 'passenger', icon: User, label: 'Passenger', desc: 'Book a ride' },
              { id: 'driver', icon: Truck, label: 'Driver', desc: 'Manage your shift' },
              { id: 'admin', icon: Shield, label: 'Admin', desc: 'Dispatch & fleet' },
            ].map(r => (
              <Card key={r.id} className="cursor-pointer hover:bg-accent/50 transition-colors" onClick={() => setRole(r.id)}>
                <CardContent className="flex items-center gap-4 p-4">
                  <div className="h-10 w-10 rounded-lg bg-primary/10 flex items-center justify-center">
                    <r.icon className="h-5 w-5 text-primary" />
                  </div>
                  <div>
                    <p className="font-medium">{r.label}</p>
                    <p className="text-sm text-muted-foreground">{r.desc}</p>
                  </div>
                </CardContent>
              </Card>
            ))}
          </div>
        </div>
      </div>
    )
  }

  return (
    <div className="min-h-screen flex items-center justify-center p-4">
      <Card className="w-full max-w-sm">
        <CardHeader>
          <CardTitle>{role === 'passenger' ? 'Passenger login' : role === 'driver' ? 'Driver login' : 'Admin login'}</CardTitle>
          <CardDescription>
            <button onClick={() => { setRole(null); setError('') }} className="text-primary hover:underline text-xs">
              ← Change role
            </button>
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          {error && <p className="text-sm text-destructive bg-destructive/10 p-2 rounded">{error}</p>}

          {role === 'passenger' && (
            <>
              <Input placeholder="Phone (+91...)" value={phone} onChange={e => setPhone(e.target.value)} />
              {!otpSent ? (
                <Button className="w-full" onClick={handleSendOtp} disabled={loading || !phone}>
                  {loading ? 'Sending...' : 'Send OTP'}
                </Button>
              ) : (
                <>
                  <Input placeholder="OTP code" value={otp} onChange={e => setOtp(e.target.value)} />
                  <Input placeholder="Name (first time only)" value={name} onChange={e => setName(e.target.value)} />
                  <Button className="w-full" onClick={handleLogin} disabled={loading || !otp}>
                    {loading ? 'Verifying...' : 'Verify & login'}
                  </Button>
                </>
              )}
            </>
          )}

          {role === 'driver' && (
            <>
              <Input placeholder="Employee ID (e.g. BRZ0001)" value={employeeId} onChange={e => setEmployeeId(e.target.value)} />
              <Input placeholder="PIN" type="password" value={pin} onChange={e => setPin(e.target.value)} />
              <Button className="w-full" onClick={handleLogin} disabled={loading}>
                {loading ? 'Logging in...' : 'Login'}
              </Button>
            </>
          )}

          {role === 'admin' && (
            <>
              <Input placeholder="Phone (+919999000001)" value={phone} onChange={e => setPhone(e.target.value)} />
              <Input placeholder="PIN" type="password" value={pin} onChange={e => setPin(e.target.value)} />
              <Button className="w-full" onClick={handleLogin} disabled={loading}>
                {loading ? 'Logging in...' : 'Login'}
              </Button>
            </>
          )}
        </CardContent>
      </Card>
    </div>
  )
}
