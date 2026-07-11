import { useEffect, useState, useCallback } from "react"
import AdminLayout from "../layouts/AdminLayout"
import { getEmployees } from "../services/employeeService"
import { getEmployeeKras, createKra, updateKra, archiveKra } from "../services/kraKpiService"
import { getApiErrorMessage } from "../api/axios"

const inputClass = "w-full rounded-lg border border-gray-300 px-3 py-2.5 text-sm text-gray-900 outline-none transition focus:border-emerald-500 focus:ring-4 focus:ring-emerald-100"
const labelClass = "mb-1.5 block text-xs font-semibold text-gray-600"

function KraFormModal({ initial, onSubmit, onClose }) {
  const editing = Boolean(initial?.id)
  const [form, setForm] = useState({
    title: initial?.title || "",
    category: initial?.category || "",
    outcome_description: initial?.outcome_description || "",
    start_date: initial?.start_date || "",
    due_date: initial?.due_date || "",
  })
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState("")
  const set = (key) => (e) => setForm((prev) => ({ ...prev, [key]: e.target.value }))

  useEffect(() => {
    const handleEscape = (event) => { if (event.key === "Escape" && !loading) onClose() }
    window.addEventListener("keydown", handleEscape)
    return () => window.removeEventListener("keydown", handleEscape)
  }, [loading, onClose])

  const handleSubmit = async (e) => {
    e.preventDefault()
    setLoading(true)
    setError("")
    const payload = { ...form }
    if (!payload.start_date) delete payload.start_date
    if (!payload.due_date) delete payload.due_date
    try {
      await onSubmit(payload)
    } catch (err) {
      setError(getApiErrorMessage(err, "Failed to save KRA"))
    } finally {
      setLoading(false)
    }
  }

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 px-4 backdrop-blur-sm"
      onMouseDown={(event) => { if (event.target === event.currentTarget && !loading) onClose() }}
    >
      <div className="w-full max-w-md rounded-2xl border border-gray-200 bg-white p-6 shadow-xl">
        <div className="mb-6 flex items-center justify-between">
          <h3 className="text-lg font-bold text-gray-950">{editing ? "Edit KRA" : "Add KRA"}</h3>
          <button onClick={onClose} className="rounded-lg p-1.5 text-gray-400 hover:bg-gray-100 hover:text-gray-600">
            <svg className="h-5 w-5" fill="none" stroke="currentColor" strokeWidth={2} viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" />
            </svg>
          </button>
        </div>
        <form onSubmit={handleSubmit} className="space-y-4">
          <div>
            <label className={labelClass}>Title *</label>
            <input value={form.title} onChange={set("title")} required placeholder="e.g. Client Onboarding" className={inputClass} />
          </div>
          <div>
            <label className={labelClass}>Category</label>
            <input value={form.category} onChange={set("category")} placeholder="e.g. Delivery" className={inputClass} />
          </div>
          <div>
            <label className={labelClass}>Outcome description</label>
            <textarea value={form.outcome_description} onChange={set("outcome_description")} rows={3} placeholder="What good looks like for this result area" className={inputClass} />
          </div>
          <div className="grid grid-cols-2 gap-4">
            <div>
              <label className={labelClass}>Start date</label>
              <input type="date" value={form.start_date} onChange={set("start_date")} className={inputClass} />
            </div>
            <div>
              <label className={labelClass}>Due date</label>
              <input type="date" value={form.due_date} onChange={set("due_date")} className={inputClass} />
            </div>
          </div>
          {error && <p className="rounded-lg border border-red-200 bg-red-50 px-3 py-2.5 text-xs font-medium text-red-700">{error}</p>}
          <div className="flex gap-3 pt-2">
            <button type="button" onClick={onClose} disabled={loading} className="flex-1 rounded-lg border border-gray-300 bg-white px-4 py-2.5 text-sm font-semibold text-gray-700 transition hover:bg-gray-50">Cancel</button>
            <button type="submit" disabled={loading} className="flex-1 rounded-lg bg-emerald-600 px-4 py-2.5 text-sm font-semibold text-white transition hover:bg-emerald-700 disabled:bg-emerald-300">
              {loading ? "Saving…" : editing ? "Save changes" : "Add KRA"}
            </button>
          </div>
        </form>
      </div>
    </div>
  )
}

