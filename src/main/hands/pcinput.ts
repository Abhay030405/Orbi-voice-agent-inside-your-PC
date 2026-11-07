// PC CONTROL: the Windows side. Mouse, keyboard, and UI Automation (Windows' accessibility system, which
// knows every button, link and text box of an app BY NAME, with its position). Guide: docs/build-log/12-pc-control.md.
//
// One small C# class, compiled ONCE into a DLL in the temp folder (named by a hash of the code) and loaded by
// each call, like the window-capture helper. Every call is DPI-aware first, so positions are real screen
// pixels on a 150% display. Values reach the script as DW_* environment variables (data, never code).

import { createHash } from 'node:crypto'
import { writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { basename, join } from 'node:path'
import { spawn, type ChildProcessWithoutNullStreams } from 'node:child_process'

const INPUT_CS = String.raw`using System;
using System.Text;
using System.Threading;
using System.Runtime.InteropServices;
using System.Windows.Automation;

// Windows' per-app sound meters (Core Audio). Only the methods we call are named; the rest keep their
// slot in the table so the ones after them line up.
[ComImport, Guid("BCDE0395-E52F-467C-8E3D-C4579291692E")] class DwMMDeviceEnumerator {}
[ComImport, Guid("A95664D2-9614-4F35-A746-DE8DB63617E6"), InterfaceType(ComInterfaceType.InterfaceIsIUnknown)]
interface IDwDeviceEnumerator { [PreserveSig] int EnumAudioEndpoints(int f, int s, out IntPtr d); [PreserveSig] int GetDefaultAudioEndpoint(int flow, int role, out IDwDevice dev); }
[ComImport, Guid("D666063F-1587-4E43-81F1-B948E807363F"), InterfaceType(ComInterfaceType.InterfaceIsIUnknown)]
interface IDwDevice { [PreserveSig] int Activate(ref Guid iid, int ctx, IntPtr p, [MarshalAs(UnmanagedType.IUnknown)] out object o); }
[ComImport, Guid("77AA99A0-1BD6-484F-8BC7-2C654C9A9B6F"), InterfaceType(ComInterfaceType.InterfaceIsIUnknown)]
interface IDwSessionManager2 { [PreserveSig] int GetAudioSessionControl(IntPtr a, int b, out IntPtr c); [PreserveSig] int GetSimpleAudioVolume(IntPtr a, int b, out IntPtr c); [PreserveSig] int GetSessionEnumerator(out IDwSessionEnumerator e); }
[ComImport, Guid("E2F5BB11-0570-40CA-ACDD-3AA01277DEE8"), InterfaceType(ComInterfaceType.InterfaceIsIUnknown)]
interface IDwSessionEnumerator { [PreserveSig] int GetCount(out int n); [PreserveSig] int GetSession(int i, out IDwSessionControl2 s); }
[ComImport, Guid("bfb7ff88-7239-4fc9-8fa2-07c950be9c6d"), InterfaceType(ComInterfaceType.InterfaceIsIUnknown)]
interface IDwSessionControl2 {
  [PreserveSig] int GetState(out int s); [PreserveSig] int S1(); [PreserveSig] int S2(); [PreserveSig] int S3(); [PreserveSig] int S4();
  [PreserveSig] int S5(); [PreserveSig] int S6(); [PreserveSig] int S7(); [PreserveSig] int S8();
  [PreserveSig] int GetSessionIdentifier(out IntPtr x); [PreserveSig] int GetSessionInstanceIdentifier(out IntPtr x); [PreserveSig] int GetProcessId(out uint pid);
}
[ComImport, Guid("C02216F6-8C67-4B5B-9D00-D008E73E0064"), InterfaceType(ComInterfaceType.InterfaceIsIUnknown)]
interface IDwMeter { [PreserveSig] int GetPeakValue(out float p); }

public static class DwInput {
  [DllImport("user32.dll")] public static extern bool SetProcessDPIAware();
  delegate bool EnumProc(IntPtr h, IntPtr l);
  [DllImport("user32.dll")] static extern bool EnumWindows(EnumProc f, IntPtr l);
  [DllImport("user32.dll", CharSet = CharSet.Unicode)] static extern int GetWindowText(IntPtr h, StringBuilder s, int n);
  [DllImport("user32.dll")] static extern bool IsWindowVisible(IntPtr h);
  [DllImport("user32.dll")] static extern bool GetWindowRect(IntPtr h, out RECT r);
  [DllImport("user32.dll")] static extern IntPtr WindowFromPoint(POINT p);
  [DllImport("user32.dll")] static extern IntPtr GetAncestor(IntPtr h, uint flags);
  [DllImport("user32.dll")] static extern uint GetWindowThreadProcessId(IntPtr h, out uint pid);
  [DllImport("user32.dll")] static extern bool SetCursorPos(int x, int y);
  [DllImport("user32.dll")] static extern uint SendInput(uint n, INPUT[] inputs, int size);
  [DllImport("user32.dll")] static extern IntPtr GetForegroundWindow();

  public struct RECT { public int L, T, R, B; }
  public struct POINT { public int X, Y; }
  [StructLayout(LayoutKind.Sequential)] struct MOUSEINPUT { public int dx, dy; public uint mouseData, dwFlags, time; public IntPtr extra; }
  [StructLayout(LayoutKind.Sequential)] struct KEYBDINPUT { public ushort vk, scan; public uint flags, time; public IntPtr extra; }
  [StructLayout(LayoutKind.Explicit)] struct UNION { [FieldOffset(0)] public MOUSEINPUT mi; [FieldOffset(0)] public KEYBDINPUT ki; }
  [StructLayout(LayoutKind.Sequential)] struct INPUT { public uint type; public UNION u; }

  static void Send(INPUT i) { SendInput(1, new[] { i }, Marshal.SizeOf(typeof(INPUT))); }
  static INPUT Mouse(uint flags, uint data) { var i = new INPUT { type = 0 }; i.u.mi.dwFlags = flags; i.u.mi.mouseData = data; return i; }
  static INPUT Key(ushort vk, ushort scan, uint flags) { var i = new INPUT { type = 1 }; i.u.ki.vk = vk; i.u.ki.scan = scan; i.u.ki.flags = flags; return i; }

  // A visible top-level window by its exact title.
  public static IntPtr Find(string title) {
    IntPtr found = IntPtr.Zero;
    EnumWindows((h, l) => {
      if (!IsWindowVisible(h)) return true;
      var sb = new StringBuilder(1024); GetWindowText(h, sb, 1024);
      if (sb.ToString() == title) { found = h; return false; }
      return true;
    }, IntPtr.Zero);
    return found;
  }

  public static string Rect(IntPtr h) { RECT r; GetWindowRect(h, out r); return r.L + "," + r.T + "," + (r.R - r.L) + "," + (r.B - r.T); }

  // Which program owns the window under a screen point (to refuse clicking Dreamwalker itself).
  public static uint PidAt(int x, int y) {
    var h = GetAncestor(WindowFromPoint(new POINT { X = x, Y = y }), 2);
    uint pid; GetWindowThreadProcessId(h, out pid); return pid;
  }
  public static uint ForegroundPid() { uint pid; GetWindowThreadProcessId(GetForegroundWindow(), out pid); return pid; }

  public static void Click(int x, int y, bool right, int count) {
    SetCursorPos(x, y); Thread.Sleep(40);
    uint down = right ? 0x0008u : 0x0002u, up = right ? 0x0010u : 0x0004u;
    for (int i = 0; i < count; i++) { Send(Mouse(down, 0)); Send(Mouse(up, 0)); Thread.Sleep(70); }
  }

  public static void Scroll(int x, int y, int notches) {
    SetCursorPos(x, y); Thread.Sleep(40);
    Send(Mouse(0x0800, unchecked((uint)(notches * 120))));
  }

  // Any text, any language: each character as a Unicode key press.
  public static void Type(string text) {
    foreach (char c in text) {
      if (c == '\n') { Send(Key(0x0D, 0, 0)); Send(Key(0x0D, 0, 2)); continue; }
      Send(Key(0, c, 0x0004)); Send(Key(0, c, 0x0006));
      Thread.Sleep(4);
    }
  }
  public static void SelectAll() { Send(Key(0x11, 0, 0)); Send(Key(0x41, 0, 0)); Send(Key(0x41, 0, 2)); Send(Key(0x11, 0, 2)); }
  public static void Enter() { Send(Key(0x0D, 0, 0)); Send(Key(0x0D, 0, 2)); }

  // The control under a point: "Button|Install".
  public static string NameAt(int x, int y) {
    try {
      var e = AutomationElement.FromPoint(new System.Windows.Point(x, y));
      return e.Current.ControlType.ProgrammaticName.Replace("ControlType.", "") + "|" + e.Current.Name;
    } catch { return ""; }
  }

  static readonly ControlType[] Clickable = {
    ControlType.Button, ControlType.Hyperlink, ControlType.Edit, ControlType.MenuItem, ControlType.ListItem,
    ControlType.TabItem, ControlType.CheckBox, ControlType.RadioButton, ControlType.ComboBox, ControlType.TreeItem,
    ControlType.SplitButton, ControlType.DataItem, ControlType.Document
  };

  // Clickable controls of a window, on screen: type \t name \t left \t top \t width \t height \t enabled.
  public static string Elements(IntPtr h, int max) {
    var root = AutomationElement.FromHandle(h);
    var conds = new Condition[Clickable.Length];
    for (int i = 0; i < Clickable.Length; i++) conds[i] = new PropertyCondition(AutomationElement.ControlTypeProperty, Clickable[i]);
    var all = root.FindAll(TreeScope.Descendants, new OrCondition(conds));
    var sb = new StringBuilder(); int n = 0;
    foreach (AutomationElement e in all) {
      try {
        var c = e.Current;
        if (c.IsOffscreen) continue;
        var r = c.BoundingRectangle;
        if (r.IsEmpty || r.Width < 2 || r.Height < 2) continue;
        string name = (c.Name ?? "").Replace('\t', ' ').Replace('\r', ' ').Replace('\n', ' ');
        if (name.Length > 120) name = name.Substring(0, 120);
        sb.Append(c.ControlType.ProgrammaticName.Replace("ControlType.", "")).Append('\t').Append(name).Append('\t')
          .Append((int)r.Left).Append('\t').Append((int)r.Top).Append('\t').Append((int)r.Width).Append('\t').Append((int)r.Height).Append('\t')
          .Append(c.IsEnabled ? "1" : "0").Append('\n');
        if (++n >= max) break;
      } catch { }
    }
    return sb.ToString();
  }

  // The controls of one type + name that Elements() lists, in the same order: on screen only. Press and Focus
  // counted hidden ones too, so "the 1st link named X" could be in a BACKGROUND browser tab (Chromium keeps
  // hidden tabs' controls): "play the first video" in the English-songs tab played the same video in the
  // Punjabi-songs tab (2026-10-21).
  static System.Collections.Generic.List<AutomationElement> Visible(IntPtr h, ControlType ct, string name) {
    var root = AutomationElement.FromHandle(h);
    var all = root.FindAll(TreeScope.Descendants, new AndCondition(new PropertyCondition(AutomationElement.ControlTypeProperty, ct), new PropertyCondition(AutomationElement.NameProperty, name)));
    var list = new System.Collections.Generic.List<AutomationElement>();
    foreach (AutomationElement e in all) {
      try {
        var c = e.Current;
        if (c.IsOffscreen) continue;
        var r = c.BoundingRectangle;
        if (r.IsEmpty || r.Width < 2 || r.Height < 2) continue;
        list.Add(e);
      } catch { }
    }
    return list;
  }

  // Press a control WITHOUT the mouse: find it again by type + name (+ which one, if several) in the window
  // and ask it to act (Invoke / Toggle / Select / Expand). Works even if the window is behind others.
  // Returns "invoked", or "click:x,y" (no such pattern: click its CURRENT centre), or "not found".
  public static string Press(IntPtr h, string type, string name, int nth) {
    ControlType ct = null;
    foreach (var c in Clickable) if (c.ProgrammaticName == "ControlType." + type) ct = c;
    if (ct == null) return "not found";
    var all = Visible(h, ct, name);
    if (all.Count == 0 || nth >= all.Count) return "not found";
    var e = all[nth];
    object p;
    try {
      if (e.TryGetCurrentPattern(InvokePattern.Pattern, out p)) { ((InvokePattern)p).Invoke(); return "invoked"; }
      if (e.TryGetCurrentPattern(TogglePattern.Pattern, out p)) { ((TogglePattern)p).Toggle(); return "invoked"; }
      if (e.TryGetCurrentPattern(SelectionItemPattern.Pattern, out p)) { ((SelectionItemPattern)p).Select(); return "invoked"; }
      if (e.TryGetCurrentPattern(ExpandCollapsePattern.Pattern, out p)) { ((ExpandCollapsePattern)p).Expand(); return "invoked"; }
    } catch { }
    var r = e.Current.BoundingRectangle;
    if (r.IsEmpty) return "not found";
    return "click:" + (int)(r.Left + r.Width / 2) + "," + (int)(r.Top + r.Height / 2);
  }

  // Put the keyboard focus in a control (a text box) before typing.
  public static bool Focus(IntPtr h, string type, string name, int nth) {
    try {
      ControlType ct = null;
      foreach (var c in Clickable) if (c.ProgrammaticName == "ControlType." + type) ct = c;
      if (ct == null) return false;
      var all = Visible(h, ct, name);
      if (nth >= all.Count) return false;
      all[nth].SetFocus(); return true;
    } catch { return false; }
  }

  [DllImport("user32.dll")] static extern bool SetForegroundWindow(IntPtr h);
  [DllImport("user32.dll")] static extern bool ShowWindow(IntPtr h, int cmd);
  [DllImport("user32.dll")] static extern bool IsIconic(IntPtr h);
  [DllImport("user32.dll")] static extern void keybd_event(byte vk, byte scan, uint flags, UIntPtr extra);
  // Bring a window to the front (Windows only lets an app do that right after "using the keyboard":
  // a tap of Alt is the usual workaround). True if it really is in front now.
  public static bool Activate(IntPtr h) {
    if (h == IntPtr.Zero) return false;
    if (IsIconic(h)) ShowWindow(h, 9);
    keybd_event(0x12, 0, 0, UIntPtr.Zero); keybd_event(0x12, 0, 2, UIntPtr.Zero);
    SetForegroundWindow(h);
    Thread.Sleep(60);
    return GetForegroundWindow() == h;
  }

  // Load a page in the browser window the user sees: the top-most window of that browser (z-order), then
  // Ctrl+L, the address, Enter. "In the same window, search for..." opened yet another window (2026-10-21).
  // "none" (no window of it), "nofocus", or "ok|<window title>".
  public static string NavigateTop(string proc, string url) {
    IntPtr found = IntPtr.Zero; string title = "";
    EnumWindows((h, l) => {
      if (!IsWindowVisible(h)) return true;
      var sb = new StringBuilder(512); GetWindowText(h, sb, 512);
      if (sb.Length == 0) return true;
      uint pid; GetWindowThreadProcessId(h, out pid);
      try {
        if (string.Equals(System.Diagnostics.Process.GetProcessById((int)pid).ProcessName, proc, StringComparison.OrdinalIgnoreCase)) { found = h; title = sb.ToString(); return false; }
      } catch { }
      return true;
    }, IntPtr.Zero);
    if (found == IntPtr.Zero) return "none";
    if (!Activate(found)) return "nofocus";
    Thread.Sleep(120);
    Send(Key(0x11, 0, 0)); Send(Key(0x4C, 0, 0)); Send(Key(0x4C, 0, 2)); Send(Key(0x11, 0, 2));
    Thread.Sleep(150);
    Type(url); Enter();
    return "ok|" + title;
  }

  // Is ANOTHER app making sound right now (a video, music)? The loudest peak 0..1 over ~0.3 s, of every
  // app except ours (by process name). Used to skip the open follow-up window: otherwise the video's
  // own audio gets answered (a YouTube ad "talked" to it, 2026-10-20).
  public static string OthersPeak(string ownName) {
    float max = 0; string loudest = "";
    var names = new System.Collections.Generic.List<string>();
    try {
      var en = (IDwDeviceEnumerator)new DwMMDeviceEnumerator();
      IDwDevice dev;
      if (en.GetDefaultAudioEndpoint(0, 0, out dev) != 0) return "|0";
      var iid = typeof(IDwSessionManager2).GUID;
      object o;
      if (dev.Activate(ref iid, 23, IntPtr.Zero, out o) != 0) return "|0";
      IDwSessionEnumerator e;
      if (((IDwSessionManager2)o).GetSessionEnumerator(out e) != 0) return "|0";
      int n;
      e.GetCount(out n);
      var meters = new System.Collections.Generic.List<IDwMeter>();
      for (int i = 0; i < n; i++) {
        IDwSessionControl2 c;
        if (e.GetSession(i, out c) != 0) continue;
        uint pid;
        c.GetProcessId(out pid);
        if (pid == 0) continue; // Windows' own system sounds
        string name = "";
        try { name = System.Diagnostics.Process.GetProcessById((int)pid).ProcessName; } catch { continue; }
        if (Array.IndexOf(ownName.ToLowerInvariant().Split(','), name.ToLowerInvariant()) >= 0) continue;
        var m = c as IDwMeter;
        if (m != null) { meters.Add(m); names.Add(name); }
      }
      for (int k = 0; k < 6; k++) {
        for (int j = 0; j < meters.Count; j++) { float p; if (meters[j].GetPeakValue(out p) == 0 && p > max) { max = p; loudest = names[j]; } }
        Thread.Sleep(50);
      }
    } catch { }
    return loudest + "|" + max.ToString(System.Globalization.CultureInfo.InvariantCulture);
  }

  [StructLayout(LayoutKind.Sequential)] struct DwPower { public byte AC, Flag, Percent, Saver; public int Life, FullLife; }
  [DllImport("kernel32.dll")] static extern bool GetSystemPowerStatus(out DwPower s);
  // "plugged,percent,secondsLeft": plugged 1/0 (255 unknown), percent 255 = no battery, seconds -1 = unknown.
  public static string Power() {
    DwPower p;
    if (!GetSystemPowerStatus(out p)) return "";
    return p.AC + "," + p.Percent + "," + p.Life;
  }

  [DllImport("user32.dll")] static extern bool PostMessage(IntPtr h, uint msg, IntPtr w, IntPtr l);
  [DllImport("user32.dll")] static extern bool IsWindow(IntPtr h);
  // Close one window like clicking its X (WM_CLOSE), then watch THAT window, not the program: Word keeps
  // running a moment after its window closes, and Settings lives in a shared host that never exits, so
  // "did the program exit?" said "didn't close" when it had (2026-10-20).
  // "closed" | "gone" (wasn't open) | "still open" (asking to save, or ignored it).
  public static string CloseTitled(string title) {
    IntPtr h = Find(title);
    if (h == IntPtr.Zero) return "gone";
    PostMessage(h, 0x0010, IntPtr.Zero, IntPtr.Zero);
    for (int i = 0; i < 40; i++) {
      Thread.Sleep(100);
      if (!IsWindow(h) || !IsWindowVisible(h)) return "closed";
    }
    return "still open";
  }

  // Windows' media keys: they go to whatever is playing (a YouTube tab, Spotify...), not to the window in front.
  public static void MediaKey(byte vk) { keybd_event(vk, 0, 1, UIntPtr.Zero); keybd_event(vk, 0, 3, UIntPtr.Zero); }
}
`

// Apps whose sound only MIRRORS what the PC plays (Wallpaper Engine's audio-reactive wallpapers): they
// "played" Orbi's own voice at peak 0.99, so every reply looked like music (2026-10-21).
const MIRRORS = 'wallpaper64,wallpaper32'
const DLL = join(tmpdir(), `dreamwalker-input-${createHash('sha256').update(INPUT_CS).digest('hex').slice(0, 12)}.dll`)

// ── One long-running helper ── Starting PowerShell and loading the helper took ~1.5 s PER CLICK (measured:
// 7 × 8 in Calculator = 4 clicks × 1.6 s). Now one PowerShell starts once and stays, reading requests as
// JSON lines and answering with JSON lines. It only knows the fixed commands below; every value is DATA
// (parsed JSON passed to our C# methods), never code. Restarted if it dies or hangs; stopped on quit.
const HOST_SCRIPT = `
[Console]::InputEncoding = [System.Text.Encoding]::UTF8
[Console]::OutputEncoding = [System.Text.Encoding]::UTF8
$ErrorActionPreference = 'Stop'
if (-not (Test-Path $env:DW_DLL)) {
  Add-Type -ReferencedAssemblies UIAutomationClient, UIAutomationTypes, WindowsBase -OutputAssembly $env:DW_DLL -OutputType Library -TypeDefinition @'
${INPUT_CS}
'@
}
Add-Type -AssemblyName UIAutomationClient, UIAutomationTypes
Add-Type -Path $env:DW_DLL
[void][DwInput]::SetProcessDPIAware()
$self = [uint32]$env:DW_SELF
[Console]::Out.WriteLine('{"ready":true}')
while ($null -ne ($line = [Console]::In.ReadLine())) {
  $r = @{}
  try {
    $q = $line | ConvertFrom-Json
    $r.id = $q.id
    switch ($q.op) {
      'elements' { $h = [DwInput]::Find($q.title); $r.found = ($h -ne [IntPtr]::Zero); if ($r.found) { $r.text = [DwInput]::Elements($h, [int]$q.max); $r.rect = [DwInput]::Rect($h) } }
      'rect'     { $h = [DwInput]::Find($q.title); $r.rect = if ($h -eq [IntPtr]::Zero) { '' } else { [DwInput]::Rect($h) } }
      'front'    { $r.front = [DwInput]::Activate([DwInput]::Find($q.title)) }
      'press'    { $h = [DwInput]::Find($q.title); $r.result = if ($h -eq [IntPtr]::Zero) { 'no window' } else { [DwInput]::Press($h, $q.type, $q.name, [int]$q.nth) } }
      'focus'    { $h = [DwInput]::Find($q.title); $r.focused = ($h -ne [IntPtr]::Zero) -and [DwInput]::Focus($h, $q.type, $q.name, [int]$q.nth) }
      'power'    { $r.power = [DwInput]::Power() }
      'close'    { $r.result = [DwInput]::CloseTitled([string]$q.title) }
      'media'    { [DwInput]::MediaKey([byte]$q.vk); $r.sent = $true }
      'selectall' { if ([DwInput]::ForegroundPid() -eq $self) { $r.done = $false } else { [DwInput]::SelectAll(); $r.done = $true } }
      'navigate' { $r.result = [DwInput]::NavigateTop([string]$q.proc, [string]$q.url) }
      'others'   { $r.peak = [DwInput]::OthersPeak($env:DW_OWN) }
      'what'     { $r.what = [DwInput]::NameAt([int]$q.x, [int]$q.y); $r.ours = ([DwInput]::PidAt([int]$q.x, [int]$q.y) -eq $self) }
      'click'    { if ([DwInput]::PidAt([int]$q.x, [int]$q.y) -eq $self) { $r.clicked = $false } else { [DwInput]::Click([int]$q.x, [int]$q.y, [bool]$q.right, [int]$q.count); $r.clicked = $true } }
      'scroll'   { if ([DwInput]::PidAt([int]$q.x, [int]$q.y) -eq $self) { $r.scrolled = $false } else { [DwInput]::Scroll([int]$q.x, [int]$q.y, [int]$q.n); $r.scrolled = $true } }
      'type'     { if ([DwInput]::ForegroundPid() -eq $self) { $r.typed = $false } else { [DwInput]::Type([string]$q.text); if ($q.enter) { [DwInput]::Enter() }; $r.typed = $true } }
      default    { $r.error = 'unknown op' }
    }
  } catch { $r.error = $_.Exception.Message }
  [Console]::Out.WriteLine(($r | ConvertTo-Json -Compress))
}
`

type Pending = { resolve: (v: Record<string, unknown>) => void; reject: (e: Error) => void; timer: ReturnType<typeof setTimeout> }

class InputHost {
  private child: ChildProcessWithoutNullStreams | null = null
  private ready: Promise<void> | null = null
  private buffer = ''
  private nextId = 1
  private readonly pending = new Map<number, Pending>()
  private chain: Promise<unknown> = Promise.resolve() // one request at a time, in order

  private start(): Promise<void> {
    this.ready ??= new Promise<void>((resolve, reject) => {
      // From a file: with the C# inside, the script is too long for a command line (ENAMETOOLONG).
      // Named by the same hash as the DLL, so a changed helper never runs an old script.
      const script = DLL.replace(/\.dll$/, '.ps1')
      writeFileSync(script, `\uFEFF${HOST_SCRIPT}`, 'utf8') // BOM: PowerShell 5 reads it as UTF-8
      const child = spawn('powershell.exe', ['-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass', '-File', script], {
        windowsHide: true,
        env: { ...process.env, DW_DLL: DLL, DW_SELF: String(process.pid), DW_OWN: `${basename(process.execPath, '.exe')},${MIRRORS}` }
      })
      this.child = child
      const startTimer = setTimeout(() => {
        reject(new Error('The input helper took too long to start.'))
        this.stop()
      }, 30_000)
      child.stdout.setEncoding('utf8')
      child.stdout.on('data', (chunk: string) => {
        this.buffer += chunk
        let nl: number
        while ((nl = this.buffer.indexOf('\n')) >= 0) {
          const line = this.buffer.slice(0, nl).trim()
          this.buffer = this.buffer.slice(nl + 1)
          if (!line) continue
          let msg: Record<string, unknown>
          try {
            msg = JSON.parse(line) as Record<string, unknown>
          } catch {
            continue // not ours (e.g. a stray warning): ignore
          }
          if (msg.ready) {
            clearTimeout(startTimer)
            resolve()
            continue
          }
          const p = this.pending.get(Number(msg.id))
          if (!p) continue
          this.pending.delete(Number(msg.id))
          clearTimeout(p.timer)
          if (typeof msg.error === 'string') p.reject(new Error(msg.error))
          else p.resolve(msg)
        }
      })
      child.on('exit', () => {
        clearTimeout(startTimer)
        reject(new Error('The input helper stopped.'))
        for (const p of this.pending.values()) {
          clearTimeout(p.timer)
          p.reject(new Error('The input helper stopped.'))
        }
        this.pending.clear()
        if (this.child === child) {
          this.child = null
          this.ready = null
          this.buffer = ''
        }
      })
    })
    return this.ready
  }

  request(op: string, args: Record<string, unknown>, timeoutMs = 20_000): Promise<Record<string, unknown>> {
    const run = async (): Promise<Record<string, unknown>> => {
      await this.start()
      const id = this.nextId++
      return new Promise((resolve, reject) => {
        const timer = setTimeout(() => {
          this.pending.delete(id)
          reject(new Error('Windows took too long to answer.'))
          this.stop() // a hung helper is replaced by a fresh one next time
        }, timeoutMs)
        this.pending.set(id, { resolve, reject, timer })
        this.child?.stdin.write(`${JSON.stringify({ id, op, ...args })}\n`)
      })
    }
    const next = this.chain.then(run, run)
    this.chain = next.catch(() => undefined)
    return next
  }

  stop(): void {
    this.child?.kill()
    this.child = null
    this.ready = null
    this.buffer = ''
  }
}

const host = new InputHost()
export const stopInputHost = (): void => host.stop()

// Lines of "type \t name \t left \t top \t width \t height \t enabled" (pcmap.parseElements reads them).
export async function listElements(title: string, max = 150): Promise<{ found: boolean; text: string; rect: string }> {
  const r = await host.request('elements', { title, max }, 25_000)
  return { found: r.found === true, text: String(r.text ?? ''), rect: String(r.rect ?? '') }
}

// Press a control by type + name (+ which one): "invoked", "click:x,y" (it has no press action: click
// there instead), "not found" or "no window".
export async function pressElement(title: string, type: string, name: string, nth: number): Promise<{ result: string }> {
  return { result: String((await host.request('press', { title, type, name, nth })).result ?? 'not found') }
}

export async function focusElement(title: string, type: string, name: string, nth: number): Promise<{ focused: boolean }> {
  return { focused: (await host.request('focus', { title, type, name, nth })).focused === true }
}

export async function bringToFront(title: string): Promise<boolean> {
  return (await host.request('front', { title })).front === true
}

// What's under a point ("Button|Install"), and whether it belongs to Dreamwalker itself.
export async function whatIsAt(x: number, y: number): Promise<{ what: string; ours: boolean }> {
  const r = await host.request('what', { x, y })
  return { what: String(r.what ?? ''), ours: r.ours === true }
}

// Click a screen point (physical pixels). Refuses if the point is on a Dreamwalker window (incl. its
// confirmation dialog): checked again right before clicking, in the same step.
export async function clickAt(x: number, y: number, right: boolean, count: number): Promise<{ clicked: boolean }> {
  return { clicked: (await host.request('click', { x, y, right, count })).clicked === true }
}

export async function scrollAt(x: number, y: number, notches: number): Promise<{ scrolled: boolean }> {
  return { scrolled: (await host.request('scroll', { x, y, n: notches })).scrolled === true }
}

// Type into whatever has the keyboard focus. Refuses if that's Dreamwalker.
export async function typeText(text: string, enter: boolean): Promise<{ typed: boolean }> {
  return { typed: (await host.request('type', { text, enter }, 60_000)).typed === true }
}

export async function windowRect(title: string): Promise<{ rect: string }> {
  return { rect: String((await host.request('rect', { title })).rect ?? '') }
}

export function parseRect(rect: string): { left: number; top: number; width: number; height: number } | null {
  const [left, top, width, height] = rect.split(',').map(Number)
  return [left, top, width, height].every(Number.isFinite) && width > 0 ? { left, top, width, height } : null
}

// Ctrl+A in the window in front (refused if that is Dreamwalker).
export async function selectAll(): Promise<boolean> {
  return (await host.request('selectall', {})).done === true
}

// Type `url` into the address bar of the top-most window of browser `proc` (chrome, msedge...).
export async function navigateTop(proc: string, url: string): Promise<string> {
  return String((await host.request('navigate', { proc, url }, 20_000)).result ?? 'none')
}

// Is another app playing sound (a video, music)? See OthersPeak in the C# above.
export async function othersPlaying(): Promise<{ playing: boolean; peak: number; app: string }> {
  const r = await host.request('others', {}, 8000)
  const [app, value] = String(r.peak ?? '').split('|')
  const peak = Number(value) || 0
  return { playing: peak > 0.02, peak, app: app || '?' }
}

// The laptop's battery (Windows' power status): null when there is no battery.
export async function batteryStatus(): Promise<{ percent: number; pluggedIn: boolean | null; minutesLeft: number | null } | null> {
  const [ac, percent, seconds] = String((await host.request('power', {}, 8000)).power ?? '').split(',').map(Number)
  if (!Number.isFinite(percent) || percent === 255) return null
  return { percent, pluggedIn: ac === 1 ? true : ac === 0 ? false : null, minutesLeft: seconds > 0 ? Math.round(seconds / 60) : null }
}

// Close one window by its exact title; see CloseTitled in the C# above.
export async function closeWindowTitled(title: string): Promise<'closed' | 'gone' | 'still open'> {
  const r = String((await host.request('close', { title }, 10_000)).result ?? 'still open')
  return r === 'closed' || r === 'gone' ? r : 'still open'
}

const MEDIA_KEYS = { play_pause: 0xb3, next: 0xb0, previous: 0xb1, stop: 0xb2 } as const
export type MediaAction = keyof typeof MEDIA_KEYS
export async function mediaKey(action: MediaAction): Promise<void> {
  await host.request('media', { vk: MEDIA_KEYS[action] })
}
