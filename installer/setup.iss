; ===================================================================
; Script Inno Setup — Sistema Sisi Pizzeria (CodeGus)
; ===================================================================
; Uso: instale o Inno Setup (https://jrsoftware.org/isinfo.php),
;      abra este arquivo e clique em Build > Compile.
;      Gera "SisiPizzeria-Setup-v{versao}.exe".
;
; PRÉ-REQUISITO: rode `node build.js win` na pasta do projeto ANTES.
;                Isso gera a pasta ../dist/ com Node.js portable + código.
; ===================================================================

#define AppName        "Sisi Pizzeria"
#ifndef AppVersion
  #define AppVersion   "0.1.0"
#endif
#define AppPublisher   "CodeGus"
#define AppURL         "https://codegus.com"
#define AppDataDir     "SisiPizzeria"
#define LauncherExe    "launcher.vbs"

[Setup]
AppId={{4A5C8B7D-9E12-4F3A-B2C1-8E5F6D7A9B0C}
AppName={#AppName}
AppVersion={#AppVersion}
AppVerName={#AppName} v{#AppVersion}
AppPublisher={#AppPublisher}
AppPublisherURL={#AppURL}
AppSupportURL={#AppURL}
AppUpdatesURL={#AppURL}
DefaultDirName={autopf}\{#AppDataDir}
DefaultGroupName={#AppName}
DisableProgramGroupPage=yes
OutputDir=..\dist\installer
OutputBaseFilename=SisiPizzeria-Setup-v{#AppVersion}
SetupIconFile=icone.ico
Compression=lzma2/ultra64
SolidCompression=yes
WizardStyle=modern
PrivilegesRequired=admin
ArchitecturesInstallIn64BitMode=x64compatible
ArchitecturesAllowed=x64compatible
UninstallDisplayIcon={app}\icone.ico
UninstallDisplayName={#AppName}
; Cores/branding CodeGus (navy)
WizardImageBackColor=$3b291e
; WizardSmallImageFile=logo-small.bmp   ; opcional, se você criar o BMP

[Languages]
Name: "brazilianportuguese"; MessagesFile: "compiler:Languages\BrazilianPortuguese.isl"

[Tasks]
Name: "desktopicon"; Description: "Criar atalho na área de trabalho"; GroupDescription: "Atalhos adicionais:"; Flags: checkedonce
Name: "startupshortcut"; Description: "Iniciar automaticamente ao ligar o computador"; GroupDescription: "Inicialização:"; Flags: checkedonce

[Files]
; TODOS os arquivos gerados pelo build.js
Source: "..\dist\server.cjs";      DestDir: "{app}"; Flags: ignoreversion
Source: "..\dist\version.json";    DestDir: "{app}"; Flags: ignoreversion
Source: "..\dist\package.json";    DestDir: "{app}"; Flags: ignoreversion
Source: "..\dist\launcher.bat";    DestDir: "{app}"; Flags: ignoreversion
Source: "..\dist\launcher.vbs";    DestDir: "{app}"; Flags: ignoreversion

; Runtime Node.js portable
Source: "..\dist\runtime\*";       DestDir: "{app}\runtime"; Flags: ignoreversion recursesubdirs createallsubdirs

; Assets estáticos
Source: "..\dist\public\*";        DestDir: "{app}\public"; Flags: ignoreversion recursesubdirs createallsubdirs
Source: "..\dist\node_modules\*";  DestDir: "{app}\node_modules"; Flags: ignoreversion recursesubdirs createallsubdirs

; Manual + ícone
Source: "..\dist\manual\*";        DestDir: "{app}\manual"; Flags: ignoreversion recursesubdirs createallsubdirs
Source: "icone.ico";               DestDir: "{app}"; Flags: ignoreversion

[Dirs]
; Pasta de dados persistentes — permissão de escrita pra todos os usuários
Name: "{app}\data"; Permissions: users-modify

[Icons]
; Menu Iniciar
Name: "{group}\{#AppName}"; Filename: "{app}\{#LauncherExe}"; IconFilename: "{app}\icone.ico"; Comment: "Inicia o sistema"
Name: "{group}\Atendente";  Filename: "http://localhost:3000/atendente"; IconFilename: "{app}\icone.ico"
Name: "{group}\Painel TV";  Filename: "http://localhost:3000/painel";    IconFilename: "{app}\icone.ico"
Name: "{group}\Cardápio";   Filename: "http://localhost:3000/admin";     IconFilename: "{app}\icone.ico"
Name: "{group}\Relatório";  Filename: "http://localhost:3000/relatorio"; IconFilename: "{app}\icone.ico"
Name: "{group}\Manual";     Filename: "{app}\manual\manual.html";        IconFilename: "{app}\icone.ico"
Name: "{group}\Desinstalar {#AppName}"; Filename: "{uninstallexe}"

; Atalho na área de trabalho (opcional)
Name: "{autodesktop}\{#AppName}"; Filename: "{app}\{#LauncherExe}"; IconFilename: "{app}\icone.ico"; Tasks: desktopicon

; Autostart no boot (opcional)
Name: "{userstartup}\{#AppName}"; Filename: "{app}\{#LauncherExe}"; IconFilename: "{app}\icone.ico"; Tasks: startupshortcut

[Run]
; Roda o servidor logo após instalar + abre atendente
Filename: "{app}\{#LauncherExe}"; Description: "Iniciar {#AppName} agora"; Flags: nowait postinstall skipifsilent shellexec
Filename: "http://localhost:3000/atendente"; Description: "Abrir tela do Atendente"; Flags: shellexec postinstall skipifsilent

[UninstallRun]
; Encerra o processo antes de desinstalar
Filename: "{cmd}"; Parameters: "/C taskkill /F /IM node.exe"; Flags: runhidden; RunOnceId: "KillPizzariaProcess"