function ManageKrasPage() {
  const [employees, setEmployees] = useState([])
  const [employeeId, setEmployeeId] = useState("")
  const [kras, setKras] = useState([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState("")
  const [kraModal, setKraModal] = useState(null) // { initial } | null

  useEffect(() => {
    getEmployees()
      .then((data) => {
        setEmployees(data)
        if (data.length > 0) setEmployeeId(data[0].id)
      })
      .catch((err) => setError(getApiErrorMessage(err, "Failed to load employees")))
  }, [])

  const loadKras = useCallback(() => {
    if (!employeeId) return
    setLoading(true)
    getEmployeeKras(employeeId)
      .then((data) => { setKras(data); setError("") })
      .catch((err) => setError(getApiErrorMessage(err, "Failed to load KRAs")))
      .finally(() => setLoading(false))
  }, [employeeId])

  useEffect(() => { loadKras() }, [loadKras])

  const submitKra = async (payload) => {
    if (kraModal.initial?.id) await updateKra(kraModal.initial.id, payload)
    else await createKra(employeeId, payload)
    setKraModal(null)
    loadKras()
  }

  const onArchiveKra = async (kra) => {
    if (!window.confirm(`Archive KRA "${kra.title}"? This hides it from the employee.`)) return
    try { await archiveKra(kra.id); loadKras() } catch (err) { alert(getApiErrorMessage(err, "Failed to archive KRA")) }
  }

  return (
    <AdminLayout>
      {kraModal && <KraFormModal initial={kraModal.initial} onSubmit={submitKra} onClose={() => setKraModal(null)} />}

      <div className="space-y-5">
        <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
          <div>
            <h2 className="text-2xl font-bold text-gray-950">KRAs</h2>
            <p className="mt-1 text-sm text-gray-500">Assign result areas (goals) to your team. Employees write their own daily work reports against them from their login.</p>
          </div>
          <button
            onClick={() => setKraModal({ initial: null })}
            disabled={!employeeId}
            className="inline-flex items-center gap-2 rounded-lg bg-emerald-600 px-4 py-2.5 text-sm font-semibold text-white transition hover:bg-emerald-700 disabled:bg-emerald-300"
          >
            <svg className="h-4 w-4" fill="none" stroke="currentColor" strokeWidth={2.5} viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" d="M12 4v16m8-8H4" />
            </svg>
            Add KRA
          </button>
        </div>

        <div className="rounded-lg border border-gray-200 bg-white p-4 shadow-sm">
          <label className={labelClass}>Employee</label>
          <select value={employeeId} onChange={(e) => setEmployeeId(e.target.value)} className={`${inputClass} max-w-sm`}>
            {employees.map((emp) => (
              <option key={emp.id} value={emp.id}>{emp.name} ({emp.employee_id})</option>
            ))}
          </select>
        </div>

        {loading && <p className="text-sm text-gray-400">Loading KRAs…</p>}
        {error && !loading && (
          <p className="rounded-lg border border-red-200 bg-red-50 px-4 py-3 font-medium text-red-700">{error}</p>
        )}

        {!loading && !error && kras.length === 0 && (
          <div className="rounded-lg border border-dashed border-gray-300 bg-white p-10 text-center text-sm text-gray-400">
            No KRAs yet. Add a result area for this employee to work toward.
          </div>
        )}

        {!loading && !error && kras.map((kra) => (
          <div key={kra.id} className="rounded-2xl border border-gray-200 bg-white p-5 shadow-sm">
            <div className="flex items-start justify-between gap-3">
              <div>
                <h3 className="text-base font-bold text-gray-950">{kra.title}</h3>
                {kra.category && (
                  <span className="mt-1 inline-flex rounded-full bg-violet-50 px-3 py-1 text-xs font-semibold text-violet-700">{kra.category}</span>
                )}
                {kra.outcome_description && <p className="mt-2 max-w-xl text-sm text-gray-500">{kra.outcome_description}</p>}
              </div>
              <div className="flex flex-shrink-0 gap-1.5">
                <button title="Edit KRA" onClick={() => setKraModal({ initial: kra })} className="rounded-lg p-2 text-gray-400 hover:bg-gray-100 hover:text-gray-600">
                  <svg className="h-4 w-4" fill="none" stroke="currentColor" strokeWidth={2} viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" d="M15.232 5.232l3.536 3.536m-2.036-5.036a2.5 2.5 0 113.536 3.536L6.5 21.036H3v-3.572L16.732 3.732z" />
                  </svg>
                </button>
                <button title="Archive KRA" onClick={() => onArchiveKra(kra)} className="rounded-lg p-2 text-red-400 hover:bg-red-50 hover:text-red-600">
                  <svg className="h-4 w-4" fill="none" stroke="currentColor" strokeWidth={2} viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16" />
                  </svg>
                </button>
              </div>
            </div>
          </div>
        ))}
      </div>
    </AdminLayout>
  )
}

export default ManageKrasPage
