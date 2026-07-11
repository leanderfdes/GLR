import { useEffect, useState, useCallback } from "react"
import DOMPurify from "dompurify"
import EmployeeLayout from "../../layouts/EmployeeLayout"
import { getApiErrorMessage } from "../../api/axios"
import { getTodayKpi, submitTodayKpi, getKpiHistory } from "../../services/kpiService"
import RichTextEditor from "../../components/RichTextEditor"

// The summary is employee-authored HTML shown back here and in the admin panel,
// so it is always sanitized on render (allow only the tags the editor produces,
// strip every attribute) — no stored-XSS even if raw HTML is POSTed directly.
const SUMMARY_TAGS = ["b", "strong", "i", "em", "u", "h2", "ul", "ol", "li", "p", "br", "div", "span"]
const cleanSummary = (html) => DOMPurify.sanitize(html || "", { ALLOWED_TAGS: SUMMARY_TAGS, ALLOWED_ATTR: [] })
// Rich-text from the editor carries tags; older/plain summaries are bare text
// whose line breaks must be preserved (rendering them as HTML would collapse them).
const isRichText = (s) => /<(\/?(b|strong|i|em|u|h2|ul|ol|li|p|br|div|span))\b[^>]*>/i.test(s || "")

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

function formatDate(dateStr) {
  if (!dateStr) return ""
  try {
    return new Date(`${dateStr}T00:00:00`).toLocaleDateString("en-GB", { weekday: "short", day: "2-digit", month: "short", year: "numeric" })
  } catch { return dateStr }
}

function formatActualValue(it, raw) {
  if (it.metric_type === "boolean") {
    if (raw === 1 || raw === "1") return "Yes"
    if (raw === 0 || raw === "0") return "No"
    return "—"
  }
  if (raw === "" || raw === null || raw === undefined) return "—"
  return `${raw}${it.unit ? ` ${it.unit}` : ""}`
}

