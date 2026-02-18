; POTA CAT installer customization — diagnostic logging
; Logs install steps to pota-cat-install.log next to the installer .exe
; so users can send the log when installation fails silently.

!macro customHeader
  !define LOG_FILE "$EXEDIR\pota-cat-install.log"
!macroend

; Helper: append a line to the log file
!macro _LogWrite text
  FileOpen $9 "${LOG_FILE}" a
  StrCmp $9 "" +3
    FileWrite $9 "${text}$\r$\n"
    FileClose $9
!macroend

!macro preInit
  !insertmacro _LogWrite "=== POTA CAT Installer ==="
  !insertmacro _LogWrite "Installer started"

  ; Log Windows version
  System::Call 'kernel32::GetVersion() i .r0'
  IntOp $1 $0 & 0xFF          ; major
  IntOp $2 $0 >> 8
  IntOp $2 $2 & 0xFF          ; minor
  !insertmacro _LogWrite "Windows version: $1.$2"
  !insertmacro _LogWrite "Install mode: $INSTDIR"
!macroend

!macro customInit
  !insertmacro _LogWrite "customInit: Install dir = $INSTDIR"
  !insertmacro _LogWrite "customInit: User = $USERNAME"
  !insertmacro _LogWrite "customInit: Admin context = $IsAdminUser"
!macroend

!macro customInstallMode
  !insertmacro _LogWrite "customInstallMode: multiUser.installMode = $MultiUser.InstallMode"
!macroend

!macro customInstall
  !insertmacro _LogWrite "customInstall: Installing to $INSTDIR"
  !insertmacro _LogWrite "customInstall: Files being extracted..."

  ; Verify the main exe was written
  IfFileExists "$INSTDIR\POTA CAT.exe" 0 +3
    !insertmacro _LogWrite "customInstall: POTA CAT.exe EXISTS - install appears successful"
    Goto +2
    !insertmacro _LogWrite "customInstall: WARNING - POTA CAT.exe NOT FOUND after install"

  !insertmacro _LogWrite "customInstall: Complete"
!macroend
