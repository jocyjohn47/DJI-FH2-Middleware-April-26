import axios from 'axios'

// Base URL: in dev, Vite proxies /admin → FastAPI:8000
// In production (served by FastAPI), same origin.
export const apiClient = axios.create({
  baseURL: '/',
  headers: { 'Content-Type': 'application/json' },
  timeout: 15_000,
})

// Inject X-Admin-Token from localStorage if present
apiClient.interceptors.request.use((config) => {
  const token = localStorage.getItem('admin_token')
  if (token) config.headers['X-Admin-Token'] = token
  return config
})

// Normalise error shape
apiClient.interceptors.response.use(
  (r) => r,
  (err) => {
    const msg: string =
      err?.response?.data?.detail ??
      err?.response?.data?.message ??
      err?.message ??
      'Unknown error'
    return Promise.reject(new Error(msg))
  },
)
