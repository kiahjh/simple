import AppKit
import ApplicationServices
// Usage: swift devicehub-ax.swift press|rows|select|menu <label>
// Drives Xcode 27.1's Device Hub through accessibility. See NOTES.md, "Driving Device Hub".
let pid = NSRunningApplication.runningApplications(withBundleIdentifier: "com.apple.dt.Devices").first!.processIdentifier
let app = AXUIElementCreateApplication(pid)
AXUIElementSetAttributeValue(app, "AXManualAccessibility" as CFString, kCFBooleanTrue)
func attr(_ e: AXUIElement, _ a: String) -> AnyObject? { var v: AnyObject?; AXUIElementCopyAttributeValue(e, a as CFString, &v); return v }
func s(_ e: AXUIElement, _ a: String) -> String { (attr(e, a) as? String) ?? "" }
func label(_ e: AXUIElement) -> String { [s(e, kAXTitleAttribute), s(e, kAXDescriptionAttribute), (attr(e, kAXValueAttribute) as? String) ?? ""].filter { !$0.isEmpty }.joined(separator: " / ") }
func find(_ e: AXUIElement, _ pred: (AXUIElement) -> Bool, _ d: Int = 0) -> [AXUIElement] {
  if d > 30 { return [] }
  var out = pred(e) ? [e] : []
  for c in (attr(e, kAXChildrenAttribute) as? [AXUIElement]) ?? [] { out += find(c, pred, d + 1) }
  return out
}
let windows = (attr(app, kAXWindowsAttribute) as? [AXUIElement]) ?? []
let cmd = CommandLine.arguments[1], arg = CommandLine.arguments.count > 2 ? CommandLine.arguments[2] : ""
switch cmd {
case "press":
  let hits = windows.flatMap { find($0, { label($0).hasPrefix(arg) && s($0, kAXRoleAttribute) != "AXStaticText" }) }
  print("matches:", hits.map { s($0, kAXRoleAttribute) + " " + label($0) })
  if let h = hits.first { print("press:", AXUIElementPerformAction(h, kAXPressAction as CFString).rawValue) }
case "rows":
  for w in windows {
    print("WINDOW:", s(w, kAXTitleAttribute))
    for r in find(w, { ["AXRow", "AXCell", "AXOutlineRow"].contains(s($0, kAXRoleAttribute)) || s($0, kAXSubroleAttribute) == "AXOutlineRow" }) {
      let texts = find(r, { s($0, kAXRoleAttribute) == "AXStaticText" }).map(label)
      print(" ", s(r, kAXRoleAttribute), texts.joined(separator: " · "))
    }
  }
case "select":
  for w in windows {
    let rows = find(w, { s($0, kAXRoleAttribute) == "AXRow" })
    if let r = rows.first(where: { find($0, { s($0, kAXRoleAttribute) == "AXStaticText" && label($0) == arg }).count > 0 }) {
      print("select:", AXUIElementSetAttributeValue(r, kAXSelectedAttribute as CFString, kCFBooleanTrue).rawValue)
    } else { print("no row named", arg) }
  }
case "menu":
  let items = find(app, { s($0, kAXRoleAttribute) == "AXMenuItem" && s($0, kAXTitleAttribute) == arg })
  print("menu matches:", items.count)
  if let i = items.first { print("press:", AXUIElementPerformAction(i, kAXPressAction as CFString).rawValue) }
default: break
}
