# Emits one JSON line per change describing the foreground window.
#
# This runs as a single long-lived process rather than one PowerShell
# spawn per poll -- spawning powershell.exe costs ~200ms and would make
# a 1s poll interval dominate the CPU.
#
# The window TITLE is not enough. A browser only ever exposes the site's
# own <title>, so Instagram Reels reads as "Instagram", and a YouTube
# Short reads as "<video name> - YouTube" with no mention of Shorts.
# The distinguishing part lives in the URL, so for browser windows the
# address bar is read out of the UI Automation tree as well.
#
# Output (stdout, UTF-8, one object per line):
#   {"hwnd":123,"procId":42,"proc":"chrome","title":"Instagram - Google Chrome",
#    "url":"instagram.com/reels/Dcq3rV9B6gh/"}

param(
    [int]$IntervalMs = 1000,
    [int]$UrlIntervalMs = 1500      # address-bar reads cost ~100ms, so throttle them
)

$ErrorActionPreference = "Stop"
[Console]::OutputEncoding = [System.Text.Encoding]::UTF8

Add-Type -AssemblyName UIAutomationClient, UIAutomationTypes

Add-Type -TypeDefinition @"
using System;
using System.Runtime.InteropServices;
using System.Text;

public static class MorphCatFg {
    [DllImport("user32.dll")]
    public static extern IntPtr GetForegroundWindow();

    [DllImport("user32.dll", CharSet = CharSet.Unicode)]
    public static extern int GetWindowTextW(IntPtr hWnd, StringBuilder text, int count);

    [DllImport("user32.dll")]
    public static extern uint GetWindowThreadProcessId(IntPtr hWnd, out uint processId);
}
"@

$BROWSERS = @("chrome", "msedge", "firefox", "brave", "opera", "vivaldi",
              "arc", "chromium", "librewolf", "zen", "opera_gx")

# resolved address-bar elements, keyed by hwnd -- re-resolving the UIA
# tree on every poll is what makes this approach expensive
$barCache = @{}

function Get-AddressBar($hwnd) {
    $key = [string]$hwnd
    if ($barCache.ContainsKey($key)) {
        return $barCache[$key]
    }

    $root = [System.Windows.Automation.AutomationElement]::FromHandle($hwnd)
    if (-not $root) { return $null }

    $cond = New-Object System.Windows.Automation.PropertyCondition(
        [System.Windows.Automation.AutomationElement]::ControlTypeProperty,
        [System.Windows.Automation.ControlType]::Edit)
    $edits = $root.FindAll([System.Windows.Automation.TreeScope]::Descendants, $cond)
    if (-not $edits -or $edits.Count -eq 0) { return $null }

    $chosen = $null
    # Chrome/Edge: "Address and search bar". Firefox: "Search with ... or enter address".
    for ($i = 0; $i -lt $edits.Count; $i++) {
        $e = $edits.Item($i)
        if ($e.Current.Name -match "(?i)address") { $chosen = $e; break }
    }
    if (-not $chosen) {
        # fall back to the first edit that actually holds something URL-shaped
        for ($i = 0; $i -lt $edits.Count; $i++) {
            $e = $edits.Item($i)
            try {
                $v = $e.GetCurrentPattern([System.Windows.Automation.ValuePattern]::Pattern).Current.Value
                if ($v -and ($v -match "\." -or $v -match "^https?:")) { $chosen = $e; break }
            } catch { }
        }
    }

    if ($chosen) { $barCache[$key] = $chosen }
    return $chosen
}

function Get-BrowserUrl($hwnd) {
    try {
        $bar = Get-AddressBar $hwnd
        if (-not $bar) { return "" }
        $v = $bar.GetCurrentPattern([System.Windows.Automation.ValuePattern]::Pattern).Current.Value
        if ($null -eq $v) { return "" }
        return $v
    } catch {
        # the cached element went stale (tab closed, window rebuilt)
        $barCache.Remove([string]$hwnd)
        return ""
    }
}

$lastPayload = ""
$lastUrl = ""
$lastUrlHwnd = [IntPtr]::Zero
$lastUrlAt = [DateTime]::MinValue

while ($true) {
    try {
        $hwnd = [MorphCatFg]::GetForegroundWindow()

        if ($hwnd -ne [IntPtr]::Zero) {
            $sb = New-Object System.Text.StringBuilder 1024
            [void][MorphCatFg]::GetWindowTextW($hwnd, $sb, $sb.Capacity)

            # NOTE: $pid is a PowerShell automatic variable (this process's
            # own id) and cannot be assigned to. Hence $targetPid.
            $targetPid = [uint32]0
            [void][MorphCatFg]::GetWindowThreadProcessId($hwnd, [ref]$targetPid)

            $procName = ""
            try {
                $procName = (Get-Process -Id $targetPid -ErrorAction Stop).ProcessName
            } catch {
                $procName = ""
            }

            $url = ""
            if ($BROWSERS -contains $procName.ToLower()) {
                $age = ([DateTime]::UtcNow - $lastUrlAt).TotalMilliseconds
                if ($hwnd -ne $lastUrlHwnd -or $age -ge $UrlIntervalMs) {
                    $url = Get-BrowserUrl $hwnd
                    $lastUrl = $url
                    $lastUrlHwnd = $hwnd
                    $lastUrlAt = [DateTime]::UtcNow
                } else {
                    $url = $lastUrl
                }
            } else {
                $barCache.Clear()
            }

            $payload = [ordered]@{
                hwnd   = [int64]$hwnd
                procId = [int]$targetPid
                proc   = $procName
                title  = $sb.ToString()
                url    = $url
            } | ConvertTo-Json -Compress

            # only speak when something actually changed
            if ($payload -ne $lastPayload) {
                $lastPayload = $payload
                Write-Output $payload
            }
        }
    } catch {
        Write-Output (@{ error = $_.Exception.Message } | ConvertTo-Json -Compress)
    }

    Start-Sleep -Milliseconds $IntervalMs
}
