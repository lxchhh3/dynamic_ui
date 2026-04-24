import { useAuth } from './stores/authStore'
import Login from './views/Login'
import Home from './views/Home'

export default function App() {
  const token = useAuth((s) => s.token)
  return token ? <Home /> : <Login />
}
