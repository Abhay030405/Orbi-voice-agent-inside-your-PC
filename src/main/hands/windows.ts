// Windows plumbing for the tools: run one of OUR PowerShell scripts with outside values passed as
// data (never as code, see process.ts), and get JSON back.
//
// Some things have no PowerShell command (system volume, bringing a window to the front), so the
// scripts below compile small C# snippets that call Windows' own APIs (Core Audio, user32.dll).

import { createHash } from 'node:crypto'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { runPowerShell } from './process'

export const isWindows = process.platform === 'win32'
export const NOT_WINDOWS = 'This tool only works on Windows so far.'

// Run a script and parse its JSON output. Throws a readable error if PowerShell failed.
export async function psJson<T>(script: string, data: Record<string, string> = {}, timeoutMs = 15_000): Promise<T> {
  const r = await runPowerShell(script, data, { timeoutMs, maxOutputBytes: 512 * 1024 })
  if (r.timedOut) throw new Error('Windows took too long to answer')
  if (r.exitCode !== 0) throw new Error(firstLine(r.stderr) || r.error || `PowerShell exited with ${r.exitCode}`)
  const text = r.stdout.trim()
  return (text ? JSON.parse(text) : null) as T
}

function firstLine(text: string): string {
  return text.split(/\r?\n/).find((l) => l.trim())?.trim() ?? ''
}

// ── System volume (Windows Core Audio API) ──
// The default speakers' master volume, 0..1, and mute. A well-known COM-interop pattern: declare the
// interfaces with their GUIDs, ask the device enumerator for the default output, activate its volume.
const AUDIO_CS = String.raw`
using System; using System.Runtime.InteropServices;
[Guid("5CDF2C82-841E-4546-9722-0CF74078229A"), InterfaceType(ComInterfaceType.InterfaceIsIUnknown)]
interface IAudioEndpointVolume {
  int f(); int g(); int h(); int i();
  int SetMasterVolumeLevelScalar(float level, Guid ctx);
  int j();
  int GetMasterVolumeLevelScalar(out float level);
  int k(); int l(); int m(); int n();
  int SetMute([MarshalAs(UnmanagedType.Bool)] bool mute, Guid ctx);
  int GetMute(out bool mute);
}
[Guid("D666063F-1587-4E43-81F1-B948E807363F"), InterfaceType(ComInterfaceType.InterfaceIsIUnknown)]
interface IMMDevice { int Activate(ref Guid id, int clsCtx, int p, out IAudioEndpointVolume v); }
[Guid("A95664D2-9614-4F35-A746-DE8DB63617E6"), InterfaceType(ComInterfaceType.InterfaceIsIUnknown)]
interface IMMDeviceEnumerator { int f(); int GetDefaultAudioEndpoint(int flow, int role, out IMMDevice d); }
[ComImport, Guid("BCDE0395-E52F-467C-8E3D-C4579291692E")] class MMDeviceEnumerator { }
public static class DwAudio {
  static IAudioEndpointVolume Vol() {
    var e = (IMMDeviceEnumerator)new MMDeviceEnumerator(); IMMDevice d;
    Marshal.ThrowExceptionForHR(e.GetDefaultAudioEndpoint(0, 1, out d));
    var id = typeof(IAudioEndpointVolume).GUID; IAudioEndpointVolume v;
    Marshal.ThrowExceptionForHR(d.Activate(ref id, 23, 0, out v)); return v;
  }
  public static float Get() { float x; Marshal.ThrowExceptionForHR(Vol().GetMasterVolumeLevelScalar(out x)); return x; }
  public static void Set(float x) { Marshal.ThrowExceptionForHR(Vol().SetMasterVolumeLevelScalar(x, Guid.Empty)); }
  public static bool Muted() { bool m; Marshal.ThrowExceptionForHR(Vol().GetMute(out m)); return m; }
  public static void Mute(bool m) { Marshal.ThrowExceptionForHR(Vol().SetMute(m, Guid.Empty)); }
}`

export interface VolumeState {
  level: number // 0..100
  muted: boolean
}

const AUDIO_PRELUDE = `Add-Type -TypeDefinition @'\n${AUDIO_CS}\n'@\n`

export function getVolume(): Promise<VolumeState> {
  return psJson<VolumeState>(
    `${AUDIO_PRELUDE}[pscustomobject]@{ level = [math]::Round([DwAudio]::Get() * 100); muted = [DwAudio]::Muted() } | ConvertTo-Json -Compress`
  )
}

// Values arrive as DATA (env vars), and are checked again in PowerShell before use.
export function setVolume(change: { level?: number; muted?: boolean }): Promise<VolumeState> {
  return psJson<VolumeState>(
    `${AUDIO_PRELUDE}
     if ($env:DW_LEVEL -ne '') { $l = [double]$env:DW_LEVEL; if ($l -lt 0 -or $l -gt 100) { throw 'level must be 0-100' }; [DwAudio]::Set([float]($l / 100)) }
     if ($env:DW_MUTED -ne '') { [DwAudio]::Mute($env:DW_MUTED -eq 'true') }
     [pscustomobject]@{ level = [math]::Round([DwAudio]::Get() * 100); muted = [DwAudio]::Muted() } | ConvertTo-Json -Compress`,
    {
      level: change.level === undefined ? '' : String(change.level),
      muted: change.muted === undefined ? '' : String(change.muted)
    }
  )
}

