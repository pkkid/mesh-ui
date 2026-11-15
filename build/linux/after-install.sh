#!/bin/bash
# deb postinst / rpm %post for Mesh UI (docs/platform/build-and-release.md#cli-launcher).
# electron-builder's default after-install script, with one change: in place
# of a /usr/bin symlink to the app binary, /usr/bin/${executable} is the headless
# CLI launcher shipped in resources/bin (build/linux/mesh-ui). The desktop
# entry starts the window from /opt directly.

# A symlink or update-alternatives entry from an older package goes first.
if type update-alternatives >/dev/null 2>&1; then
    update-alternatives --remove '${executable}' '/opt/${sanitizedProductName}/${executable}' >/dev/null 2>&1 || true
fi
rm -f '/usr/bin/${executable}'
install -m 0755 '/opt/${sanitizedProductName}/resources/bin/${executable}' '/usr/bin/${executable}'

# Check if user namespaces are supported by the kernel and working with a quick test:
if ! { [[ -L /proc/self/ns/user ]] && unshare --user true; }; then
    # Use SUID chrome-sandbox only on systems without user namespaces:
    chmod 4755 '/opt/${sanitizedProductName}/chrome-sandbox' || true
else
    chmod 0755 '/opt/${sanitizedProductName}/chrome-sandbox' || true
fi

if hash update-mime-database 2>/dev/null; then
    update-mime-database /usr/share/mime || true
fi

if hash update-desktop-database 2>/dev/null; then
    update-desktop-database /usr/share/applications || true
fi

# Install the AppArmor profile (Ubuntu 24+) when this AppArmor supports it,
# as electron-builder's default script does.
if apparmor_status --enabled > /dev/null 2>&1; then
  APPARMOR_PROFILE_SOURCE='/opt/${sanitizedProductName}/resources/apparmor-profile'
  APPARMOR_PROFILE_TARGET='/etc/apparmor.d/${executable}'
  if apparmor_parser --skip-kernel-load --debug "$APPARMOR_PROFILE_SOURCE" > /dev/null 2>&1; then
    cp -f "$APPARMOR_PROFILE_SOURCE" "$APPARMOR_PROFILE_TARGET"
    if ! { [ -x '/usr/bin/ischroot' ] && /usr/bin/ischroot; } && hash apparmor_parser 2>/dev/null; then
      apparmor_parser --replace --write-cache --skip-read-cache "$APPARMOR_PROFILE_TARGET"
    fi
  else
    echo "Skipping the installation of the AppArmor profile as this version of AppArmor does not seem to support the bundled profile"
  fi
fi
