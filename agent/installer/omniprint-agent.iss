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
; Real production API domain - api.omniprint.app.br is live and verified
; (custom domain cert valid since 2026-09-11). Used everywhere cloud_url is
; needed: the enrollment HTTP call, ManualPage's prefilled URL field, and
; the non-manual branch of CurStepChanged's config.yaml Content.
#define CloudURL "https://api.omniprint.app.br"

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
  CodePage: TInputQueryWizardPage;
  ManualPage: TInputQueryWizardPage;
  ResolvedTenantID, ResolvedAgentToken: String;
  ManualMode: Boolean;

procedure InitializeWizard;
begin
  ManualMode := False;

  CodePage := CreateInputQueryPage(wpSelectDir,
    'Conexao com o OmniPrint', 'Codigo de instalacao',
    'Informe o codigo de instalacao (8 caracteres) gerado no painel do OmniPrint, na ' +
    'pagina do cliente onde este agente sera instalado. O codigo vale por 24 horas e ' +
    'so pode ser usado uma vez.');
  CodePage.Add('Codigo de instalacao:', False);

  // Escape hatch, only ever shown if the automatic exchange fails and the
  // user chooses to continue manually - see NextButtonClick/ShouldSkipPage.
  // Kept as a real second page (not an always-visible toggle) to minimize
  // new always-on Pascal Script UI surface, matching this file's own
  // compile-error history: less new code path shown by default, less to
  // get subtly wrong.
  ManualPage := CreateInputQueryPage(CodePage.ID,
    'Instalacao manual', 'Dados fornecidos pela sua conta OmniPrint',
    'Informe o Tenant ID e o token de agente exibidos ao criar um token para este ' +
    'cliente no painel do OmniPrint.');
  ManualPage.Add('Tenant ID:', False);
  ManualPage.Add('Token do agente:', False);
  ManualPage.Add('URL da API (cloud_url):', False);
  ManualPage.Values[2] := '{#CloudURL}';
end;

function ShouldSkipPage(PageID: Integer): Boolean;
begin
  Result := (PageID = ManualPage.ID) and (not ManualMode);
end;

// Defensive even though the code alphabet
// (23456789ABCDEFGHJKMNPQRSTUVWXYZ) never contains a character that needs
// JSON escaping - cheap insurance against this function ever being reused
// for something less constrained later.
function JsonEscapeCode(const S: String): String;
var
  Escaped: String;
