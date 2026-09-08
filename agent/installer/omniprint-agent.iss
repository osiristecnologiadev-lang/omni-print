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

; Post-install: register and start the Windows Service using the config.yaml
; this script writes in CurStepChanged below. runhidden avoids flashing a
; console window during a silent/attended install; waituntilterminated
; makes each step finish before the next runs.
[Run]
Filename: "{app}\{#MyAppExeName}"; Parameters: "-config ""{app}\config.yaml"" install"; Flags: runhidden waituntilterminated; StatusMsg: "Registrando o serviço OmniPrint Agent..."
Filename: "{app}\{#MyAppExeName}"; Parameters: "-config ""{app}\config.yaml"" start"; Flags: runhidden waituntilterminated; StatusMsg: "Iniciando o serviço OmniPrint Agent..."

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
      '# automática ligada por padrão para encontrar impressoras na rede local' + #13#10 +
      '# sozinha. Edite este arquivo e reinicie o serviço para ajustar.' + #13#10 +
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
  end;
end;