// ── Windows (the on-screen kind) ──
export interface WindowInfo {
  pid: number
  process: string
  title: string
}

export function listWindows(): Promise<WindowInfo[]> {
  return psJson<WindowInfo[]>(
    // -InputObject @(...): Windows PowerShell 5.1 has no -AsArray, and piping a one-item list into
    // ConvertTo-Json would turn it into a single object instead of a list.
    `ConvertTo-Json -Compress -InputObject @(Get-Process | Where-Object { $_.MainWindowHandle -ne 0 -and $_.MainWindowTitle } |
       ForEach-Object { [pscustomobject]@{ pid = $_.Id; process = $_.ProcessName; title = $_.MainWindowTitle } })`
  )
}

// Bring a window to the front. Windows blocks background apps from stealing focus, unless the app
// that asks has just "used the keyboard", so we tap the Alt key first (a widely used workaround).
// Then we CHECK which window is really in front instead of trusting the call (PS A3).
const FOCUS_CS = String.raw`
using System; using System.Runtime.InteropServices;
public static class DwWin {
  [DllImport("user32.dll")] public static extern bool SetForegroundWindow(IntPtr h);
  [DllImport("user32.dll")] public static extern bool ShowWindow(IntPtr h, int cmd);
  [DllImport("user32.dll")] public static extern bool IsIconic(IntPtr h);
  [DllImport("user32.dll")] public static extern IntPtr GetForegroundWindow();
  [DllImport("user32.dll")] public static extern void keybd_event(byte vk, byte scan, uint flags, UIntPtr extra);
  public static bool Focus(IntPtr h) {
    if (IsIconic(h)) ShowWindow(h, 9); // 9 = restore from minimized
    keybd_event(0x12, 0, 0, UIntPtr.Zero); keybd_event(0x12, 0, 2, UIntPtr.Zero); // Alt down + up
    SetForegroundWindow(h);
    return GetForegroundWindow() == h;
  }
}`

export function focusWindow(pid: number): Promise<{ focused: boolean; title: string }> {
  return psJson(
    `Add-Type -TypeDefinition @'\n${FOCUS_CS}\n'@
     $p = Get-Process -Id ([int]$env:DW_PID) -ErrorAction Stop
     if ($p.MainWindowHandle -eq 0) { throw 'that program has no window' }
     $ok = [DwWin]::Focus($p.MainWindowHandle)
     Start-Sleep -Milliseconds 150
     [pscustomobject]@{ focused = ([DwWin]::GetForegroundWindow() -eq $p.MainWindowHandle); title = $p.MainWindowTitle } | ConvertTo-Json -Compress`,
    { pid: String(pid) }
  )
}

// Capture ONE window's own pixels into a JPEG file. PrintWindow with PW_RENDERFULLCONTENT (2) asks the
// window to draw itself, which also works for GPU-drawn windows (Chrome, Electron, VS Code) and for
// windows partly behind others. Electron's own window capture returned an EMPTY picture for some of
// these (measured on a visible, normal 1214×789 window), so this is the fallback.
// DPI-aware first: otherwise on a 150% screen Windows reports the window 1.5× too small and we'd crop it.
const CAPTURE_CS = String.raw`
using System; using System.Text; using System.Drawing; using System.Drawing.Drawing2D; using System.Drawing.Imaging;
using System.Runtime.InteropServices;
public static class DwCap {
  delegate bool EnumProc(IntPtr h, IntPtr l);
  [DllImport("user32.dll")] static extern bool EnumWindows(EnumProc f, IntPtr l);
  [DllImport("user32.dll", CharSet=CharSet.Unicode)] static extern int GetWindowText(IntPtr h, StringBuilder s, int n);
  [DllImport("user32.dll")] static extern bool IsWindowVisible(IntPtr h);
  [DllImport("user32.dll")] public static extern bool IsIconic(IntPtr h);
  [DllImport("user32.dll")] static extern bool GetWindowRect(IntPtr h, out RECT r);
  [DllImport("user32.dll")] static extern bool PrintWindow(IntPtr h, IntPtr hdc, uint flags);
  [DllImport("user32.dll")] public static extern bool SetProcessDPIAware();
  struct RECT { public int L, T, R, B; }
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
  public static string Capture(IntPtr h, string path, int maxW, int maxH) {
    RECT r; GetWindowRect(h, out r);
    int w = r.R - r.L, ht = r.B - r.T;
    if (w <= 0 || ht <= 0) return "";
    using (var full = new Bitmap(w, ht, PixelFormat.Format32bppArgb)) {
      using (var g = Graphics.FromImage(full)) {
        IntPtr hdc = g.GetHdc();
        bool ok = PrintWindow(h, hdc, 2);
        g.ReleaseHdc(hdc);
        if (!ok) return "";
      }
      double s = Math.Min(1.0, Math.Min((double)maxW / w, (double)maxH / ht));
      int ow = Math.Max(1, (int)(w * s)), oh = Math.Max(1, (int)(ht * s));
      using (var small = new Bitmap(ow, oh)) {
        using (var g = Graphics.FromImage(small)) {
          g.InterpolationMode = InterpolationMode.HighQualityBicubic;
          g.DrawImage(full, 0, 0, ow, oh);
        }
        ImageCodecInfo jpeg = null;
        foreach (var c in ImageCodecInfo.GetImageEncoders()) if (c.MimeType == "image/jpeg") jpeg = c;
        var ps = new EncoderParameters(1);
        ps.Param[0] = new EncoderParameter(System.Drawing.Imaging.Encoder.Quality, 70L);
        small.Save(path, jpeg, ps);
      }
      return ow + "x" + oh;
    }
  }
}`

