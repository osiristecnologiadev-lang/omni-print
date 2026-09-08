; Inno Setup script for the OmniPrint Agent Windows installer.
; Compiled by build/build.ps1 (invokes iscc if it's on PATH - same
; optional/warn-and-skip pattern as goversioninfo, not a hard build
; requirement). Install Inno Setup 6 from https://jrsoftware.org/isdl.php
; and its bin\ dir needs to be on PATH for build.ps1 to find iscc.
;
; MyAppVersion is passed in by build.ps1 via /DMyAppVersion=X.Y.Z - falls
; back to 0.0.0-dev so this script can still be opened/compiled directly
; from the Inno Setup IDE for testing.
#ifndef MyAppVersion
  #define MyAppVersion "0.0.0-dev"
#endif

#define MyAppName "OmniPrint Agent"
#define MyAppPublisher "OmniPrint"
#define MyAppExeName "omniprint-agent.exe"

[Setup]
; Fixed GUID - identifies this as the same app across versions so Inno's
; own upgrade/uninstall-previous-version handling works. Do not regenerate.
AppId={{6E3F2A6C-6B8B-4C4E-9C0A-6C0E6D8F1A21}
AppName={#MyAppName}
AppVersion={#MyAppVersion}
AppPublisher={#MyAppPublisher}
DefaultDirName={autopf}\OmniPrint\Agent
DefaultGroupName=OmniPrint
DisableProgramGroupPage=yes
; Installing/controlling a Windows Service needs admin rights.
PrivilegesRequired=admin
OutputDir=..\dist
OutputBaseFilename=OmniPrintAgentSetup-{#MyAppVersion}
Compression=lzma
SolidCompression=yes
WizardStyle=modern
UninstallDisplayIcon={app}\{#MyAppExeName}

[Languages]
Name: "brazilianportuguese"; MessagesFile: "compiler:Languages\BrazilianPortuguese.isl"
Name: "english"; MessagesFile: "compiler:Default.isl"

[Files]
Source: "..\dist\{#MyAppExeName}"; DestDir: "{app}"; Flags: ignoreversion

[Icons]
Name: "{group}\Desinstalar {#MyAppName}"; Filename: "{uninstallexe}"

; Registering/starting the service is driven from CurStepChanged (below,
; via RegisterAndStartService) instead of a declarative [Run] entry - see
; that procedure's comment for why: a plain [Run] entry proved unreliable
; against this exe specifically (confirmed via repeated real installs and
; isolated Inno-only test packages - intermittently succeeds, partially
; succeeds, or silently does nothing at all, with Inno's own /LOG showing
; a clean exit code 0 even on a run that produced no service - almost
; certainly antivirus real-time protection reacting to the freshly-written,
; unsigned exe's first-ever execution on the machine). Exec() lets this
; script check the actual result and retry, which [Run] alone cannot do.

; Reverse order on uninstall: stop before removing the service registration,
; both before Inno deletes the files.
[UninstallRun]
Filename: "{app}\{#MyAppExeName}"; Parameters: "-config ""{app}\config.yaml"" stop"; Flags: runhidden waituntilterminated; RunOnceId: "StopAgent"
Filename: "{app}\{#MyAppExeName}"; Parameters: "-config ""{app}\config.yaml"" uninstall"; Flags: runhidden waituntilterminated; RunOnceId: "UninstallAgentService"

[Code]
var
  ConnectionPage: TInputQueryWizardPage;

procedure InitializeWizard;
begin
  ConnectionPage := CreateInputQueryPage(wpSelectDir,
    'Conexão com o OmniPrint', 'Dados fornecidos pela sua conta OmniPrint',
    'Informe o Tenant ID e o token de agente exibidos ao criar este agente ' +
    'no painel do OmniPrint. Se você não tiver esses dados em mãos, cancele ' +
    'a instalação e gere um token de agente primeiro.');

  ConnectionPage.Add('Tenant ID:', False);
  ConnectionPage.Add('Token do agente:', False);
  ConnectionPage.Add('URL da API (cloud_url):', False);

  ConnectionPage.Values[2] := 'https://api.omniprint.io';
end;

function NextButtonClick(CurPageID: Integer): Boolean;
begin
  Result := True;
  if CurPageID = ConnectionPage.ID then
  begin
    if (Trim(ConnectionPage.Values[0]) = '') or (Trim(ConnectionPage.Values[1]) = '') then
    begin
      MsgBox('Tenant ID e Token do agente são obrigatórios.', mbError, MB_OK);
      Result := False;
    end;
  end;
end;

// YAML string values are wrapped in double quotes with any embedded quote
// escaped - tenant/token/URL are opaque platform-issued values, never
// user-typed YAML syntax, so this simple escaping is enough. StringChange
// mutates its first argument by reference and returns the replacement
// count (an Integer), not the resulting string - it needs a local var,
// not S itself (declared const here).
function YamlQuote(const S: String): String;
var
  Escaped: String;
begin
  Escaped := S;
  StringChange(Escaped, '"', '\"');
  Result := '"' + Escaped + '"';
end;

// Runs one service-control action (install/start), retrying a few times
// with a short pause if it doesn't succeed - see the [Run]-removal comment
// above for why a plain declarative [Run] entry wasn't trustworthy here.
// A failed attempt can leave the exe running briefly in the background
// (e.g. a delayed AV scan holding it) even though Exec() already returned,
// so this also confirms via `sc query`'s own exit code (0) rather than
// trusting the agent process's own exit code alone.
function RunServiceAction(const Action: String): Boolean;
var
  ExePath, ConfigPath, Params: String;
  ResultCode, Attempt: Integer;
begin
  ExePath := ExpandConstant('{app}\{#MyAppExeName}');
  ConfigPath := ExpandConstant('{app}\config.yaml');
  Params := '-config "' + ConfigPath + '" ' + Action;
  Result := False;
  for Attempt := 1 to 5 do
  begin
    Exec(ExePath, Params, '', SW_HIDE, ewWaitUntilTerminated, ResultCode);
    Sleep(1000);
    if Exec('sc.exe', 'query OmniPrintAgent', '', SW_HIDE, ewWaitUntilTerminated, ResultCode) then
    begin
      if (Action = 'install') or (ResultCode = 0) then
      begin
        Result := True;
        Exit;
      end;
    end;
    Sleep(2000);
  end;
end;

procedure RegisterAndStartService;
begin
  if not RunServiceAction('install') then
  begin
    MsgBox('Nao foi possivel registrar o servico OmniPrint Agent apos varias tentativas. ' +
      'Isso pode acontecer se um antivirus estiver bloqueando a primeira execucao do ' +
      'programa. Tente instalar novamente, ou execute manualmente como administrador: ' +
      '"' + ExpandConstant('{app}\{#MyAppExeName}') + '" -config "' +
      ExpandConstant('{app}\config.yaml') + '" install', mbError, MB_OK);
    Exit;
  end;
  if not RunServiceAction('start') then
  begin
    MsgBox('O servico OmniPrint Agent foi registrado, mas nao iniciou apos varias ' +
      'tentativas. Abra o Painel de Servicos do Windows e inicie "OmniPrint Monitoring ' +
      'Agent" manualmente, ou execute como administrador: "' +
      ExpandConstant('{app}\{#MyAppExeName}') + '" -config "' +
      ExpandConstant('{app}\config.yaml') + '" start', mbError, MB_OK);
  end;
end;

procedure CurStepChanged(CurStep: TSetupStep);
var
  ConfigPath, Content: String;
begin
  if CurStep = ssPostInstall then
  begin
    ConfigPath := ExpandConstant('{app}\config.yaml');
    // Every line here starts with a string literal, never a bare #13#10 -
    // Inno Setup's preprocessor treats a line whose first non-whitespace
    // character is '#' as a directive, so a standalone "#13#10 +" line
    // (meant as a blank-line separator) fails to compile with "Unknown
    // preprocessor directive". Each blank-line break is appended to the end
    // of the preceding string literal's line instead.
    // Every string literal below must stay plain ASCII: SaveStringToFile
    // writes the Pascal String's raw bytes (Windows-1252/ANSI on this
    // build), not UTF-8 - an accented character here produced a real,
    // confirmed-in-production config.yaml the Go agent's YAML parser
    // rejected outright ("invalid trailing UTF-8 octet"), caught only by
    // an actual end-to-end install, not by compiling or unit tests.
    Content :=
      'tenant_id: ' + YamlQuote(Trim(ConnectionPage.Values[0])) + #13#10 +
      'agent_token: ' + YamlQuote(Trim(ConnectionPage.Values[1])) + #13#10 +
      'cloud_url: ' + YamlQuote(Trim(ConnectionPage.Values[2])) + #13#10 + #13#10 +
      'poll_interval: 30m' + #13#10 +
      'request_delay: 500ms' + #13#10 +
      'log_file: "omniprint-agent.log"' + #13#10 + #13#10 +
      'full_raw_capture: true' + #13#10 + #13#10 +
      'devices: []' + #13#10 + #13#10 +
      '# Sem impressoras cadastradas manualmente pelo instalador - descoberta' + #13#10 +
      '# automatica ligada por padrao para encontrar impressoras na rede local' + #13#10 +
      '# sozinha. Edite este arquivo e reinicie o servico para ajustar.' + #13#10 +
      'discovery:' + #13#10 +
      '  enabled: true' + #13#10 +
      '  interval: 24h' + #13#10 +
      '  concurrency: 8' + #13#10 +
      '  probe_timeout: 800ms' + #13#10 + #13#10 +
      'auto_update:' + #13#10 +
      '  enabled: true' + #13#10 +
      '  check_interval: 6h' + #13#10;

    if not SaveStringToFile(ConfigPath, Content, False) then
      RaiseException('Falha ao gravar ' + ConfigPath);

    RegisterAndStartService;
  end;
end;
