; Mesh UI NSIS additions (docs/platform/build-and-release.md#cli-launcher).
;
; Puts "$INSTDIR\bin" (mesh-ui.cmd) on the user PATH at install and takes it
; off at uninstall. Only HKCU\Environment\Path is touched, never the system
; PATH. An update (electron-updater runs the old uninstaller with --updated)
; keeps the entry. The portable zip has no installer, so it never edits PATH.
;
; Safety: NSIS strings are limited to NSIS_MAX_STRLEN. A PATH that long may
; have been cut short when read, so it is left alone rather than written
; back truncated.

; HWND_BROADCAST and WM_SETTINGCHANGE; guarded, so MUI2 including it again is fine.
!include WinMessages.nsh

; The functions below use $R0 to $R8; keep the caller's values.
!macro MeshSaveRegs
  Push $R0
  Push $R1
  Push $R2
  Push $R3
  Push $R4
  Push $R5
  Push $R6
  Push $R7
  Push $R8
!macroend

!macro MeshRestoreRegs
  Pop $R8
  Pop $R7
  Pop $R6
  Pop $R5
  Pop $R4
  Pop $R3
  Pop $R2
  Pop $R1
  Pop $R0
!macroend

; Walks the ";"-separated entries of $R1 and sets $R7 to 1 when one equals
; $R0 (with or without a trailing "\"; StrCmp ignores case). When $R8 is 1
; it also builds $R2: every entry except the matches, empty ones dropped.
!macro MeshPathScan
  StrCpy $R2 ""
  StrCpy $R3 ""
  StrCpy $R4 0
  StrCpy $R7 0
  StrLen $R5 $R1
  scan_loop:
    IntCmp $R4 $R5 scan_flush 0 scan_flush
    StrCpy $R6 $R1 1 $R4
    IntOp $R4 $R4 + 1
    StrCmp $R6 ";" scan_flush
    StrCpy $R3 "$R3$R6"
    Goto scan_loop
  scan_flush:
    StrCmp $R3 "" scan_next
    StrCmp $R3 $R0 scan_match
    StrCmp $R3 "$R0\" scan_match
    StrCmp $R8 1 0 scan_next
    StrCmp $R2 "" 0 +3
      StrCpy $R2 $R3
      Goto scan_next
    StrCpy $R2 "$R2;$R3"
    Goto scan_next
  scan_match:
    StrCpy $R7 1
  scan_next:
    StrCpy $R3 ""
    IntCmp $R4 $R5 scan_done scan_loop scan_done
  scan_done:
!macroend

!ifndef BUILD_UNINSTALLER
  Function MeshPathAdd
    !insertmacro MeshSaveRegs
    StrCpy $R0 "$INSTDIR\bin"
    ReadRegStr $R1 HKCU "Environment" "Path"
    StrLen $R5 $R1
    IntOp $R6 ${NSIS_MAX_STRLEN} - 1
    IntCmp $R5 $R6 too_long 0 too_long
    StrCpy $R8 0
    !insertmacro MeshPathScan
    StrCmp $R7 1 done
    StrCmp $R1 "" 0 +3
      StrCpy $R1 $R0
      Goto write
    StrCpy $R6 $R1 1 -1
    StrCmp $R6 ";" 0 +3
      StrCpy $R1 "$R1$R0"
      Goto write
    StrCpy $R1 "$R1;$R0"
    write:
      WriteRegExpandStr HKCU "Environment" "Path" $R1
      SendMessage ${HWND_BROADCAST} ${WM_SETTINGCHANGE} 0 "STR:Environment" /TIMEOUT=5000
      DetailPrint "Added $R0 to the user PATH"
      Goto done
    too_long:
      DetailPrint "The user PATH is too long to edit safely; add $R0 to PATH by hand."
    done:
    !insertmacro MeshRestoreRegs
  FunctionEnd
!endif

!ifdef BUILD_UNINSTALLER
  Function un.MeshPathRemove
    !insertmacro MeshSaveRegs
    StrCpy $R0 "$INSTDIR\bin"
    ReadRegStr $R1 HKCU "Environment" "Path"
    StrLen $R5 $R1
    IntOp $R6 ${NSIS_MAX_STRLEN} - 1
    IntCmp $R5 $R6 done 0 done
    StrCpy $R8 1
    !insertmacro MeshPathScan
    StrCmp $R7 1 0 done
    StrCmp $R2 "" 0 +3
      DeleteRegValue HKCU "Environment" "Path"
      Goto notify
    WriteRegExpandStr HKCU "Environment" "Path" $R2
    notify:
      SendMessage ${HWND_BROADCAST} ${WM_SETTINGCHANGE} 0 "STR:Environment" /TIMEOUT=5000
      DetailPrint "Removed $R0 from the user PATH"
    done:
    !insertmacro MeshRestoreRegs
  FunctionEnd
!endif

!macro customInstall
  Call MeshPathAdd
!macroend

!macro customUnInstall
  ${ifNot} ${isUpdated}
    Call un.MeshPathRemove
  ${endIf}
!macroend
