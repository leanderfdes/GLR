import api from "../api/axios"

// KPI endpoints live on the Django backend, reached via the /kpi/* Vercel
// rewrite (see vercel.json). Same cookie session as the rest of the app.
export const getMyKras = async () => {
  const response = await api.get("/kpi/my-kras/")
  return response.data
}

export const getTodayKpi = async (date) => {
  const response = await api.get(`/kpi/today/${date ? `?date=${date}` : ""}`)
  return response.data
}

export const submitTodayKpi = async (payload) => {
  const response = await api.post("/kpi/today/", payload)
  return response.data
}

export const getKpiHistory = async (limit) => {
  const response = await api.get(`/kpi/history/${limit ? `?limit=${limit}` : ""}`)
  return response.data
}
