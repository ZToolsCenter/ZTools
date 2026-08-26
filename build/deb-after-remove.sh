#!/bin/bash

# ZTools deb 卸载后脚本：移除命令行唤起命令，并保留默认清理逻辑。

# 只移除指向 ZTools 启动器的 /usr/bin/ztools，避免误删用户自建的同名命令。
ztools_launcher='/opt/${sanitizedProductName}/resources/ztools/ztools-launcher.sh'
if [ -L '/usr/bin/ztools' ] && [ "$(readlink '/usr/bin/ztools')" = "$ztools_launcher" ]; then
    rm -f '/usr/bin/ztools'
fi

# Delete the link to the binary
if type update-alternatives >/dev/null 2>&1; then
    update-alternatives --remove '${executable}' '/usr/bin/${executable}'
else
    rm -f '/usr/bin/${executable}'
fi

APPARMOR_PROFILE_DEST='/etc/apparmor.d/${executable}'

# Remove apparmor profile.
if [ -f "$APPARMOR_PROFILE_DEST" ]; then
  rm -f "$APPARMOR_PROFILE_DEST"
fi

# 刷新 hicolor 图标缓存，缺失命令时静默跳过。
if hash gtk-update-icon-cache 2>/dev/null; then
    gtk-update-icon-cache -f /usr/share/icons/hicolor || true
fi
