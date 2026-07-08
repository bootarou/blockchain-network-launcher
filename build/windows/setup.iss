; =============================================================================
; Symbol Network Manager — Inno Setup Script
; =============================================================================
; Build command:
;   "C:\Program Files (x86)\Inno Setup 6\ISCC.exe" setup.iss
; =============================================================================

#define MyAppName "Symbol Network Manager"
#define MyAppVersion "1.2.2"
#define MyAppPublisher "NFTDrive Bootarou"
#define MyAppURL "https://github.com/bootarou/blockchain-network-launcher"

[Setup]
AppId={{B3F7A2E1-9C4D-4E8B-A1D6-F5E2C8B7A3D9}
AppName={#MyAppName}
AppVersion={#MyAppVersion}
AppPublisher={#MyAppPublisher}
AppPublisherURL={#MyAppURL}
AppSupportURL={#MyAppURL}/issues
DefaultDirName={localappdata}\Programs\SymbolNetworkManager
UsePreviousAppDir=no
DefaultGroupName={#MyAppName}
DisableProgramGroupPage=yes
OutputDir=output
OutputBaseFilename=SymbolNetworkManager-Setup-{#MyAppVersion}
; アイコン（オプション — 後でカスタム .ico を追加可能）
; SetupIconFile=assets\icon.ico
Compression=lzma2
SolidCompression=yes
; Docker 事前準備前提のため非管理者で実行
PrivilegesRequired=lowest
PrivilegesRequiredOverridesAllowed=commandline
; Windows 10 v2004 以上を要求
MinVersion=10.0.19041
WizardStyle=modern
; アンインストーラは不要（Docker コンテナの管理は別途）
Uninstallable=no
; 進捗バーなし（PowerShell スクリプトが進捗を表示する）
DisableFinishedPage=no
; インストーラー実行ログを有効化（%TEMP% に Setup Log*.txt）
SetupLogging=yes

[Languages]
Name: "japanese"; MessagesFile: "compiler:Languages\Japanese.isl"
Name: "english"; MessagesFile: "compiler:Default.isl"

[Messages]
japanese.WelcomeLabel2=このウィザードは、Symbol Network Manager の実行に必要な環境をセットアップします。%n%n以下のセットアップを行います：%n  • 同梱された Symbol Network Manager プロジェクトの起動設定%n%n※ Docker Desktop は事前にインストールして起動しておいてください。
english.WelcomeLabel2=This wizard will set up the required environment for Symbol Network Manager.%n%nThe setup includes:%n  • Startup configuration for the bundled Symbol Network Manager project%n%n* Please install and start Docker Desktop in advance.

[Files]
; PowerShell スクリプトを一時ディレクトリに展開
Source: "scripts\setup-project.ps1"; DestDir: "{tmp}"; Flags: ignoreversion deleteafterinstall
; プロジェクト本体をインストール先へ同梱
; 除外理由:
;   .env / shared\*    — ビルドマシン固有の設定・ネットワーク状態（配布厳禁）
;   draft\* / build\*  — 開発用資産（インストーラー自身と output を含む）
;   *.log              — ログ
Source: "..\..\*"; DestDir: "{app}"; Flags: recursesubdirs createallsubdirs ignoreversion; Excludes: ".git\*,node_modules\*,frontend\node_modules\*,backend\node_modules\*,build\*,draft\*,shared\*,.env,*.log,.claude\*"

[Dirs]
; shared は中身を除外して同梱するため、空ディレクトリとして作成
Name: "{app}\shared"

[Run]
; Step 1: プロジェクトセットアップ
Filename: "powershell.exe"; \
  Parameters: "-NoProfile -NonInteractive -ExecutionPolicy Bypass -File ""{tmp}\setup-project.ps1"" -InstallDir ""{app}"""; \
  StatusMsg: "Symbol Network Manager をセットアップしています..."; \
  Flags: waituntilterminated

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
  if (GetWindowsVersion < $0A000000) then begin
    MsgBox('このアプリケーションは Windows 10 バージョン 2004 以上が必要です。', mbCriticalError, MB_OK);
    Result := False;
    Exit;
  end;
  Result := True;
end;

// 再起動は不要
function NeedRestart: Boolean;
begin
  Result := False;
end;
