const fs = require('node:fs');
const { spawn } = require('node:child_process');

// Chromium's DOM debugger cannot control a Windows file dialog. This bounded
// fallback is used only after the page's upload control has been activated and
// no usable input exists. The path is passed through the environment so a
// document filename can never become PowerShell source code.
async function chooseNativeFile(filePath, { timeoutMs = 10000 } = {}) {
  if (process.platform !== 'win32' || typeof filePath !== 'string' || !filePath.trim()) return { status: 'unsupported' };
  if (!fs.existsSync(filePath)) return { status: 'path_not_found', filePath };
  const script = [
    // UI Automation writes the complete path into the dialog's edit control;
    // SendKeys/clipboard is unreliable for paths containing parentheses.
    'Add-Type -AssemblyName UIAutomationClient, UIAutomationTypes',
    '$root = [System.Windows.Automation.AutomationElement]::RootElement',
    '$deadline = (Get-Date).AddMilliseconds([int]$env:NORTHSTAR_PICKER_TIMEOUT_MS)',
    'while ((Get-Date) -lt $deadline) {',
    // Some Chromium-hosted dialogs are not returned as direct RootElement
    // children. Search window descendants by role and accept the standard
    // Open/Select titles used by the Windows picker variants.
    '  $windowCondition = New-Object System.Windows.Automation.PropertyCondition([System.Windows.Automation.AutomationElement]::ControlTypeProperty, [System.Windows.Automation.ControlType]::Window)',
    '  $dialogs = $root.FindAll([System.Windows.Automation.TreeScope]::Descendants, $windowCondition)',
    '  foreach ($dialog in $dialogs) {',
    '    if ($dialog.Current.Name -notmatch "^(Open|Select)( .*)?$") { continue }',
    '    $editCondition = New-Object System.Windows.Automation.PropertyCondition([System.Windows.Automation.AutomationElement]::ControlTypeProperty, [System.Windows.Automation.ControlType]::Edit)',
    '    $edit = $dialog.FindFirst([System.Windows.Automation.TreeScope]::Descendants, $editCondition)',
    '    if (-not $edit) { continue }',
    '    $valuePattern = $edit.GetCurrentPattern([System.Windows.Automation.ValuePattern]::Pattern)',
    '    $valuePattern.SetValue($env:NORTHSTAR_PICKER_PATH)',
    '    $buttonCondition = New-Object System.Windows.Automation.AndCondition((New-Object System.Windows.Automation.PropertyCondition([System.Windows.Automation.AutomationElement]::ControlTypeProperty, [System.Windows.Automation.ControlType]::Button)), (New-Object System.Windows.Automation.PropertyCondition([System.Windows.Automation.AutomationElement]::NameProperty, "Open")))',
    '    $button = $dialog.FindFirst([System.Windows.Automation.TreeScope]::Descendants, $buttonCondition)',
    '    if (-not $button) { continue }',
    '    $invokePattern = $button.GetCurrentPattern([System.Windows.Automation.InvokePattern]::Pattern)',
    '    $invokePattern.Invoke()',
    '    exit 0',
    '  }',
    '  Start-Sleep -Milliseconds 100',
    '}',
    'exit 2',
  ].join('; ');
  return new Promise((resolve, reject) => {
    const child = spawn('powershell.exe', ['-NoProfile', '-NonInteractive', '-STA', '-ExecutionPolicy', 'Bypass', '-Command', script], {
      windowsHide: true,
      env: { ...process.env, NORTHSTAR_PICKER_PATH: filePath, NORTHSTAR_PICKER_TIMEOUT_MS: String(timeoutMs) },
    });
    let settled = false;
    const finish = (result, error) => { if (settled) return; settled = true; clearTimeout(timer); if (error) reject(error); else resolve(result); };
    const timer = setTimeout(() => { child.kill(); finish({ status: 'timeout', filePath }); }, timeoutMs);
    child.on('error', (error) => finish(null, error));
    child.on('exit', (code) => finish({ status: code === 0 ? 'selected' : 'not_found', filePath, exitCode: code }));
  });
}

module.exports = { chooseNativeFile };
