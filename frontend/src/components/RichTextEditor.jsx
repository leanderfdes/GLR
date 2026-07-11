import { useRef, useEffect } from "react"

// Lightweight rich-text editor for the daily work summary — bold / italic /
// underline / subheading / bullet + numbered lists. Built on a contentEditable
// div + document.execCommand (no editor dependency). Output is HTML, always
// sanitized with DOMPurify wherever it is displayed (employee page + admin panel).
//
// Uncontrolled by design: the initial HTML is set once on mount and the DOM
// owns the content thereafter, so React never re-renders it mid-edit (which
// would jump the caret). Changes are lifted to the parent via onChange.

const exec = (cmd, value = null) => document.execCommand(cmd, false, value)

function TBtn({ title, onDo, children }) {
  return (
    <button
      type="button"
      title={title}
      // onMouseDown + preventDefault keeps the editor's text selection while clicking a toolbar button
      onMouseDown={(e) => { e.preventDefault(); onDo() }}
      className="flex h-8 min-w-8 items-center justify-center rounded-md px-2 text-sm text-gray-600 transition hover:bg-gray-200 hover:text-gray-900"
    >
      {children}
    </button>
  )
}

const Divider = () => <div className="mx-1 h-5 w-px bg-gray-300" />

export default function RichTextEditor({ initialHTML = "", onChange, placeholder = "" }) {
  const ref = useRef(null)

  useEffect(() => {
    // Force tag-based output (<b>/<i>/<u>) instead of inline styles, so the
    // sanitizer can strip all attributes without losing formatting.
    try { document.execCommand("styleWithCSS", false, false) } catch { /* older browsers */ }
    if (ref.current && ref.current.innerHTML === "" && initialHTML) {
      ref.current.innerHTML = initialHTML
    }
    // mount only
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  const emit = () => onChange && onChange(ref.current?.innerHTML || "")

  const run = (cmd, value) => {
    ref.current?.focus()
    exec(cmd, value)
    emit()
  }

  const toggleHeading = () => {
    const block = (document.queryCommandValue("formatBlock") || "").toLowerCase()
    run("formatBlock", block === "h2" ? "P" : "H2")
  }

  return (
    <div className="overflow-hidden rounded-lg border border-gray-300 bg-white transition focus-within:border-emerald-500 focus-within:ring-4 focus-within:ring-emerald-100">
      <div className="flex flex-wrap items-center gap-0.5 border-b border-gray-200 bg-gray-50 px-2 py-1.5">
        <TBtn title="Bold" onDo={() => run("bold")}><span className="font-extrabold">B</span></TBtn>
        <TBtn title="Italic" onDo={() => run("italic")}><span className="italic">I</span></TBtn>
        <TBtn title="Underline" onDo={() => run("underline")}><span className="underline">U</span></TBtn>
        <Divider />
        <TBtn title="Subheading" onDo={toggleHeading}><span className="font-bold">H</span></TBtn>
        <Divider />
        <TBtn title="Bullet list" onDo={() => run("insertUnorderedList")}>
          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round">
            <circle cx="4" cy="6" r="1.2" fill="currentColor" stroke="none" />
            <circle cx="4" cy="12" r="1.2" fill="currentColor" stroke="none" />
            <circle cx="4" cy="18" r="1.2" fill="currentColor" stroke="none" />
            <line x1="9" y1="6" x2="20" y2="6" />
            <line x1="9" y1="12" x2="20" y2="12" />
            <line x1="9" y1="18" x2="20" y2="18" />
          </svg>
        </TBtn>
        <TBtn title="Numbered list" onDo={() => run("insertOrderedList")}>
          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
            <line x1="10" y1="6" x2="20" y2="6" />
            <line x1="10" y1="12" x2="20" y2="12" />
            <line x1="10" y1="18" x2="20" y2="18" />
            <text x="1.5" y="8.5" fontSize="7" fill="currentColor" stroke="none">1</text>
            <text x="1.5" y="14.5" fontSize="7" fill="currentColor" stroke="none">2</text>
            <text x="1.5" y="20.5" fontSize="7" fill="currentColor" stroke="none">3</text>
          </svg>
        </TBtn>
      </div>
      <div
        ref={ref}
        contentEditable
        suppressContentEditableWarning
        onInput={emit}
        data-placeholder={placeholder}
        className="rte-content min-h-[96px] px-3 py-2.5 text-sm text-gray-900 outline-none"
      />
    </div>
  )
}