function todayDateStr() {
  const now = new Date()
  return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}-${String(now.getDate()).padStart(2, "0")}`
}

function MonthCalendar({ year, month, historyMap, selectedDate, todayStr, onSelectDate, onPrevMonth, onNextMonth }) {
  const firstDay = new Date(year, month - 1, 1).getDay()
  const totalDays = new Date(year, month, 0).getDate()
  const monthLabel = new Date(year, month - 1, 1).toLocaleDateString("en-GB", { month: "long", year: "numeric" })

  const cells = []
  for (let i = 0; i < firstDay; i++) cells.push(<div key={`empty-${i}`} className="h-10" />)
  for (let d = 1; d <= totalDays; d++) {
    const dateStr = `${year}-${String(month).padStart(2, "0")}-${String(d).padStart(2, "0")}`
    const hasEntry = historyMap.has(dateStr)
    const isToday = dateStr === todayStr
    const isSelected = dateStr === selectedDate
    cells.push(
      <button
        key={d}
        type="button"
        onClick={() => onSelectDate(dateStr)}
        className={`h-10 rounded-lg text-xs font-semibold transition
          ${isSelected ? "bg-emerald-600 text-white" : hasEntry ? "bg-emerald-50 text-emerald-700 hover:bg-emerald-100" : "text-gray-500 hover:bg-gray-50"}
          ${isToday && !isSelected ? "ring-2 ring-emerald-500" : ""}
        `}
      >
        {d}
      </button>
    )
  }

  return (
    <div className="rounded-2xl border border-gray-200 bg-white p-5 shadow-sm">
      <div className="mb-3 flex items-center justify-between">
        <button type="button" onClick={onPrevMonth} className="rounded-lg p-1.5 text-gray-500 hover:bg-gray-100" aria-label="Previous month">‹</button>
        <p className="text-sm font-bold text-gray-900">{monthLabel}</p>
        <button type="button" onClick={onNextMonth} className="rounded-lg p-1.5 text-gray-500 hover:bg-gray-100" aria-label="Next month">›</button>
      </div>
      <div className="mb-1 grid grid-cols-7 gap-1 text-center text-[10px] font-bold uppercase text-gray-400">
        {["S", "M", "T", "W", "T", "F", "S"].map((d, i) => <div key={i}>{d}</div>)}
      </div>
      <div className="grid grid-cols-7 gap-1">{cells}</div>
      <p className="mt-3 flex items-center gap-1.5 text-[10px] font-semibold uppercase text-gray-400">
        <span className="h-2.5 w-2.5 rounded-full bg-emerald-50 ring-1 ring-emerald-200" /> Report submitted
      </p>
    </div>
  )
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

  const now = new Date()
  const [calYear, setCalYear] = useState(now.getFullYear())
  const [calMonth, setCalMonth] = useState(now.getMonth() + 1)
  const [selectedDate, setSelectedDate] = useState(null)
  const [dayDetail, setDayDetail] = useState(null)
  const [dayDetailLoading, setDayDetailLoading] = useState(false)
  const [dayDetailError, setDayDetailError] = useState("")

  const hydrate = useCallback((day) => {
    setToday(day)
    setSummary(day.summary || "")
    setValues(buildValues(day.items || []))
  }, [])

  const load = useCallback(async () => {
    setLoading(true)
    setError("")
    try {
      const [day, hist] = await Promise.all([getTodayKpi(), getKpiHistory(180)])
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
      const hist = await getKpiHistory(180)
      setHistory(hist.history || [])
    } catch (err) {
      // Whatever went wrong (including "already submitted" if this page's
      // state was stale), resync from the server so the employee always
      // still sees their own data instead of getting stuck on a bare error.
      setError(getApiErrorMessage(err, "Failed to save your update"))
      load()
    } finally {
      setSaving(false)
    }
  }

  const groups = groupByKra(today?.items || [])
  const hasKpis = groups.length > 0
  const alreadySubmitted = today?.submitted
  const todayStr = today?.work_date || todayDateStr()
  const historyMap = new Map(history.map((h) => [h.work_date, h]))

  const selectDate = (dateStr) => {
    setSelectedDate((prev) => (prev === dateStr ? null : dateStr))
  }

  useEffect(() => {
    if (!selectedDate) { setDayDetail(null); setDayDetailError(""); return }
    setDayDetailLoading(true)
    setDayDetailError("")
    getTodayKpi(selectedDate)
      .then((data) => setDayDetail(data))
      .catch((err) => setDayDetailError(getApiErrorMessage(err, "Failed to load that day's report")))
      .finally(() => setDayDetailLoading(false))
  }, [selectedDate])

  const onPrevMonth = () => {
    setSelectedDate(null)
    setCalMonth((m) => { if (m === 1) { setCalYear((y) => y - 1); return 12 } return m - 1 })
  }
  const onNextMonth = () => {
    setSelectedDate(null)
    setCalMonth((m) => { if (m === 12) { setCalYear((y) => y + 1); return 1 } return m + 1 })
  }

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

        {/* Locked view — once submitted, the report is read-only for the rest
            of the day; there is no edit-after-submit. Always shown once
            loaded, independent of a stray submit error above. */}
        {!loading && alreadySubmitted && (
          <div className="space-y-6">
            <div className="rounded-2xl border border-gray-200 bg-white p-5 shadow-sm">
              <label className="text-sm font-bold text-gray-900">Today's work summary</label>
              <p className="mb-2 mt-0.5 text-xs text-gray-400">Submitted — no longer editable today.</p>
              {!summary && (
                <p className="rounded-lg border border-gray-100 bg-gray-50 p-2.5 text-sm text-gray-400">No summary written.</p>
              )}
              {summary && isRichText(summary) && (
                <div className="rte-display rounded-lg border border-gray-100 bg-gray-50 p-2.5 text-sm text-gray-800" dangerouslySetInnerHTML={{ __html: cleanSummary(summary) }} />
              )}
              {summary && !isRichText(summary) && (
                <div className="rte-display whitespace-pre-wrap rounded-lg border border-gray-100 bg-gray-50 p-2.5 text-sm text-gray-800">{summary}</div>
              )}
            </div>

            {hasKpis && groups.map((g) => (
              <div key={g.kra_id} className="rounded-2xl border border-gray-200 bg-white p-5 shadow-sm">
                <h3 className="text-base font-bold text-gray-900">{g.kra_title}</h3>
                <div className="mt-3 space-y-4">
                  {g.items.map((it) => {
                    const raw = values[it.kpi_id]?.actual_value
                    return (
                      <div key={it.kpi_id} className="border-t border-gray-100 pt-3 first:border-t-0 first:pt-0">
                        <div className="flex items-baseline justify-between gap-2">
                          <p className="text-sm font-semibold text-gray-800">{it.kpi_name}</p>
                          <p className="text-sm font-bold text-emerald-700">{formatActualValue(it, raw)}</p>
                        </div>
                        {values[it.kpi_id]?.note && <p className="mt-1 text-xs text-gray-500">{values[it.kpi_id].note}</p>}
                      </div>
                    )
                  })}
                </div>
              </div>
            ))}

            <p className="text-center text-xs text-gray-400">You've submitted today's report. Come back tomorrow to log a new one.</p>
          </div>
        )}

        {!loading && !alreadySubmitted && (
          <form onSubmit={handleSubmit} className="space-y-6">
            {/* Daily narrative — always writable, independent of whether any
                KPI has been defined yet. This is the employee's own daily
                report; KPI definitions below are optional structure on top. */}
            <div className="rounded-2xl border border-gray-200 bg-white p-5 shadow-sm">
              <label className="text-sm font-bold text-gray-900">Today's work summary</label>
              <p className="mb-2 mt-0.5 text-xs text-gray-400">A short note on what you did today. Use the toolbar to format.</p>
              <RichTextEditor
                initialHTML={summary}
                onChange={(html) => { setSummary(html); setSaveMsg("") }}
                placeholder="e.g. Onboarded 2 clients, followed up on 3 pending documents…"
              />
            </div>

            {/* Per-KRA KPI inputs, if any metrics have been defined for this employee */}
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
                {saving ? "Saving…" : "Submit today's report"}
              </button>
              <p className="text-center text-[11px] text-gray-400">You won't be able to edit this after submitting.</p>
            </div>
          </form>
        )}

        {/* Browse previous reports */}
        {!loading && (
          <div className="space-y-3">
            <h3 className="text-lg font-bold text-gray-900">Previous reports</h3>
            <MonthCalendar
              year={calYear}
              month={calMonth}
              historyMap={historyMap}
              selectedDate={selectedDate}
              todayStr={todayStr}
              onSelectDate={selectDate}
              onPrevMonth={onPrevMonth}
              onNextMonth={onNextMonth}
            />

            {selectedDate && (
              <div className="rounded-2xl border border-gray-200 bg-white p-5 shadow-sm">
                <div className="mb-3 flex items-center justify-between">
                  <h4 className="text-sm font-bold text-gray-900">{formatDate(selectedDate)}</h4>
                  <button type="button" onClick={() => setSelectedDate(null)} className="text-xs font-semibold text-gray-400 hover:text-gray-600">Close</button>
                </div>
                {dayDetailLoading && <p className="text-sm text-gray-400">Loading…</p>}
                {dayDetailError && <p className="text-sm text-red-600">{dayDetailError}</p>}
                {!dayDetailLoading && !dayDetailError && dayDetail && (
                  dayDetail.submitted ? (
                    <div className="space-y-3">
                      {!dayDetail.summary && <p className="text-sm text-gray-400">No summary written.</p>}
                      {dayDetail.summary && isRichText(dayDetail.summary) && (
                        <div className="rte-display text-sm text-gray-800" dangerouslySetInnerHTML={{ __html: cleanSummary(dayDetail.summary) }} />
                      )}
                      {dayDetail.summary && !isRichText(dayDetail.summary) && (
                        <div className="rte-display whitespace-pre-wrap text-sm text-gray-800">{dayDetail.summary}</div>
                      )}
                      {(dayDetail.items || []).length > 0 && (
                        <div className="space-y-2 border-t border-gray-100 pt-3">
                          {dayDetail.items.map((it) => (
                            <div key={it.kpi_id} className="flex items-baseline justify-between gap-2">
                              <span className="text-xs font-semibold text-gray-700">{it.kpi_name}</span>
                              <span className="text-xs font-bold text-emerald-700">{formatActualValue(it, it.actual_value)}</span>
                            </div>
                          ))}
                        </div>
                      )}
                    </div>
                  ) : (
                    <p className="text-sm text-gray-400">No report submitted this day.</p>
                  )
                )}
              </div>
            )}
          </div>
        )}
      </div>
    </EmployeeLayout>
  )
}

export default MyKpisPage
