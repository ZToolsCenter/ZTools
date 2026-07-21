!macro customInstall
  Delete "$INSTDIR\ztools-agent.exe"
  Delete "$INSTDIR\ztools-updater.exe"
  FileOpen $0 "$INSTDIR\resources\.ztools-nsis-installed" w
  FileWrite $0 "electron-updater-nsis"
  FileClose $0
!macroend
