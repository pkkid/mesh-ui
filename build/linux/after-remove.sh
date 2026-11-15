#!/bin/bash
# deb postrm / rpm %postun for Mesh UI (docs/platform/build-and-release.md#cli-launcher).
# Removes the /usr/bin/${executable} CLI launcher and the AppArmor profile, but
# only when the package is really removed: an rpm upgrade runs the old
# package's %postun ($1 = 1) after the new %post, and a deb upgrade runs the
# old postrm with "upgrade", and neither may delete the new launcher.
case "$1" in
    0|remove|purge|abort-install) ;;
    *) exit 0 ;;
esac

rm -f '/usr/bin/${executable}'

APPARMOR_PROFILE_DEST='/etc/apparmor.d/${executable}'
if [ -f "$APPARMOR_PROFILE_DEST" ]; then
  if apparmor_status --enabled > /dev/null 2>&1; then
    if ! { [ -x '/usr/bin/ischroot' ] && /usr/bin/ischroot; } && hash apparmor_parser 2>/dev/null; then
      apparmor_parser --remove "$APPARMOR_PROFILE_DEST" || true
    fi
  fi
  rm -f "$APPARMOR_PROFILE_DEST"
fi
