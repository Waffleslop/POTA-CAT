; POTA CAT installer customization — diagnostic logging
; Logs install steps to pota-cat-install.log next to the installer .exe
; so users can send the log when installation fails silently.

!define LOG_FILE "$EXEDIR\pota-cat-install.log"

; Helper: append a line to the log file
!macro _LogWrite text
  FileOpen $9 "${LOG_FILE}" a
  StrCmp $9 "" +3
    FileWrite $9 "${text}$\r$\n"
    FileClose $9
!macroend

!macro customInit
  !insertmacro _LogWrite "=== POTA CAT Installer ==="
  !insertmacro _LogWrite "customInit: Install dir = $INSTDIR"
!macroend

!macro customInstall
  !insertmacro _LogWrite "customInstall: Installing to $INSTDIR"

  ; Verify the main exe was written
  IfFileExists "$INSTDIR\POTA CAT.exe" 0 +3
    !insertmacro _LogWrite "customInstall: POTA CAT.exe EXISTS - install appears successful"
    Goto +2
    !insertmacro _LogWrite "customInstall: WARNING - POTA CAT.exe NOT FOUND after install"

  !insertmacro _LogWrite "customInstall: Complete"
!macroend
