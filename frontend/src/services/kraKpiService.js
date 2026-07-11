import api from "../api/axios"

export const getEmployeeKras = async (employeeId) => {
  const response = await api.get(`/kpi/employees/${employeeId}/kras/`)
  return response.data.kras
}

export const createKra = async (employeeId, payload) => {
  const response = await api.post(`/kpi/employees/${employeeId}/kras/`, payload)
  return response.data
}

export const updateKra = async (kraId, payload) => {
  const response = await api.patch(`/kpi/kras/${kraId}/`, payload)
  return response.data
}

export const archiveKra = async (kraId) => {
  const response = await api.delete(`/kpi/kras/${kraId}/`)
  return response.data
}

export const createKpi = async (kraId, payload) => {
  const response = await api.post(`/kpi/kras/${kraId}/kpis/`, payload)
  return response.data
}

export const updateKpi = async (kpiId, payload) => {
  const response = await api.patch(`/kpi/kpis/${kpiId}/`, payload)
  return response.data
}

export const archiveKpi = async (kpiId) => {
  const response = await api.delete(`/kpi/kpis/${kpiId}/`)
  return response.data
}
