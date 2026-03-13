; =============================================================================
; Symbol Network Manager — Inno Setup Script
; =============================================================================
; Build command:
;   "C:\Program Files (x86)\Inno Setup 6\ISCC.exe" setup.iss
; =============================================================================

#define MyAppName "Symbol Network Manager"
#define MyAppVersion "1.2.0"
#define MyAppPublisher "NFTDrive Bootarou"
#define MyAppURL "https://github.com/bootarou/blockchain-network-launcher"

[Setup]
AppId={{B3F7A2E1-9C4D-4E8B-A1D6-F5E2C8B7A3D9}
AppName={#MyAppName}
AppVersion={#MyAppVersion}
AppPublisher={#MyAppPublisher}
AppPublisherURL={#MyAppURL}
AppSupportURL={#MyAppURL}/issues
DefaultDirName={userappdata}\SymbolNetworkManager
DefaultGroupName={#MyAppName}
DisableProgramGroupPage=yes
OutputDir=output
OutputBaseFilename=SymbolNetworkManager-Setup-{#MyAppVersion}
; アイコン（オプション — 後でカスタム .ico を追加可能）
; SetupIconFile=assets\icon.ico
Compression=lzma2
SolidCompression=yes
; 管理者権限を要求（WSL2 + Docker のインストールに必要）
PrivilegesRequired=admin
PrivilegesRequiredOverridesAllowed=dialog
; Windows 10 v2004 以上を要求
MinVersion=10.0.19041
WizardStyle=modern
; アンインストーラは不要（Docker コンテナの管理は別途）
Uninstallable=no
; 進捗バーなし（PowerShell スクリプトが進捗を表示する）
DisableFinishedPage=no

[Languages]
Name: "japanese"; MessagesFile: "compiler:Languages\Japanese.isl"
Name: "english"; MessagesFile: "compiler:Default.isl"

[Messages]
japanese.WelcomeLabel2=このウィザードは、Symbol Network Manager の実行に必要な環境をセットアップします。%n%n以下のソフトウェアが自動的にインストールされます：%n  • WSL2 (Windows Subsystem for Linux 2)%n  • Docker Desktop for Windows%n  • Git for Windows%n  • Symbol Network Manager
english.WelcomeLabel2=This wizard will set up the required environment for Symbol Network Manager.%n%nThe following software will be automatically installed:%n  • WSL2 (Windows Subsystem for Linux 2)%n  • Docker Desktop for Windows%n  • Git for Windows%n  • Symbol Network Manager

[Files]
; PowerShell スクリプトを一時ディレクトリに展開
Source: "scripts\check-prereqs.ps1"; DestDir: "{tmp}"; Flags: ignoreversion deleteafterinstall
Source: "scripts\setup-wsl2.ps1"; DestDir: "{tmp}"; Flags: ignoreversion deleteafterinstall
Source: "scripts\setup-docker.ps1"; DestDir: "{tmp}"; Flags: ignoreversion deleteafterinstall
Source: "scripts\setup-project.ps1"; DestDir: "{tmp}"; Flags: ignoreversion deleteafterinstall

[Run]
; Step 1: 前提条件チェック
Filename: "powershell.exe"; \
  Parameters: "-ExecutionPolicy Bypass -File ""{tmp}\check-prereqs.ps1"""; \
  StatusMsg: "前提条件を確認しています..."; \
  Flags: runhidden waituntilterminated; \
  Check: not WizardSilent

; Step 2: WSL2 セットアップ
Filename: "powershell.exe"; \
  Parameters: "-ExecutionPolicy Bypass -File ""{tmp}\setup-wsl2.ps1"""; \
  StatusMsg: "WSL2 をセットアップしています..."; \
  Flags: runhidden waituntilterminated

; Step 3: Docker Desktop セットアップ
Filename: "powershell.exe"; \
  Parameters: "-ExecutionPolicy Bypass -File ""{tmp}\setup-docker.ps1"""; \
  StatusMsg: "Docker Desktop をセットアップしています..."; \
  Flags: runhidden waituntilterminated

; Step 4: プロジェクトセットアップ
Filename: "powershell.exe"; \
  Parameters: "-ExecutionPolicy Bypass -File ""{tmp}\setup-project.ps1"" -InstallDir ""{app}"""; \
  StatusMsg: "Symbol Network Manager をセットアップしています..."; \
  Flags: runhidden waituntilterminated

; 完了後にブラウザを開く
Filename: "http://localhost:5173"; \
  Description: "Symbol Network Manager を開く"; \
  Flags: postinstall nowait shellexec skipifsilent

[Code]
// ── カスタム進捗表示用の Pascal Script ──────────────────────────

var
  StatusLabel: TNewStaticText;

procedure InitializeWizard;
begin
  // ウィザードページにステータスラベルを追加
  StatusLabel := TNewStaticText.Create(WizardForm);
  StatusLabel.Parent := WizardForm.InstallingPage;
  StatusLabel.Left := 0;
  StatusLabel.Top := WizardForm.StatusLabel.Top + WizardForm.StatusLabel.Height + 16;
  StatusLabel.Width := WizardForm.InstallingPage.Width;
  StatusLabel.AutoSize := False;
  StatusLabel.WordWrap := True;
  StatusLabel.Caption := '';
end;

function InitializeSetup: Boolean;
begin
  // Windows バージョンの最終確認
  if not IsWindows10OrGreater then begin
    MsgBox('このアプリケーションは Windows 10 バージョン 2004 以上が必要です。', mbCriticalError, MB_OK);
    Result := False;
    Exit;
  end;
  Result := True;
end;

function IsWindows10OrGreater: Boolean;
begin
  Result := (GetWindowsVersion >= $0A000000);
end;

// 再起動が必要な場合のハンドリング
function NeedRestart: Boolean;
begin
  // WSL2 のインストール後に再起動が必要な場合
  Result := FileExists(ExpandConstant('{tmp}\symbol-needs-reboot'));
end;
