import { useEffect, useState, useCallback } from "react"
import EmployeeLayout from "../../layouts/EmployeeLayout"
import { getApiErrorMessage } from "../../api/axios"
import { getTodayKpi, submitTodayKpi, getKpiHistory } from "../../services/kpiService"

function groupByKra(items) {
  const map = new Map()
  for (const it of items) {
    if (!map.has(it.kra_id)) map.set(it.kra_id, { kra_id: it.kra_id, kra_title: it.kra_title, items: [] })
    map.get(it.kra_id).items.push(it)
  }
  return Array.from(map.values())
}

function buildValues(items) {
  const v = {}
  for (const it of items) {
    v[it.kpi_id] = {
      actual_value: it.actual_value ?? "",
      note: it.note || "",
      blockers: it.blockers || "",
      next_step: it.next_step || "",
    }
  }
  return v
}

function formatDate(iso) {
  if (!iso) return ""
  try {
    return new Date(iso).toLocaleDateString("en-GB", { day: "2-digit", month: "short", year: "numeric" })
  } catch { return iso }
}

function MyKpisPage() {
  const [today, setToday] = useState(null)
  const [summary, setSummary] = useState("")
  const [values, setValues] = useState({})
  const [history, setHistory] = useState([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState("")
  const [saving, setSaving] = useState(false)
  const [saveMsg, setSaveMsg] = useState("")

  const hydrate = useCallback((day) => {
    setToday(day)
    setSummary(day.summary || "")
    setValues(buildValues(day.items || []))
  }, [])

  const load = useCallback(async () => {
    setLoading(true)
    setError("")
    try {
      const [day, hist] = await Promise.all([getTodayKpi(), getKpiHistory(30)])
      hydrate(day)
      setHistory(hist.history || [])
    } catch (err) {
      setError(getApiErrorMessage(err, "Failed to load your KPIs"))
    } finally {
      setLoading(false)
    }
  }, [hydrate])

  useEffect(() => { load() }, [load])

  const setField = (kpiId, field, val) => {
    setValues((prev) => ({ ...prev, [kpiId]: { ...prev[kpiId], [field]: val } }))
    setSaveMsg("")
  }

  const handleSubmit = async (e) => {
    e.preventDefault()
    setSaving(true)
    setSaveMsg("")
    setError("")
    try {
      const items = (today.items || []).map((it) => {
        const v = values[it.kpi_id] || {}
        const raw = v.actual_value
        const actual_value = raw === "" || raw === null || raw === undefined ? null : Number(raw)
        return {
          kpi_id: it.kpi_id,
          actual_value: Number.isNaN(actual_value) ? null : actual_value,
          note: v.note || "",
          blockers: v.blockers || "",
          next_step: v.next_step || "",
        }
      })
      const result = await submitTodayKpi({ summary, items })
      hydrate(result)
      setSaveMsg("Saved ✓")
      const hist = await getKpiHistory(30)
      setHistory(hist.history || [])
    } catch (err) {
      setError(getApiErrorMessage(err, "Failed to save your update"))
    } finally {
      setSaving(false)
    }
  }

  const groups = groupByKra(today?.items || [])
  const hasKpis = groups.length > 0
  const alreadySubmitted = today?.submitted

  return (
    <EmployeeLayout>
      <div className="mx-auto max-w-md space-y-6">
        <div className="flex items-center justify-between">
          <h2 className="text-2xl font-bold text-gray-950">My KPIs</h2>
          {alreadySubmitted && (
            <span className="inline-flex rounded-full bg-emerald-100 px-3 py-1 text-xs font-bold text-emerald-800">
              Submitted today
            </span>
          )}
        </div>

        {loading && <p className="text-sm text-gray-500">Loading…</p>}
        {error && <p className="rounded-lg bg-red-50 p-3 text-sm text-red-600">{error}</p>}

        {!loading && !hasKpis && !error && (
          <div className="rounded-2xl border border-gray-200 bg-white p-6 text-center shadow-sm">
            <p className="text-sm font-semibold text-gray-700">No KPIs assigned yet</p>
            <p className="mt-1 text-xs text-gray-400">Your manager will assign KRAs and KPIs. They will appear here.</p>
          </div>
        )}

        {!loading && hasKpis && (
          <form onSubmit={handleSubmit} className="space-y-6">
            {/* Daily narrative */}
            <div className="rounded-2xl border border-gray-200 bg-white p-5 shadow-sm">
              <label className="text-sm font-bold text-gray-900">Today's work summary</label>
              <p className="mb-2 mt-0.5 text-xs text-gray-400">A short note on what you did today.</p>
              <textarea
                value={summary}
                onChange={(e) => { setSummary(e.target.value); setSaveMsg("") }}
                rows={3}
                placeholder="e.g. Onboarded 2 clients, followed up on 3 pending documents…"
                className="w-full resize-none rounded-lg border border-gray-300 p-2.5 text-sm outline-none focus:border-emerald-500"
              />
            </div>

            {/* Per-KRA KPI inputs */}
            {groups.map((g) => (
              <div key={g.kra_id} className="rounded-2xl border border-gray-200 bg-white p-5 shadow-sm">
                <h3 className="text-base font-bold text-gray-900">{g.kra_title}</h3>
                <div className="mt-3 space-y-5">
                  {g.items.map((it) => (
                    <div key={it.kpi_id} className="border-t border-gray-100 pt-4 first:border-t-0 first:pt-0">
                      <div className="flex items-baseline justify-between gap-2">
                        <p className="text-sm font-semibold text-gray-800">{it.kpi_name}</p>
                        {it.target_value != null && (
                          <span className="text-xs font-medium text-gray-400">
                            Target {it.target_value}{it.unit ? ` ${it.unit}` : ""}
                          </span>
                        )}
                      </div>

                      <div className="mt-2">
                        <label className="text-xs font-semibold text-gray-600">
                          {it.metric_type === "boolean" ? "Done?" : `Actual value${it.unit ? ` (${it.unit})` : ""}`}
                        </label>
                        {it.metric_type === "boolean" ? (
                          <select
                            value={String(values[it.kpi_id]?.actual_value ?? "")}
                            onChange={(e) => setField(it.kpi_id, "actual_value", e.target.value)}
                            className="mt-1 w-full rounded-lg border border-gray-300 p-2.5 text-sm outline-none focus:border-emerald-500"
                          >
                            <option value="">—</option>
                            <option value="1">Yes</option>
                            <option value="0">No</option>
                          </select>
                        ) : (
                          <input
                            type="number"
                            step="any"
                            inputMode="decimal"
                            value={values[it.kpi_id]?.actual_value ?? ""}
                            onChange={(e) => setField(it.kpi_id, "actual_value", e.target.value)}
                            placeholder="0"
                            className="mt-1 w-full rounded-lg border border-gray-300 p-2.5 text-sm outline-none focus:border-emerald-500"
                          />
                        )}
                      </div>

                      <div className="mt-2">
                        <input
                          type="text"
                          value={values[it.kpi_id]?.note ?? ""}
                          onChange={(e) => setField(it.kpi_id, "note", e.target.value)}
                          placeholder="What you did (optional)"
                          className="w-full rounded-lg border border-gray-300 p-2.5 text-sm outline-none focus:border-emerald-500"
                        />
                      </div>
                      <div className="mt-2 grid grid-cols-2 gap-2">
                        <input
                          type="text"
                          value={values[it.kpi_id]?.blockers ?? ""}
                          onChange={(e) => setField(it.kpi_id, "blockers", e.target.value)}
                          placeholder="Blocker (optional)"
                          className="w-full rounded-lg border border-gray-300 p-2.5 text-xs outline-none focus:border-emerald-500"
                        />
                        <input
                          type="text"
                          value={values[it.kpi_id]?.next_step ?? ""}
                          onChange={(e) => setField(it.kpi_id, "next_step", e.target.value)}
                          placeholder="Next step (optional)"
                          className="w-full rounded-lg border border-gray-300 p-2.5 text-xs outline-none focus:border-emerald-500"
                        />
                      </div>
                    </div>
                  ))}
                </div>
              </div>
            ))}

            <div className="sticky bottom-16 space-y-2">
              {saveMsg && <p className="text-center text-sm font-semibold text-emerald-600">{saveMsg}</p>}
              <button
                type="submit"
                disabled={saving}
                className="w-full rounded-xl bg-emerald-600 py-4 text-base font-bold text-white shadow-md transition hover:bg-emerald-700 active:scale-95 disabled:bg-emerald-300"
              >
                {saving ? "Saving…" : alreadySubmitted ? "Update today's report" : "Submit today's report"}
              </button>
              <p className="text-center text-[11px] text-gray-400">You can edit today's report anytime.</p>
            </div>
          </form>
        )}

        {/* History */}
        {!loading && history.length > 0 && (
          <div className="space-y-3">
            <h3 className="text-lg font-bold text-gray-900">Recent reports</h3>
            {history.map((h) => (
              <div key={h.work_date} className="rounded-xl border border-gray-200 bg-white p-4 shadow-sm">
                <div className="flex items-center justify-between">
                  <p className="text-sm font-bold text-gray-900">{formatDate(h.work_date)}</p>
                  <span className="text-xs font-medium text-gray-400">{h.kpi_updates} KPI{h.kpi_updates === 1 ? "" : "s"}</span>
                </div>
                {h.summary && <p className="mt-1.5 text-sm text-gray-600">{h.summary}</p>}
              </div>
            ))}
          </div>
        )}
      </div>
    </EmployeeLayout>
  )
}

export default MyKpisPage
