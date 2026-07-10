import { defineConfig } from "vite"
import react from "@vitejs/plugin-react"
import tailwindcss from "@tailwindcss/vite"

const API_TARGET = "http://127.0.0.1:8000"

// GLR's routers are served under /api/staff/* on the Django backend, so the dev
// proxy prepends that prefix (mirrors the production vercel.json rewrites, which
// map each prefix -> /api/staff/<prefix>). Without this, /auth/login etc. hit
// Django unprefixed and 404.
const toStaff = (path) => "/api/staff" + path
const staffProxy = { target: API_TARGET, changeOrigin: true, rewrite: toStaff }

export default defineConfig({
  plugins: [react(), tailwindcss()],
  server: {
    // Proxy all API routes through Vite so cookies are same-origin (localhost:5173),
    // preventing SameSite cookie blocking in development. Keys keep their exact
    // (trailing-slash) shape so SPA page routes like /attendance are not hijacked.
    proxy: {
      "/auth":                  staffProxy,
      "/dashboard/admin-stats": staffProxy,
      "/employees/":            staffProxy,
      "/attendance/":           staffProxy,
      "/face":                  staffProxy,
      "/locations":             staffProxy,
      "/export":                staffProxy,
      "/company":               staffProxy,
      "/leave/":                staffProxy,
      "/payroll":               staffProxy,
      "/kpi":                   staffProxy,
    }
  }
})