export type WindowCapture = { size: string } | { error: 'not found' | 'minimised' | 'failed' }

// Compiling the C# takes seconds, so it's compiled ONCE into a DLL in the temp folder (named by a hash of
// the code, so changing the code recompiles) and later calls just load it.
const CAPTURE_DLL = join(tmpdir(), `dreamwalker-capture-${createHash('sha256').update(CAPTURE_CS).digest('hex').slice(0, 12)}.dll`)

export function captureWindow(title: string, outFile: string, maxW: number, maxH: number): Promise<WindowCapture> {
  return psJson(
    `if (-not (Test-Path $env:DW_DLL)) {
       Add-Type -ReferencedAssemblies System.Drawing -OutputAssembly $env:DW_DLL -OutputType Library -TypeDefinition @'\n${CAPTURE_CS}\n'@
     }
     Add-Type -Path $env:DW_DLL
     [void][DwCap]::SetProcessDPIAware()
     $h = [DwCap]::Find($env:DW_TITLE)
     if ($h -eq [IntPtr]::Zero) { '{"error":"not found"}'; return }
     if ([DwCap]::IsIconic($h)) { '{"error":"minimised"}'; return }
     $size = [DwCap]::Capture($h, $env:DW_OUT, [int]$env:DW_MAXW, [int]$env:DW_MAXH)
     if (-not $size) { '{"error":"failed"}'; return }
     [pscustomobject]@{ size = $size } | ConvertTo-Json -Compress`,
    { title, out: outFile, maxw: String(maxW), maxh: String(maxH), dll: CAPTURE_DLL },
    20_000
  )
}

// Bring a top-level window to the front by its exact title. Used for OUR confirmation dialog ("Review in
// confirmation window" on Home): it only brings the dialog forward, it can't answer it.
export function focusWindowTitled(title: string): Promise<{ focused: boolean }> {
  return psJson(
    `Add-Type -TypeDefinition @'\n${FOCUS_CS}\n'@
     Add-Type -Namespace DwFind -Name W -MemberDefinition '[DllImport("user32.dll", CharSet=CharSet.Unicode)] public static extern IntPtr FindWindow(string c, string t);'
     $h = [DwFind.W]::FindWindow($null, $env:DW_TITLE)
     if ($h -eq [IntPtr]::Zero) { '{"focused":false}'; return }
     [pscustomobject]@{ focused = [DwWin]::Focus($h) } | ConvertTo-Json -Compress`,
    { title }
  )
}

// ── Installed apps (what the Start menu shows) ──
export interface StartApp {
  name: string
  appId: string
}

let appsCache: { at: number; apps: StartApp[] } | null = null

export async function listStartApps(): Promise<StartApp[]> {
  if (appsCache && Date.now() - appsCache.at < 5 * 60_000) return appsCache.apps
  const apps = await psJson<StartApp[]>(
    `ConvertTo-Json -Compress -InputObject @(Get-StartApps | ForEach-Object { [pscustomobject]@{ name = $_.Name; appId = $_.AppID } })`,
    {},
    20_000
  )
  appsCache = { at: Date.now(), apps }
  return apps
}

// Launch through the Start menu's own list ("shell:AppsFolder\<id>"), which works the same for normal
// desktop programs and Microsoft Store apps.
export async function launchStartApp(appId: string): Promise<void> {
  await psJson(`Start-Process ('shell:AppsFolder\\' + $env:DW_ID); 'null'`, { id: appId })
}

// Open a URL in a SPECIFIC browser. The browser comes from a fixed list (never from the AI's text),
// and the URL is passed as data.
// `privateFlag` = the browser's private-window switch (--incognito, --inprivate, -private-window), or ''.
// The URL and the flag reach PowerShell as data (environment variables), never as code.
export async function openInBrowser(exe: string, url: string, privateFlag = ''): Promise<void> {
  await psJson(
    `$a = @(); if ($env:DW_FLAG) { $a += $env:DW_FLAG }; $a += $env:DW_URL; Start-Process -FilePath $env:DW_EXE -ArgumentList $a; 'null'`,
    { exe, url, flag: privateFlag }
  )
}