begin
  Escaped := S;
  StringChange(Escaped, '\', '\\');
  StringChange(Escaped, '"', '\"');
  Result := Escaped;
end;

// Pulls one string field's value out of a FLAT, server-controlled JSON
// object like {"tenant_id":"...","agent_token":"..."}. This is NOT a
// general JSON parser - it assumes (correctly, since we control the API)
// that the value never itself contains a '"' or '\', so it can stop at
// the very next quote. Works regardless of key order or whitespace around
// ':'. Returns False (leaving Value empty) on anything unexpected.
function ExtractJsonField(const Json, FieldName: String; var Value: String): Boolean;
var
  Key: String;
  KeyPos, ColonOffset, ColonPos, QuoteStart, QuoteEnd, I: Integer;
begin
  Result := False;
  Value := '';

  Key := '"' + FieldName + '"';
  KeyPos := Pos(Key, Json);
  if KeyPos = 0 then Exit;

  ColonOffset := Pos(':', Copy(Json, KeyPos + Length(Key), Length(Json)));
  if ColonOffset = 0 then Exit;
  ColonPos := KeyPos + Length(Key) + ColonOffset - 1;

  QuoteStart := 0;
  I := ColonPos + 1;
  while I <= Length(Json) do
  begin
    if Json[I] = '"' then
    begin
      QuoteStart := I;
      Break;
    end
    else if (Json[I] <> ' ') and (Json[I] <> #9) then
    begin
      // Whatever's right after ':' isn't whitespace or a quote - not the
      // string-valued field we expect. Bail rather than guess.
      Exit;
    end;
    I := I + 1;
  end;
  if QuoteStart = 0 then Exit;

  QuoteEnd := 0;
  I := QuoteStart + 1;
  while I <= Length(Json) do
  begin
    if Json[I] = '"' then
    begin
      QuoteEnd := I;
      Break;
    end;
    I := I + 1;
  end;
  if QuoteEnd = 0 then Exit;

  Value := Copy(Json, QuoteStart + 1, QuoteEnd - QuoteStart - 1);
  Result := Value <> '';
end;

// Synchronous by design (Open's 3rd param False) - the wizard's message
// loop stops pumping for the duration, so the user sees a frozen wizard,
// not a broken one. Short explicit timeouts keep a hard network failure
// from hanging the installer for WinHTTP's much longer OS defaults.
function ExchangeCode(const Code: String; var TenantID, AgentToken, ErrorMsg: String): Boolean;
var
  Http: Variant;
  Body: String;
begin
  Result := False;
  TenantID := '';
  AgentToken := '';
  ErrorMsg := '';

  try
    Http := CreateOleObject('WinHttp.WinHttpRequest.5.1');
    Http.Open('POST', '{#CloudURL}/v1/agent/enroll', False);
    Http.SetRequestHeader('Content-Type', 'application/json; charset=utf-8');
    // Resolve/connect/send/receive, milliseconds.
    Http.SetTimeouts(5000, 5000, 8000, 8000);

    Body := '{"code":"' + JsonEscapeCode(Code) + '"}';
    Http.Send(Body);

    if Http.Status = 200 then
    begin
      if ExtractJsonField(Http.ResponseText, 'tenant_id', TenantID) and
         ExtractJsonField(Http.ResponseText, 'agent_token', AgentToken) then
      begin
        Result := True;
      end
      else
      begin
        ErrorMsg := 'O servidor respondeu de forma inesperada.';
      end;
    end
    else
    begin
      ErrorMsg := 'O servidor recusou o codigo (HTTP ' + IntToStr(Http.Status) + ').';
    end;
  except
    ErrorMsg := 'Nao foi possivel conectar ao servidor OmniPrint. Verifique a conexao ' +
      'com a internet e um possivel bloqueio de firewall/antivirus.';
  end;
end;

function NextButtonClick(CurPageID: Integer): Boolean;
var
  Code, TenantID, AgentToken, ErrorMsg: String;
  Answer: Integer;
begin
  Result := True;

  if CurPageID = CodePage.ID then
  begin
    Code := Trim(CodePage.Values[0]);
    if Code = '' then
    begin
      MsgBox('Informe o codigo de instalacao.', mbError, MB_OK);
      Result := False;
      Exit;
    end;

    WizardForm.Cursor := crHourGlass;
    Result := ExchangeCode(Code, TenantID, AgentToken, ErrorMsg);
    WizardForm.Cursor := crDefault;

    if Result then
    begin
      ResolvedTenantID := TenantID;
      ResolvedAgentToken := AgentToken;
      ManualMode := False;
    end
    else
    begin
      Answer := MsgBox(ErrorMsg + #13#10#13#10 +
        'Deseja instalar manualmente informando Tenant ID, token e URL da API?',
        mbError, MB_YESNO);
      if Answer = IDYES then
      begin
        ManualMode := True;
        Result := True;
      end
      else
      begin
        Result := False;
      end;
    end;
  end
  else if CurPageID = ManualPage.ID then
  begin
    if (Trim(ManualPage.Values[0]) = '') or (Trim(ManualPage.Values[1]) = '') then
    begin
      MsgBox('Tenant ID e Token do agente sao obrigatorios.', mbError, MB_OK);
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

// Program Files' default NTFS ACL grants the built-in Users group
// Read&Execute, so any other local, unprivileged account on the same
// machine could otherwise read this file's plaintext agent_token. Locks
// it down to just Administrators and SYSTEM using well-known SIDs
// (S-1-5-32-544 / S-1-5-18) rather than the localized group names, which
// differ across Windows language editions (e.g. "Administradores" on a
// pt-BR install) - the SIDs are the same on every edition/language.
// Best-effort: logged, not fatal - the agent works correctly either way,
// this only narrows who else on the machine can read the token at rest.
procedure RestrictConfigFileAcl(const ConfigPath: String);
var
  ResultCode: Integer;
begin
  if not Exec('icacls.exe',
    '"' + ConfigPath + '" /inheritance:r /grant:r *S-1-5-32-544:F *S-1-5-18:F',
    '', SW_HIDE, ewWaitUntilTerminated, ResultCode) or (ResultCode <> 0) then
  begin
    Log('Warning: failed to restrict ACL on ' + ConfigPath + ' (icacls exit code ' + IntToStr(ResultCode) + ')');
  end;
end;

procedure CurStepChanged(CurStep: TSetupStep);
var
  ConfigPath, Content, TenantIdValue, AgentTokenValue, CloudUrlValue: String;
begin
  if CurStep = ssPostInstall then
  begin
    ConfigPath := ExpandConstant('{app}\config.yaml');

    if ManualMode then
    begin
      TenantIdValue := Trim(ManualPage.Values[0]);
      AgentTokenValue := Trim(ManualPage.Values[1]);
      CloudUrlValue := Trim(ManualPage.Values[2]);
    end
    else
    begin
      TenantIdValue := ResolvedTenantID;
      AgentTokenValue := ResolvedAgentToken;
      CloudUrlValue := '{#CloudURL}';
    end;

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
    // TenantIdValue/AgentTokenValue from a successful code exchange are
    // guaranteed ASCII (UUID, digit string) by construction on the API
    // side, so they're safe here too.
    Content :=
      'tenant_id: ' + YamlQuote(TenantIdValue) + #13#10 +
      'agent_token: ' + YamlQuote(AgentTokenValue) + #13#10 +
      'cloud_url: ' + YamlQuote(CloudUrlValue) + #13#10 + #13#10 +
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

    RestrictConfigFileAcl(ConfigPath);

    RegisterAndStartService;
  end;
end;
