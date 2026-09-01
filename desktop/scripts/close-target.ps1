# Closes the offending window -- but only if it is STILL the foreground
# window and its title still matches what was detected.
#
# That re-check is the whole safety story here: between the cat deciding
# to act and this script running, the user may have alt-tabbed to
# something else. Sending Ctrl+W blind would close a tab of whatever
# happens to be in front, which could be real work.
#
# Exit codes: 0 acted · 2 target moved on, did nothing · 1 error

param(
    [Parameter(Mandatory = $true)][int64]$Hwnd,
    [ValidateSet("tab", "close")][string]$Mode = "tab",
    [string]$ExpectTitle = ""
)

$ErrorActionPreference = "Stop"
[Console]::OutputEncoding = [System.Text.Encoding]::UTF8

Add-Type -TypeDefinition @"
using System;
using System.Runtime.InteropServices;
using System.Text;

public static class MorphCatAct {
    [DllImport("user32.dll")]
    public static extern IntPtr GetForegroundWindow();

    [DllImport("user32.dll", CharSet = CharSet.Unicode)]
    public static extern int GetWindowTextW(IntPtr hWnd, StringBuilder text, int count);

    [DllImport("user32.dll", CharSet = CharSet.Unicode)]
    public static extern IntPtr SendMessageTimeoutW(
        IntPtr hWnd, uint msg, IntPtr wParam, IntPtr lParam,
        uint flags, uint timeout, out IntPtr result);
}
"@

$target = [IntPtr]::new($Hwnd)
$foreground = [MorphCatAct]::GetForegroundWindow()

if ($foreground -ne $target) {
    Write-Output (@{ ok = $false; reason = "not-foreground" } | ConvertTo-Json -Compress)
    exit 2
}

$sb = New-Object System.Text.StringBuilder 1024
[void][MorphCatAct]::GetWindowTextW($target, $sb, $sb.Capacity)
$title = $sb.ToString()

if ($ExpectTitle -ne "" -and $title -notlike "*$ExpectTitle*") {
    Write-Output (@{ ok = $false; reason = "title-changed"; title = $title } | ConvertTo-Json -Compress)
    exit 2
}

if ($Mode -eq "tab") {
    # Ctrl+W closes the offending tab and leaves the rest of the browser
    # alone -- much less destructive than closing the whole window.
    Add-Type -AssemblyName System.Windows.Forms
    [System.Windows.Forms.SendKeys]::SendWait("^w")
} else {
    $WM_CLOSE = 0x0010
    $SMTO_ABORTIFHUNG = 0x0002
    $result = [IntPtr]::Zero
    [void][MorphCatAct]::SendMessageTimeoutW(
        $target, $WM_CLOSE, [IntPtr]::Zero, [IntPtr]::Zero,
        $SMTO_ABORTIFHUNG, 2000, [ref]$result)
}

Write-Output (@{ ok = $true; mode = $Mode; title = $title } | ConvertTo-Json -Compress)
exit 0
